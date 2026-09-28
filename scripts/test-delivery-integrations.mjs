import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { normalizeIFood, normalize99Food, DeliveryError, mayApply } from '../supabase/functions/_shared/delivery-domain.mjs';
import { providerRequest, seal, unseal, verifyIFoodSignature } from '../supabase/functions/_shared/provider-http.mjs';
import { ifoodProvider } from '../supabase/functions/_shared/ifood.mjs';
import { managementHandler, ifoodWebhookHandler } from '../supabase/functions/_shared/handlers.mjs';
import { summarizeDelivery } from '../src/lib/integrations/deliverySummary.js';

// Esta suite usa somente mocks e PostgreSQL em memoria, nunca banco/loja reais.
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_DELIVERY_TESTS'); };

const event = (id = 'evt-1', code = 'PLC', createdAt = '2026-09-25T12:00:00Z') => ({ id, code, fullCode: code, merchantId: 'shop-1', orderId: 'order-1', createdAt });
const order = () => ({ id: 'order-1', merchant: { id: 'shop-1' }, displayId: '1001', createdAt: '2026-09-25T11:00:00Z',
  total: { subTotal: 50, deliveryFee: 10, additionalFees: 2, benefits: 5, orderAmount: 57 },
  items: [{ id: 'item-1', name: 'Produto de teste', quantity: 2, totalPrice: 50 }],
  payments: { methods: [{ method: 'PIX', type: 'ONLINE', currency: 'BRL', value: 57 }] }, customer: { name: 'Não deve ser persistido' } });
const env = () => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'public-test', DELIVERY_ADMIN_USER_IDS: 'admin-id', DELIVERY_VIEWER_USER_IDS: 'viewer-id',
  DELIVERY_ALLOWED_ORIGINS: 'http://localhost:5173', IFOOD_CLIENT_ID: 'test-client', IFOOD_CLIENT_SECRET: randomBytes(32).toString('hex'), DELIVERY_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
function memoryRepo(initial = {}) {
  const record = { status: 'connected', ...initial }; const applied = [], patches = [], queued = [];
  return { record, applied, patches, queued, integration: async () => record,
    patch: async (_p, value) => { patches.push(value); Object.assign(record, value); },
    disableMerchants: async () => {}, saveMerchants: async () => {}, merchants: async () => [{ merchant_id: 'shop-1' }], allMerchants: async () => [],
    status: async () => [{ platform: 'ifood', status: record.status }], rpc: async () => true,
    enqueue: async events => { queued.push(...events); }, pending: async () => [], order: async () => null,
    apply: async (e, data) => { applied.push(data); }, eventPatch: async (e, data) => { patches.push(data); } };
}

