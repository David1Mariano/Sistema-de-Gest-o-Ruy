import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ManyChatProvider, createManyChatClient } from '../server/social/manychat.mjs';
import { providers, transports, SocialProvider } from '../server/social/providers.mjs';
import { normalizeManyChatEvent, createManyChatEventsHandler, manyChatAudit } from '../server/social/manychatIngress.mjs';
import { dispatchSocialOutbox, SOCIAL_AUTOMATION } from '../server/social/outbox.mjs';
import { createSocialService } from '../server/social/service.mjs';
import { commentKey } from '../src/lib/social/domain.js';
import { manyChatState, originLabel } from '../src/lib/social/integrations.js';

const secret = 'synthetic-test-secret-not-a-real-key-12345';
const binding = { account_id: 'ruy-account', manychat_account_id: 'mc-account', channel: 'instagram', native_ids_verified: true };
const payload = { schema_version: 1, kind: 'message', channel: 'instagram', external_event_id: 'event-1', external_message_id: 'msg-1', contact: { id: '123', name: 'Pessoa sintética', language: 'pt', phone: 'discard', custom_fields: { confidential: 'discard' } }, text: 'Olá', created_at: '2026-09-29T12:00:00Z' };
const req = (body = payload, key = secret) => new Request('https://ruy.test/integrations/manychat/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruy-integration-secret': key }, body: JSON.stringify(body) });
const ok = data => Response.json({ status: 'success', data });

