import { createHash } from 'node:crypto';
import { SocialError } from './providerBase.mjs';
import { moderationCheck } from './ai.mjs';
import { manyChatAudit } from './manychatIngress.mjs';

export const SOCIAL_AUTOMATION = Object.freeze({ enabled: false, manychat: false });
export const OUTBOX_STATES = Object.freeze(['pending', 'sent', 'failed', 'retrying', 'cancelled']);
export async function prepareManyChatAction({ repository, actor, request }) {
  if (request.confirmHuman !== true || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 2000
    || !Number.isInteger(request.expectedVersion) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.idempotencyKey || '')
    || !['message', 'comment'].includes(request.kind)) throw new SocialError('REVIEW_REQUIRED', 'Revisão humana obrigatória');
  return repository.transaction(async tx => {
    // Authorization, version check and approval bind to the persisted record, not UI fields.
    const record = await tx.recordForUpdate(actor.id, request.kind, request.recordId);
    if (!record || !await tx.canAccessAccount(actor.id, record.account_id)) throw new SocialError('FORBIDDEN', 'Conta não autorizada');
    if (record.transport !== 'manychat' || !['instagram', 'facebook', 'whatsapp'].includes(record.channel)) throw new SocialError('UNSUPPORTED_CHANNEL', 'Envio por ManyChat não disponível para este canal.');
    if (record.version !== request.expectedVersion) throw new SocialError('CONFLICT', 'Registro alterado; revise novamente');
    const content = request.text.trim();
    const fingerprint = createHash('sha256').update(JSON.stringify([actor.id, record.id, request.kind, record.version, content])).digest('hex');
    const entry = {
      idempotency_key: request.idempotencyKey, fingerprint, record_id: record.id, kind: request.kind,
      account_id: record.account_id, channel: record.channel, transport: 'manychat', text: content,
      approved_by: actor.id, approved_at: new Date().toISOString(), record_version: record.version,
      moderation: moderationCheck(`${record.text} ${content}`, record.category),
      status: 'pending', blocked_reason: 'SEND_DISABLED', attempts: 0,
    };
    // Repository must return existing same-fingerprint entry or raise conflict,
    // atomically enforcing idempotency_key uniqueness under concurrent approvals.
    const result = await tx.insertOutboxOnce(entry);
    if (result.created) {
      await tx.appendEvent(manyChatAudit('human_approved', entry, actor.id));
      await tx.appendEvent(manyChatAudit('action_requested', entry, actor.id));
    }
    return result.entry;
  });
}
// No send endpoint, background worker or hidden switch exists in this phase.
export async function dispatchSocialOutbox() {
  throw new SocialError('SEND_DISABLED', 'Envio por ManyChat não disponível para este canal.');
}