test('normalização iFood: campos oficiais, centavos, itens/pagamento e sem PII ou líquido inventado', () => {
  const data = normalizeIFood(order(), event());
  assert.equal(data.money.gross, 6200); assert.equal(data.money.customer_total, 5700);
  assert.equal(data.money.discounts, 500); assert.equal(data.money.net, null); assert.equal(data.money.fees, null);
  assert.equal(data.items[0].quantity, 2); assert.equal(data.payments[0].type, 'ONLINE');
  assert.ok(!JSON.stringify(data).includes('Não deve ser persistido'));
  assert.throws(() => normalizeIFood({ ...order(), merchant: { id: 'other' } }, event()), /MISMATCH/);
  assert.equal(normalizeIFood({ ...order(), total: {} }, event()).money.customer_total, null);
});
test('normalização 99Food bloqueada: não aceita payload/schema inventado', () => {
  assert.throws(() => normalize99Food({ any: 'payload' }), /FOOD99_NOT_AVAILABLE/);
});
test('total concluído, ticket, cancelamento e deduplicação não criam receita em dobro', () => {
  const data = normalizeIFood(order(), event('evt-con', 'CON'));
  const row = { platform: data.platform, merchant_id: data.merchant_id, external_id: data.external_id, data };
  const summary = summarizeDelivery([row, row]);
  assert.equal(summary.orders, 1); assert.equal(summary.customerTotal, 5700); assert.equal(summary.average, 5700); assert.equal(summary.net, null);
  const cancelled = { ...row, data: { ...data, status: 'cancelled' } };
  assert.equal(summarizeDelivery([cancelled]).completed, 0);
  assert.equal(summarizeDelivery([cancelled]).customerTotal, null);
  assert.equal(mayApply(data, { ...data, event_at: '2026-09-24T12:00:00Z' }), false);
  assert.equal(mayApply(cancelled.data, { ...data, event_at: '2026-09-26T12:00:00Z' }), false);
});
test('AES-GCM protege credenciais; chave errada e conteúdo adulterado são rejeitados', async () => {
  const key = env().DELIVERY_ENCRYPTION_KEY, value = { accessToken: randomBytes(24).toString('hex') };
  const cipher = await seal(value, key);
  assert.ok(!cipher.includes(value.accessToken)); assert.deepEqual(await unseal(cipher, key), value);
  await assert.rejects(unseal(cipher, env().DELIVERY_ENCRYPTION_KEY), /CREDENTIAL_STORAGE/);
});
test('HTTP: 400/401/403/404/409/429/5xx, timeout, backoff e sem corpo secreto em erro', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(providerRequest('https://example.invalid', {}, { sleep: async () => {}, fetcher: async () => { calls++; return new Response('private-provider-data', { status }); } }), e => e.status === status && !e.message.includes('private-provider-data'));
    assert.equal(calls, status === 429 || status >= 500 ? 3 : 1);
  }
  let calls = 0;
  await assert.rejects(providerRequest('https://example.invalid', { method: 'POST' }, { fetcher: async () => { calls++; throw Error('network'); } }), /TIMEOUT/);
  assert.equal(calls, 1);
  await assert.rejects(providerRequest('https://example.invalid', {}, { fetcher: async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }) }), /RATE_LIMIT/);
});
test('iFood autorização oficial: verifier cifrado, token privado e merchant validado antes de conectado', async () => {
  const conf = env(), repo = memoryRepo({ status: 'disconnected' }); let calls = 0;
  const api = ifoodProvider(conf, repo, async (url, init) => {
    calls++;
    if (url.endsWith('/oauth/userCode')) return { userCode: 'TEST-CODE', authorizationCodeVerifier: 'private-verifier-test', verificationUrlComplete: 'https://portal.ifood.com.br/apps/code?c=TEST', expiresIn: 600 };
    if (url.endsWith('/oauth/token')) { assert.equal(init.body.get('authorizationCodeVerifier'), 'private-verifier-test'); return { accessToken: 'private-access-test', refreshToken: 'private-refresh-test', expiresIn: 21600 }; }
    assert.ok(url.includes('/merchant/v1.0/merchants')); return [{ id: 'shop-1', name: 'Teste' }];
  });
  const publicAuth = await api.begin();
  assert.equal(repo.record.status, 'connecting'); assert.ok(!JSON.stringify(publicAuth).includes('verifier'));
  const result = await api.complete('returned-code');
  assert.equal(repo.record.status, 'connected'); assert.equal(result.merchants[0].merchant_id, 'shop-1');
  assert.ok(!JSON.stringify(result).includes('private-access')); assert.equal(calls, 3);
});
test('token expirado renova uma vez; 401 força refresh; revogação preserva erro e não inventa conexão', async () => {
  for (const expired of [true, false]) {
    const conf = env(), repo = memoryRepo(); let refreshes = 0, reads = 0;
    repo.record.sealed_credentials = await seal({ accessToken: 'old', refreshToken: 'refresh-test', expiresAt: Date.now() + (expired ? -1 : 3600000) }, conf.DELIVERY_ENCRYPTION_KEY);
    let pending = true;
    repo.pending = async () => pending ? [{ platform: 'ifood', merchant_id: 'shop-1', event_id: 'evt-1', envelope: event(), attempts: 0 }] : [];
    repo.apply = async () => { pending = false; };
    const api = ifoodProvider(conf, repo, async (url, init) => {
      if (url.endsWith('/oauth/token')) { refreshes++; assert.equal(init.body.get('grantType'), 'refresh_token'); return { accessToken: 'new', refreshToken: 'rotated', expiresIn: 21600 }; }
      reads++; if (!expired && reads === 1) throw new DeliveryError('PROVIDER_UNAUTHORIZED', 401);
      return order();
    });
    await api.sync(); assert.equal(refreshes, 1); assert.ok(repo.record.last_sync_at);
  }
  const conf = env(), repo = memoryRepo({ sealed_credentials: await seal({ accessToken: 'old', refreshToken: 'bad', expiresAt: 1 }, conf.DELIVERY_ENCRYPTION_KEY) });
  repo.pending = async () => [{ platform: 'ifood', merchant_id: 'shop-1', event_id: 'evt-1', envelope: event(), attempts: 0 }];
  await assert.rejects(ifoodProvider(conf, repo, async () => { throw new DeliveryError('PROVIDER_UNAUTHORIZED', 401); }).sync(), /UNAUTHORIZED/);
  assert.equal(repo.record.last_sync_at, undefined);
});
test('falha parcial mantém evento pendente e não atualiza última sincronização bem-sucedida', async () => {
  const conf = env(), repo = memoryRepo({ sealed_credentials: await seal({ accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }, conf.DELIVERY_ENCRYPTION_KEY) });
  repo.pending = async () => [{ platform: 'ifood', merchant_id: 'shop-1', event_id: 'evt-1', envelope: event(), attempts: 2 }];
  const result = await ifoodProvider(conf, repo, async () => { throw new DeliveryError('PROVIDER_HTTP_500', 500); }).sync();
  assert.equal(result.failures, 1); assert.equal(repo.record.status, 'attention'); assert.equal(repo.record.last_sync_at, undefined);
  assert.ok(repo.patches.some(p => p.attempts === 3));
});
test('polling faz ACK só depois de persistir; falha de persistência não perde eventos', async () => {
  const conf = { ...env(), IFOOD_POLLING_ENABLED: 'true' }, repo = memoryRepo();
  repo.record.sealed_credentials = await seal({ accessToken: 'test', refreshToken: 'test', expiresAt: Date.now() + 3600000 }, conf.DELIVERY_ENCRYPTION_KEY);
  const trace = [];
  const http = async url => { if (url.includes('events:polling')) return [event()]; trace.push('ack'); return null; };
  repo.enqueue = async () => { trace.push('persist'); };
  await ifoodProvider(conf, repo, http).sync({ poll: true }); assert.deepEqual(trace, ['persist','ack']);
  repo.record.last_poll_at = null; trace.length = 0;
  repo.enqueue = async () => { throw Error('db offline'); };
  await assert.rejects(ifoodProvider(conf, repo, http).sync({ poll: true })); assert.deepEqual(trace, []);
});
test('backend recusa sessão legada, UUID não autorizado, origem inválida e escrita de viewer', async () => {
  const conf = env(), repo = memoryRepo();
  const make = (body, headers = {}) => new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await managementHandler(conf, { repo })(make({ action: 'status' }))).status, 401);
  assert.equal((await managementHandler(conf, { repo })(make({ action: 'status' }, { origin: 'https://evil.invalid' }))).status, 403);
  for (const id of ['untrusted-id', 'viewer-id']) {
    const handler = managementHandler(conf, { repo, fetcher: async () => Response.json({ id }) });
    assert.equal((await handler(make({ action: 'begin', platform: 'ifood' }, { Authorization: 'Bearer test-user-session' }))).status, 403);
  }
  const handler = managementHandler(conf, { repo, fetcher: async () => new Response('', { status: 401 }) });
  assert.equal((await handler(make({ action: 'status' }, { Authorization: 'Bearer local-user-id' }))).status, 401);
});
test('webhook: HMAC nos bytes, sem parse antes de verificar, só 202 após fila persistida', async () => {
  const conf = env(), repo = memoryRepo(), bytes = new TextEncoder().encode(JSON.stringify(event()));
  const sig = createHmac('sha256', conf.IFOOD_CLIENT_SECRET).update(bytes).digest('hex');
  assert.equal(await verifyIFoodSignature(bytes, sig, conf.IFOOD_CLIENT_SECRET), true);
  assert.equal(await verifyIFoodSignature(new Uint8Array([...bytes,32]), sig, conf.IFOOD_CLIENT_SECRET), false);
  const req = signature => new Request('https://example.invalid', { method: 'POST', headers: { 'X-IFood-Signature': signature }, body: bytes });
  const handler = ifoodWebhookHandler(conf, { repo });
  assert.equal((await handler(req('invalid'))).status, 401); assert.equal(repo.queued.length, 0);
  assert.equal((await handler(req(sig))).status, 202); assert.equal(repo.queued.length, 1);
  repo.enqueue = async () => { throw Error('db down'); };
  assert.equal((await handler(req(sig))).status, 503);
});

