import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizeComment, safePermalink } from '../../src/lib/social/domain.js';
import { SocialError } from './providerBase.mjs';

const invalid = () => { throw new SocialError('INVALID_PAYLOAD', 'Evento inválido'); };
const identifier = value => typeof value === 'string' && /^[\w:.-]{1,200}$/.test(value);
const text = (value, max = 200) => typeof value === 'string' ? value.slice(0, max) : null;
const digest = value => createHash('sha256').update(value).digest('hex');
// Ruy envelope, NOT a claimed native ManyChat webhook schema. Fields must be mapped
// in an External Request. Binding is loaded from secure backend config, never body.
export function normalizeManyChatEvent(payload, binding) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schema_version !== 1
    || !['contact', 'message', 'comment'].includes(payload.kind)
    || !['instagram', 'facebook', 'whatsapp'].includes(binding?.channel)
    || !identifier(binding.account_id) || !identifier(binding.manychat_account_id)
    || payload.channel !== binding.channel || !identifier(payload.contact?.id)) invalid();
  const nativeId = payload.native_id;
  const eventId = payload.external_event_id || nativeId;
  if (!identifier(eventId)) invalid(); // No guessed hash of text/time; fail closed without stable ID.
  const contact = {
    external_contact_id: payload.contact.id, account_id: binding.account_id,
    manychat_account_id: binding.manychat_account_id, channel: binding.channel, transport: 'manychat',
    name: text(payload.contact.name), first_name: text(payload.contact.first_name), last_name: text(payload.contact.last_name),
    status: text(payload.contact.status, 40), language: text(payload.contact.language, 30), timezone: text(payload.contact.timezone, 60),
    inbox_url: safePermalink(payload.contact.live_chat_url),
    // Custom fields are excluded until an explicit business allowlist is approved.
  };
  let record = null;
  if (payload.kind !== 'contact') {
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 10000
      || typeof payload.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at)
      || !Number.isFinite(Date.parse(payload.created_at))) invalid();
    if (payload.kind === 'comment') {
      // Only canonical channel ID can enter the existing public comments table.
      // Provider-local/unknown IDs must stay outside the Central until mapped.
      if (binding.channel === 'whatsapp' || binding.native_ids_verified !== true || !identifier(nativeId) || !identifier(payload.post_id)) invalid();
      record = normalizeComment({ provider: binding.channel, account_id: binding.account_id, external_comment_id: nativeId, external_post_id: payload.post_id, author_name: contact.name, text: payload.text, created_at: payload.created_at, permalink: payload.permalink });
    } else {
      if (!identifier(payload.external_message_id)) invalid();
      record = { id: JSON.stringify([binding.channel, binding.account_id, 'manychat', payload.external_message_id]), external_message_id: payload.external_message_id, text: payload.text, author_name: contact.name, created_at: new Date(payload.created_at).toISOString(), account_id: binding.account_id, provider: binding.channel, status: 'pending' };
    }
    record = { ...record, kind: payload.kind, channel: binding.channel, transport: 'manychat', external_contact_id: contact.external_contact_id };
  }
  const identity = JSON.stringify(['manychat', binding.manychat_account_id, binding.account_id, binding.channel, payload.kind, eventId]);
  const normalized = { contact, record };
  return { ...normalized, kind: payload.kind, channel: binding.channel, transport: 'manychat', external_event_id: eventId, receipt_key: digest(identity), payload_hash: digest(JSON.stringify(normalized)) };
}
function authenticate(value, secrets) {
  if (!value || value.length > 512) return false;
  const actual = createHash('sha256').update(value).digest();
  return secrets.filter(s => typeof s === 'string' && s.length >= 32).some(secret => timingSafeEqual(actual, createHash('sha256').update(secret).digest()));
}
export function manyChatAudit(action, event, actorId = null) {
  if (!['event_received', 'contact_synced', 'deduplicated', 'action_requested', 'action_sent', 'failure', 'human_approved'].includes(action)) throw new Error('Invalid audit action');
  return { action, account_id: event.contact?.account_id || event.account_id, channel: event.channel, transport: 'manychat', actor_id: actorId, created_at: new Date().toISOString() };
}
// Callable Fetch handler; NOT mounted/deployed. Existing production server serves
// static artifacts and must not become an integrations server implicitly.
export function createManyChatEventsHandler({ secrets = [], binding, repository, allowRequest = async () => false }) {
  return async request => {
    const reply = (status, code) => Response.json({ status: code }, { status });
    if (request.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
    if (!authenticate(request.headers.get('x-ruy-integration-secret'), secrets)) return reply(401, 'UNAUTHORIZED');
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, 'INVALID_CONTENT_TYPE');
    if (!repository) return reply(503, 'NOT_CONFIGURED');
    try {
      if (!await allowRequest(binding.account_id)) return reply(429, 'RATE_LIMITED');
      const reader = request.body?.getReader();
      if (!reader) return reply(400, 'INVALID_PAYLOAD');
      const chunks = []; let size = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); return reply(413, 'PAYLOAD_TOO_LARGE'); } chunks.push(Buffer.from(value)); }
      const event = normalizeManyChatEvent(JSON.parse(Buffer.concat(chunks).toString('utf8')), binding);
      // transaction contract: lock/unique receipt, compare hash, upsert canonical
      // record + contact, append events, commit before ACK. No UI persistence.
      const result = await repository.transaction(async tx => {
        const receipt = await tx.claimReceipt(event.receipt_key, event.payload_hash);
        if (receipt === 'conflict') throw new SocialError('EVENT_CONFLICT', 'Evento conflitante');
        if (receipt === 'duplicate') { await tx.appendEvent(manyChatAudit('deduplicated', event)); return 'duplicate'; }
        await tx.upsertContact(event.contact);
        if (event.record) await tx.upsertRecord(event.kind, event.record);
        await tx.appendEvent(manyChatAudit('event_received', event));
        await tx.appendEvent(manyChatAudit('contact_synced', event));
        return 'accepted';
      });
      return reply(200, result);
    } catch (error) {
      const code = error?.code === 'EVENT_CONFLICT' ? 'EVENT_CONFLICT' : error?.code === 'INVALID_PAYLOAD' || error instanceof SyntaxError ? 'INVALID_PAYLOAD' : 'INTERNAL_ERROR';
      // Separate transaction after rollback; never include request/error raw data.
      try { await repository.recordFailure?.({ ...manyChatAudit('failure', { account_id: binding.account_id, channel: binding.channel }), error_code: code }); } catch { /* safe response remains failure; host monitoring must detect audit outage */ }
      return reply(code === 'EVENT_CONFLICT' ? 409 : code === 'INVALID_PAYLOAD' ? 400 : 503, code);
    }
  };
}