// Test-only transactional double; NEVER imported by the application. A real DB
// adapter with UNIQUE, locks and rollback remains a prerequisite for deployment.
function repo() {
  let state = { receipts: {}, contacts: {}, records: {}, events: [], outbox: {} };
  let queue = Promise.resolve();
  return {
    get state() { return state; },
    recordFailure: async event => state.events.push(event),
    transaction(work) {
      const task = queue.then(async () => {
        const draft = structuredClone(state);
        const result = await work({
          claimReceipt: async (key, hash) => { if (draft.receipts[key]) return draft.receipts[key] === hash ? 'duplicate' : 'conflict'; draft.receipts[key] = hash; return 'new'; },
          upsertContact: async contact => { draft.contacts[JSON.stringify([contact.account_id, contact.channel, contact.transport, contact.external_contact_id])] = contact; },
          upsertRecord: async (kind, record) => { const previous = draft.records[record.id]; draft.records[record.id] = { ...record, status: previous?.status || record.status }; },
          appendEvent: async event => draft.events.push(event),
          recordForUpdate: async () => ({ id: 'record-1', account_id: binding.account_id, channel: binding.channel, transport: 'manychat', version: 1, text: 'Olá' }),
          canAccessAccount: async () => true,
          insertOutboxOnce: async entry => {
            const previous = draft.outbox[entry.idempotency_key];
            if (previous && previous.fingerprint !== entry.fingerprint) throw Object.assign(new Error('Conflict'), { code: 'CONFLICT' });
            if (!previous) draft.outbox[entry.idempotency_key] = entry;
            return { created: !previous, entry: previous || entry };
          },
        });
        state = draft; return result;
      });
      queue = task.catch(() => {}); return task;
    },
  };
}
const handler = repository => createManyChatEventsHandler({ secrets: [secret], binding, repository, allowRequest: async () => true });
test('ManyChatProvider extends SocialProvider without replacing channel providers', () => {
  assert.ok(transports.manychat instanceof SocialProvider);
  assert.deepEqual(Object.keys(providers), ['instagram', 'facebook', 'tiktok']);
  assert.equal(transports.manychat.status().connected, false);
});
test('missing key: health not configured, no HTTP', async () => {
  const client = createManyChatClient({ request: () => { throw new Error('must not call'); } });
  assert.deepEqual(await client.connectionCheck(), { configured: false, reachable: false, authenticated: false, error_code: 'NOT_CONFIGURED' });
  await assert.rejects(client.getContact('123'), { code: 'NOT_CONFIGURED' });
});
test('backend GET authenticates using header and official path', async () => {
  const client = createManyChatClient({ apiKey: secret, request: async (url, options) => {
    assert.equal(url, 'https://api.manychat.com/fb/page/getInfo');
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(options.redirect, 'error'); return ok({ id: 'p', access_token: secret });
  } });
  const health = await client.connectionCheck(); assert.equal(health.authenticated, true);
  assert.ok(!JSON.stringify(health).includes(secret));
});
test('getContact validates ID and returns only allowlisted fields', async () => {
  const client = createManyChatClient({ apiKey: secret, request: async url => { assert.ok(url.endsWith('subscriber_id=123')); return ok({ id: 123, name: 'Teste', apiKey: secret, phone: 'private' }); } });
  assert.equal((await client.getContact('123')).id, '123');
  assert.equal((await client.getContact('123')).phone, undefined);
  await assert.rejects(client.getContact('../bad'), { code: 'INVALID_CONTACT' });
});
for (const [status, code] of [[401, 'AUTHENTICATION_FAILED'], [403, 'FORBIDDEN']]) test(`HTTP ${status}: sanitized error, no retry`, async () => {
  let calls = 0;
  const client = createManyChatClient({ apiKey: secret, request: async () => { calls++; return new Response(secret, { status }); } });
  assert.equal((await client.connectionCheck()).error_code, code); assert.equal(calls, 1);
});
test('429: bounded exponential retry', async () => {
  const delays = []; let calls = 0;
  const client = createManyChatClient({ apiKey: secret, request: async () => { calls++; return new Response('', { status: 429 }); }, wait: async ms => delays.push(ms) });
  assert.equal((await client.connectionCheck()).error_code, 'RATE_LIMITED');
  assert.equal(calls, 3); assert.deepEqual(delays, [250, 500]);
});
test('Retry-After long pause is deferred, never retried early', async () => {
  let calls = 0;
  const client = createManyChatClient({ apiKey: secret, request: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '86400' } }); }, wait: async () => assert.fail('must defer') });
  assert.equal((await client.connectionCheck()).error_code, 'RATE_LIMITED'); assert.equal(calls, 1);
});
test('timeout bounds even a transport that ignores AbortSignal', async () => {
  const client = createManyChatClient({ apiKey: secret, timeoutMs: 5, maxAttempts: 1, request: () => new Promise(() => {}) });
  assert.equal((await client.connectionCheck()).error_code, 'TIMEOUT');
});
test('network exception never exposes headers or key', async () => {
  const client = createManyChatClient({ apiKey: secret, maxAttempts: 1, request: async () => { throw new Error(secret); } });
  const health = await client.connectionCheck(); assert.equal(health.error_code, 'NETWORK_ERROR'); assert.ok(!JSON.stringify(health).includes(secret));
});
test('authenticated External Request accepts normalized event and audits', async () => {
  const db = repo(); const response = await handler(db)(req());
  assert.equal(response.status, 200); assert.equal(Object.keys(db.state.contacts).length, 1);
  assert.deepEqual(db.state.events.map(e => e.action), ['event_received', 'contact_synced']);
});
test('invalid authentication rejected before payload/persistence', async () => {
  const db = repo(); assert.equal((await handler(db)(req(payload, 'bad'))).status, 401);
  assert.equal(Object.keys(db.state.contacts).length, 0);
});
test('rotating shared secret and request policy', async () => {
  const db = repo();
  const ingress = createManyChatEventsHandler({ secrets: ['new-synthetic-secret-of-sufficient-length', secret], binding, repository: db, allowRequest: async () => false });
  assert.equal((await ingress(req())).status, 429);
});
test('missing repository returns unavailable, never acknowledges fake persistence', async () => {
  assert.equal((await handler(undefined)(req())).status, 503);
});
test('payload schema and trusted channel binding are required', async () => {
  const db = repo(); const ingress = handler(db);
  assert.equal((await ingress(req({ ...payload, channel: 'facebook' }))).status, 400);
  assert.equal((await ingress(req({ ...payload, schema_version: 2 }))).status, 400);
  assert.equal((await ingress(req({ ...payload, external_event_id: undefined }))).status, 400);
});
test('contact mapper minimizes personal data', () => {
  const { contact } = normalizeManyChatEvent(payload, binding);
  assert.equal(contact.external_contact_id, '123'); assert.equal(contact.language, 'pt');
  assert.equal(contact.phone, undefined); assert.equal(contact.custom_fields, undefined);
});
test('origin channel is preserved independently of manychat transport', () => {
  for (const channel of ['instagram', 'facebook', 'whatsapp']) {
    const event = normalizeManyChatEvent({ ...payload, channel }, { ...binding, channel });
    assert.equal(event.record.provider, channel); assert.equal(event.record.transport, 'manychat');
    assert.match(originLabel(event.record), /via ManyChat/);
  }
});
test('private message never becomes a public comment', () => {
  const event = normalizeManyChatEvent(payload, binding);
  assert.equal(event.record.kind, 'message'); assert.equal(event.record.external_comment_id, undefined);
});
const commentPayload = { ...payload, kind: 'comment', native_id: 'native-comment', post_id: 'native-post' };
test('public comment reconciles by same key as direct Meta', () => {
  const { record } = normalizeManyChatEvent(commentPayload, binding);
  assert.equal(record.id, commentKey({ provider: 'instagram', account_id: binding.account_id, external_comment_id: 'native-comment' }));
});
test('unverified native IDs and WhatsApp public comments rejected', () => {
  assert.throws(() => normalizeManyChatEvent(commentPayload, { ...binding, native_ids_verified: false }));
  assert.throws(() => normalizeManyChatEvent({ ...commentPayload, channel: 'whatsapp' }, { ...binding, channel: 'whatsapp' }));
});
test('duplicate and concurrent requests create one contact/message', async () => {
  const db = repo(); const ingress = handler(db);
  await Promise.all([ingress(req()), ingress(req()), ingress(req())]);
  assert.equal(Object.keys(db.state.receipts).length, 1); assert.equal(Object.keys(db.state.contacts).length, 1);
  assert.equal(Object.keys(db.state.records).length, 1); assert.equal(db.state.events.filter(e => e.action === 'deduplicated').length, 2);
});
test('same event ID with changed body is conflict, no overwrite', async () => {
  const db = repo(); const ingress = handler(db); await ingress(req());
  assert.equal((await ingress(req({ ...payload, text: 'alterado' }))).status, 409);
  assert.equal(Object.values(db.state.records)[0].text, 'Olá');
});
test('different delivery IDs for same native comment still upsert one record', async () => {
  const db = repo(); const ingress = handler(db);
  await ingress(req(commentPayload)); await ingress(req({ ...commentPayload, external_event_id: 'event-2' }));
  assert.equal(Object.keys(db.state.records).length, 1);
});
test('failure auditing sanitizes thrown provider/repository secrets', async () => {
  const events = [];
  const ingress = handler({ transaction: async () => { throw new Error(secret); }, recordFailure: async e => events.push(e) });
  const response = await ingress(req()); assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(events).includes(secret)); assert.ok(!(await response.text()).includes(secret));
  assert.equal(events[0].action, 'failure');
});
const approval = { kind: 'message', recordId: 'record-1', text: 'Resposta revisada', confirmHuman: true, expectedVersion: 1, idempotencyKey: '00000000-0000-4000-8000-000000000001' };
const service = (repository, role = 'admin') => createSocialService({ repository, verifyIdentity: async () => ({ id: 'human', active: true, app_metadata: { system_role: role } }) });
test('human approval prepares blocked outbox, never sends', async () => {
  const db = repo(); const entry = await service(db).prepareManyChatAction('test', approval);
  assert.equal(entry.status, 'pending'); assert.equal(entry.blocked_reason, 'SEND_DISABLED');
  assert.equal(entry.approved_by, 'human'); assert.equal(entry.moderation.automaticAllowed, false);
  assert.deepEqual(db.state.events.map(e => e.action), ['human_approved', 'action_requested']);
});
test('outbox approval is idempotent, changed text invalidates retry', async () => {
  const db = repo(); const api = service(db);
  await api.prepareManyChatAction('test', approval); await api.prepareManyChatAction('test', approval);
  assert.equal(Object.keys(db.state.outbox).length, 1); assert.equal(db.state.events.length, 2);
  await assert.rejects(api.prepareManyChatAction('test', { ...approval, text: 'changed' }), { code: 'CONFLICT' });
});
test('approval required and manager cannot prepare outbox', async () => {
  await assert.rejects(service(repo()).prepareManyChatAction('test', { ...approval, confirmHuman: false }), { code: 'REVIEW_REQUIRED' });
  await assert.rejects(service(repo(), 'manager').prepareManyChatAction('test', approval), { code: 'FORBIDDEN' });
  await assert.rejects(service(repo()).prepareManyChatAction('test', { ...approval, expectedVersion: 2 }), { code: 'CONFLICT' });
});
test('IA and dispatch remain OFF even with human approval', async () => {
  assert.deepEqual(SOCIAL_AUTOMATION, { enabled: false, manychat: false });
  await assert.rejects(dispatchSocialOutbox(), { code: 'SEND_DISABLED' });
  await assert.rejects(new ManyChatProvider({ apiKey: secret }).replyComment(), { code: 'UNSUPPORTED_CHANNEL' });
});
test('audit event records provenance without raw payload', () => {
  const event = manyChatAudit('action_requested', { account_id: 'a', channel: 'instagram', apiKey: secret }, 'human');
  assert.equal(event.transport, 'manychat'); assert.equal(event.channel, 'instagram'); assert.ok(!JSON.stringify(event).includes(secret));
});
test('dashboard status mapping does not invent connectivity', () => {
  assert.equal(manyChatState(), 'not_configured');
  assert.equal(manyChatState({ configured: true }), 'configured');
  assert.equal(manyChatState({ configured: true, error_code: 'FORBIDDEN' }), 'authentication_error');
  assert.equal(manyChatState({ configured: true, reachable: true, authenticated: true }), 'connected');
  assert.equal(manyChatState({ configured: true, error_code: 'TIMEOUT' }), 'attention');
});
const abs = path => fileURLToPath(new URL(`../${path}`, import.meta.url));
test('frontend and bundle exclude ManyChat key/transport and fixture secret', async () => {
  async function scan(dir) {
    for (const entry of await readdir(abs(dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scan(path);
      else if (/\.(jsx?|mjs|html)$/.test(path)) {
        const source = await readFile(abs(path), 'utf8');
        assert.ok(!source.includes(secret));
        assert.doesNotMatch(source, /MANYCHAT_API_KEY|VITE_MANYCHAT|api\.manychat\.com|server\/social\/manychat/);
      }
    }
  }
  await scan('src');
  // Build is mandatory before this test: scan actual output as well.
  await scan('dist');
});
test('SQL stays a rollback proposal, references existing social domain', async () => {
  const sql = await readFile(abs('scripts/proposed-social-manychat.sql'), 'utf8');
  assert.match(sql, /alter table public.social_comments/); assert.match(sql, /social_outbox/);
  assert.match(sql, /force row level security/); assert.match(sql, /rollback;/);
  assert.doesNotMatch(sql, /create table.*manychat_|MANYCHAT_API_KEY/);
});
test('rendered card shows safe state and no secret input', async () => {
  const { createServer } = await import('vite'); const { default: react } = await import('@vitejs/plugin-react');
  const { createElement } = await import('react'); const { renderToStaticMarkup } = await import('react-dom/server');
  const vite = await createServer({ configFile: false, plugins: [react()], resolve: { alias: { '@': abs('src') } }, server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const oldWindow = globalThis.window;
    try { globalThis.window = { self: null, top: null }; await vite.ssrLoadModule(abs('src/lib/utils.js')); }
    finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
    const { default: Card } = await vite.ssrLoadModule(abs('src/components/social/ManyChatCard.jsx'));
    const html = renderToStaticMarkup(createElement(Card, { canConfigure: true }));
    assert.match(html, /Não configurado/); assert.match(html, /Configuração backend necessária/); assert.match(html, /OFF/); assert.doesNotMatch(html, /<input/);
    const unsafe = renderToStaticMarkup(createElement(Card, { health: { configured: true, error_code: secret } })); assert.ok(!unsafe.includes(secret));
  } finally { await vite.close(); }
});

// ============================================================ lacunas fechadas
// As três lacunas apontadas na auditoria: a regra já existia no código, mas
// faltava a PROVA explícita de que ela se mantém.

// 1) NÃO deduplica por texto/nome/timestamp. Dois comentários com o MESMO texto
//    e o MESMO autor, mas IDs nativos diferentes, são DOIS comentários. Só o ID
//    nativo reconcilia — como decidido, para não gerar falso positivo/merge.
test('no deduplication by text, name or timestamp: only native ID reconciles', async () => {
  const db = repo(); const ingress = handler(db);
  const base = { ...commentPayload, text: 'Mensagem idêntica', native_id: 'native-a', external_event_id: 'event-a' };
  const outro = { ...base, native_id: 'native-b', external_event_id: 'event-b' };
  // Autor e texto iguais de propósito; só o ID nativo muda.
  assert.equal(ingress && true, true);
  await ingress(req(base));
  await ingress(req(outro));
  const registros = Object.values(db.state.records);
  assert.equal(registros.length, 2, 'textos iguais com IDs diferentes são 2 registros');
  assert.equal(new Set(registros.map(r => r.external_comment_id)).size, 2, 'cada um com seu ID nativo');
  // E o inverso: mesmo ID nativo comDeliveries diferentes continua UM registro.
  const db2 = repo(); const ingress2 = handler(db2);
  await ingress2(req({ ...base, external_event_id: 'event-x' }));
  await ingress2(req({ ...base, external_event_id: 'event-y' }));
  assert.equal(Object.keys(db2.state.records).length, 1, 'mesmo ID nativo reconciles em 1');
});

// 2) Canal sem capacidade: um canal fora da lista (ex.: tiktok, que NÃO é
//    canal ManyChat) é recusado, e um canal válido mas sem capacidade de envio
//    permanece bloqueado. Nenhum bypass.
test('unsupported channel and unsupported capability are both refused', async () => {
  // Canal não suportado pelo transporte é rejeitado na normalização.
  assert.throws(() => normalizeManyChatEvent({ ...payload, channel: 'tiktok' }, { ...binding, channel: 'tiktok' }), { code: 'INVALID_PAYLOAD' });
  // Canal válido, operação sem capacidade: o provider recusa, não envia.
  const provider = new ManyChatProvider({ apiKey: secret });
  await assert.rejects(provider.replyComment(), { code: 'UNSUPPORTED_CHANNEL' });
  // E as capabilities declaradas refletem a fase atual.
  assert.equal(provider.capabilities.replyComment, false);
  assert.equal(provider.capabilities.connect, false);
  assert.equal(provider.capabilities.getContact, true, 'getContact é a única habilitada');
});

// 3) O health NUNCA inventa conectividade: sem chave é "não configurado" e
//    nenhuma chamada HTTP sai; a UI mapeia cada estado sem expor segredo.
test('health never invents connectivity and UI maps real states only', async () => {
  const semChave = createManyChatClient({ request: () => { throw new Error('não deve chamar HTTP'); } });
  const health = await semChave.connectionCheck();
  assert.equal(health.configured, false);
  assert.equal(health.reachable, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.error_code, 'NOT_CONFIGURED');
  assert.ok(!JSON.stringify(health).includes(secret), 'sem segredo na resposta');
  // Estados reais da UI, sem inventar "conectado" quando falta configuração.
  assert.equal(manyChatState(undefined), 'not_configured');
  assert.equal(manyChatState({ configured: false }), 'not_configured');
  assert.equal(manyChatState({ configured: true, authenticated: true, reachable: true }), 'connected');
  assert.equal(manyChatState({ configured: true, error_code: 'AUTHENTICATION_FAILED' }), 'authentication_error');
  // O rótulo preserva o canal real e só acrescenta o transporte.
  assert.equal(originLabel({ channel: 'instagram', transport: 'manychat' }), 'Instagram · via ManyChat');
  assert.equal(originLabel({ channel: 'whatsapp', transport: 'manychat' }), 'WhatsApp · via ManyChat');
  assert.equal(originLabel({ channel: 'facebook' }), 'Facebook', 'sem transporte, mostra só o canal');
});