test('PostgreSQL: migration real, RLS/grants, idempotência, atualização, cancelamento e eventos fora de ordem', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../supabase/migrations/202609250001_delivery_integrations.sql', import.meta.url), 'utf8'));
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      for (const table of ['delivery_integrations','delivery_merchants','delivery_orders','delivery_events']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
      await assert.rejects(db.query("select delivery_enqueue('ifood','[]')"), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec("set role service_role; insert into delivery_merchants(platform,merchant_id) values('ifood','shop-1');");
    const enqueue = e => db.query('select delivery_enqueue($1,$2::jsonb) as added', ['ifood', JSON.stringify([e])]);
    const apply = (e, value = normalizeIFood(order(), e)) => db.query('select delivery_apply_event($1,$2,$3,$4::jsonb) as applied', ['ifood','shop-1',e.id,JSON.stringify(value)]);
    const first = event();
    assert.equal((await enqueue(first)).rows[0].added, 1);
    assert.equal((await enqueue(first)).rows[0].added, 0);
    assert.equal((await apply(first)).rows[0].applied, true);
    assert.equal((await apply(first)).rows[0].applied, false);
    assert.equal((await db.query('select count(*)::int as count from delivery_orders')).rows[0].count, 1);
    const next = event('evt-2','CON','2026-09-25T13:00:00Z'); await enqueue(next); await apply(next);
    assert.equal((await db.query('select status from delivery_orders')).rows[0].status, 'concluded');
    const cancel = event('evt-3','CAN','2026-09-25T14:00:00Z'); await enqueue(cancel); await apply(cancel);
    const old = event('evt-4','CFM','2026-09-25T12:30:00Z'); await enqueue(old); assert.equal((await apply(old)).rows[0].applied, false);
    const late = event('evt-5','CON','2026-09-25T15:00:00Z'); await enqueue(late); assert.equal((await apply(late)).rows[0].applied, false);
    assert.equal((await db.query('select status from delivery_orders')).rows[0].status, 'cancelled');
    await assert.rejects(enqueue({ ...first, orderId: 'collision' }), /EVENT_ID_CONFLICT/);
    await assert.rejects(enqueue({ ...first, id: 'other', merchantId: 'not-authorized' }), /UNAUTHORIZED_MERCHANT/);
    const lock = '11111111-1111-4111-8111-111111111111';
    assert.equal((await db.query('select delivery_lock($1,$2::uuid) as ok',['ifood',lock])).rows[0].ok,true);
    assert.equal((await db.query('select delivery_lock($1,$2::uuid) as ok',['ifood',lock])).rows[0].ok,false);
    await db.query('select delivery_unlock($1,$2::uuid)',['ifood',lock]);
  } finally { await db.close(); }
});

test('worker é restrito a sync; chave inválida não permite leitura nem gerência', async () => {
  const conf = { ...env(), DELIVERY_WORKER_SECRET: randomBytes(32).toString('hex') }, repo = memoryRepo(); let calls = 0;
  const provider = { sync: async () => { calls++; return { processed: 0, pending: 0 }; } };
  const handler = managementHandler(conf, { repo, provider });
  const req = (action, secret = conf.DELIVERY_WORKER_SECRET) => new Request('https://example.invalid', { method: 'POST', headers: { 'x-delivery-worker-secret': secret }, body: JSON.stringify({ action, platform: 'ifood' }) });
  assert.equal((await handler(req('sync'))).status, 200); assert.equal(calls, 1);
  for (const action of ['status','orders','begin','disconnect']) assert.equal((await handler(req(action))).status, 401);
  assert.equal((await handler(req('sync','wrong'))).status, 401); assert.equal(calls, 1);
});

test('vínculo é validado no servidor por data/canal; não grava valor financeiro vindo do browser', async () => {
  const conf = env(), repo = memoryRepo(); let linked;
  repo.order = async () => ({ ordered_at: '2026-09-25T13:00:00Z' });
  repo.cash = async () => ({ source: 'delivery', channel: 'ifood', date: '2026-09-25' });
  repo.link = async (...args) => { linked = args; };
  const handler = managementHandler(conf, { repo, fetcher: async () => Response.json({ id: 'admin-id' }) });
  const req = () => new Request('https://example.invalid', { method: 'POST', headers: { authorization: 'Bearer test-operator-session' }, body: JSON.stringify({ action: 'link', platform: 'ifood', merchantId: 'shop-1', externalId: 'order-1', cashMovementId: 'cash-1', amount: 999999 }) });
  assert.equal((await handler(req())).status, 200);
  assert.deepEqual(linked, ['ifood','shop-1','order-1','cash-1','admin-id']);
  repo.cash = async () => ({ source: 'delivery', channel: '99food', date: '2026-09-25' });
  assert.equal((await handler(req())).status, 409);
  assert.equal(repo.record.status, 'connected');
});

test('corpo nulo ou lista retorna 400 sem consultar banco ou provedor', async () => {
  const handler = managementHandler(env(), { repo: memoryRepo() });
  for (const body of ['null', '[]']) {
    const response = await handler(new Request('https://example.invalid', { method: 'POST', body }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_BODY');
  }
});

test('cancelamento de pedido conhecido não depende de detalhe remoto disponível', async () => {
  const conf = env(), repo = memoryRepo(); let pending = true;
  const data = normalizeIFood(order(), event('con','CON'));
  repo.order = async () => ({ data, status: 'concluded' });
  repo.pending = async () => pending ? [{ platform: 'ifood', merchant_id: 'shop-1', event_id: 'can', envelope: event('can','CAN','2026-09-25T14:00:00Z'), attempts: 0 }] : [];
  repo.apply = async (_e, next) => { assert.equal(next.status, 'cancelled'); assert.equal(next.money.customer_total, 5700); pending = false; };
  const result = await ifoodProvider(conf, repo, async () => { throw Error('Não deve consultar detalhe'); }).sync();
  assert.equal(result.processed, 1); assert.equal(result.failures, 0);
});
