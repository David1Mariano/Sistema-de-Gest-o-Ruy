import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createLocalHttpTransport } from '../src/lib/localHttpTransport.mjs';
import { resolveBackend, localContractUnavailable } from '../src/lib/backendSelection.mjs';

// These tests validate frontend behavior only. No B/C1 protocol is mocked as verified.
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const boundaryUrl = new URL('../src/lib/backendSelection.mjs', import.meta.url).href;
const transportUrl = new URL('../src/lib/localHttpTransport.mjs', import.meta.url).href;
const authSource = (await readFile(new URL('../src/lib/localApiAuth.js', import.meta.url), 'utf8'))
  .replace("'./backendSelection.mjs'", JSON.stringify(boundaryUrl))
  .replace("'./localHttpTransport.mjs'", JSON.stringify(transportUrl));
const authUrl = moduleUrl(authSource);
const auth = await import(authUrl);
const clientSource = (await readFile(new URL('../src/lib/localApiClient.js', import.meta.url), 'utf8'))
  .replace("import { matchesQuery } from './localDb';", 'const matchesQuery = () => { throw new Error("Unexpected browser DB access"); };')
  .replace("'./localApiAuth'", JSON.stringify(authUrl))
  .replace("'./backendSelection.mjs'", JSON.stringify(boundaryUrl));
const clientUrl = moduleUrl(clientSource);
const local = await import(clientUrl);
const response = (status, data = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const deps = { local: { name: 'local' }, cloud: { name: 'cloud' }, cloudConfigured: true };

async function fixtureServer(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/fixture`;
}
test('real loopback HTTP: CSRF and exact write body arrive once', async t => {
  let calls = 0;
  const url = await fixtureServer(t, async (req, res) => {
    calls++;
    assert.equal(req.headers['x-csrf-token'], 'synthetic');
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.deepEqual(JSON.parse(raw), { operationId: 'fixture-intent', amount: 10 });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"confirmed":true}');
  });
  const request = createLocalHttpTransport();
  assert.deepEqual(await request(url, { method: 'POST', csrf: 'synthetic', operationId: 'fixture-intent', body: { operationId: 'fixture-intent', amount: 10 } }), { confirmed: true });
  assert.equal(calls, 1);
});
test('real loopback HTTP: lost write response never retries', async t => {
  let calls = 0;
  const url = await fixtureServer(t, (req, res) => { calls++; res.destroy(); });
  await assert.rejects(createLocalHttpTransport()(url, { method: 'POST', csrf: 'synthetic', operationId: 'lost', body: {} }), { outcome: 'unknown', operationId: 'lost' });
  assert.equal(calls, 1);
});
test('real loopback HTTP: stalled server times out', async t => {
  const url = await fixtureServer(t, () => {});
  await assert.rejects(createLocalHttpTransport({ timeoutMs: 30 })(url), { code: 'TIMEOUT' });
});

test('explicit LOCAL selection requires no session or cloud access', () => assert.equal(resolveBackend('local-api', deps), deps.local));
test('explicit NUVEM selects cloud', () => assert.equal(resolveBackend('supabase', deps), deps.cloud));
for (const mode of [null, 'auto', 'indexeddb', 'pglite']) {
  test(`no fallback for mode ${mode}`, () => assert.throws(() => resolveBackend(mode, deps), { code: 'MODE_REQUIRED' }));
}
test('unconfigured cloud does not fall back', () => assert.throws(() => resolveBackend('supabase', { ...deps, cloudConfigured: false }), { code: 'CLOUD_NOT_CONFIGURED' }));

for (const status of [401, 403, 409, 402, 500, 503]) {
  test(`HTTP ${status} propagates without retry or backend change`, async () => {
    let calls = 0;
    const request = createLocalHttpTransport({ fetchImpl: async () => { calls++; return response(status); } });
    await assert.rejects(request('/test', { method: 'POST', body: {}, csrf: 'synthetic' }), err => {
      assert.equal(err.status, status);
      assert.equal(err.outcome, status >= 500 ? 'unknown' : 'rejected');
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(resolveBackend('local-api', deps), deps.local);
  });
}
for (const code of ['VERSION_CONFLICT', 'IDEMPOTENCY_COLLISION']) {
  test(`409 retains server code ${code}`, async () => {
    const request = createLocalHttpTransport({ fetchImpl: async () => response(409, { code }) });
    await assert.rejects(request('/test'), { status: 409, code });
  });
}
test('connection failure during read', async () => {
  const request = createLocalHttpTransport({ fetchImpl: async () => { throw new TypeError('offline'); } });
  await assert.rejects(request('/test'), { code: 'CONNECTION_ERROR', outcome: 'not_applicable' });
});
test('lost write response is unknown, preserves operation ID, no retry', async () => {
  let calls = 0;
  const request = createLocalHttpTransport({ fetchImpl: async () => { calls++; throw new TypeError('lost'); } });
  await assert.rejects(request('/test', { method: 'POST', body: { amount: 10 }, csrf: 'x', operationId: 'intent-1' }), { code: 'CONNECTION_ERROR', outcome: 'unknown', operationId: 'intent-1' });
  assert.equal(calls, 1);
});
test('operation ID cannot be reused for a different body or target', async () => {
  let calls = 0;
  const request = createLocalHttpTransport({ fetchImpl: async () => { calls++; return response(200, { confirmed: true }); } });
  const options = { method: 'POST', body: { amount: 10 }, csrf: 'x', operationId: 'intent-2' };
  await request('/test', options);
  await assert.rejects(request('/test', { ...options, body: { amount: 20 } }), { code: 'IDEMPOTENCY_REUSE', outcome: 'not_sent' });
  await assert.rejects(request('/other', options), { code: 'IDEMPOTENCY_REUSE' });
  assert.equal(calls, 1);
});
test('explicit identical resend keeps identifier and bytes', async () => {
  const seen = [];
  const request = createLocalHttpTransport({ fetchImpl: async (_, options) => { seen.push(options.body); return response(200); } });
  const options = { method: 'POST', csrf: 'x', operationId: 'same', body: { operationId: 'same', amount: 1 } };
  await request('/test', options); await request('/test', options);
  assert.equal(seen[0], seen[1]);
});
for (const method of ['GET', 'POST']) {
  test(`timeout ${method} aborts once`, async () => {
    let calls = 0;
    const request = createLocalHttpTransport({ timeoutMs: 5, fetchImpl: (_, { signal }) => {
      calls++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } });
    await assert.rejects(request('/test', { method, csrf: 'x' }), { code: 'TIMEOUT', outcome: method === 'POST' ? 'unknown' : 'not_applicable' });
    assert.equal(calls, 1);
  });
}
test('CSRF missing blocks before sending', async () => {
  const request = createLocalHttpTransport({ fetchImpl: () => assert.fail('must not send') });
  await assert.rejects(request('/test', { method: 'POST' }), { code: 'CSRF_REQUIRED', outcome: 'not_sent' });
});
test('credentials and CSRF travel together, cookie is not exposed', async () => {
  const request = createLocalHttpTransport({ fetchImpl: async (_, options) => {
    assert.equal(options.credentials, 'include'); assert.equal(options.headers['X-CSRF-Token'], 'synthetic');
    assert.equal(options.headers.Cookie, undefined); return response(200);
  } });
  await request('/test', { method: 'POST', csrf: 'synthetic', body: {} });
});
test('invalid successful response cannot confirm a write', async () => {
  const request = createLocalHttpTransport({ fetchImpl: async () => new Response('not-json') });
  await assert.rejects(request('/test', { method: 'POST', csrf: 'x' }), { code: 'INVALID_RESPONSE', outcome: 'unknown' });
});
test('non-JSON HTTP 401 retains reauthentication error', async () => {
  const request = createLocalHttpTransport({ fetchImpl: async () => new Response('<html>denied</html>', { status: 401 }) });
  await assert.rejects(request('/test'), { code: 'HTTP_401', status: 401 });
});
test('invalid body fails before sending', async () => {
  const request = createLocalHttpTransport({ fetchImpl: () => assert.fail('no send') });
  const circular = {}; circular.self = circular;
  await assert.rejects(request('/test', { method: 'POST', csrf: 'x', body: circular }), { code: 'INVALID_REQUEST', outcome: 'not_sent' });
});
test('blocked batch operations cannot swallow errors or imply partial success', async () => {
  const client = local.createLocalApiEntityClient('Employee');
  await assert.rejects(client.bulkCreate([]), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
  await assert.rejects(client.deleteMany(['synthetic']), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
});
test('timeout includes response body consumption', async () => {
  const request = createLocalHttpTransport({ timeoutMs: 5, fetchImpl: async (_, { signal }) => ({
    status: 200, ok: true, text: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))),
  }) });
  await assert.rejects(request('/test'), { code: 'TIMEOUT' });
});
for (const method of ['login', 'logout', 'me', 'isAuthenticated', 'request']) {
  test(`local auth ${method} blocked pending actual C1 contract`, async () => {
    const adapter = auth.createLocalAuthAdapter();
    await assert.rejects(adapter[method]('synthetic', 'synthetic'), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
    assert.equal(adapter.getCurrentUser(), null);
  });
}
test('separate adapters cannot inherit another user identity', () => {
  assert.equal(auth.createLocalAuthAdapter().getCurrentUser(), null);
  assert.equal(auth.createLocalAuthAdapter().getCurrentUser(), null);
});
test('entity interface is synchronous and preserves Purchase/PurchaseItem', () => {
  for (const entity of ['Employee', 'Purchase', 'PurchaseItem', 'StockMovement']) {
    const client = local.createLocalApiEntityClient(entity);
    assert.equal(client.then, undefined);
    for (const method of ['list','filter','get','create','update','delete','transact','bulkCreate','deleteMany','subscribe']) assert.equal(typeof client[method], 'function');
  }
});
for (const entity of ['FinancialExpense', 'EmployeePayment', 'AccountsPayable', 'InventoryItem', 'StockMovement', 'DailyProduction']) {
  test(`${entity}: unsupported transaction has no callback, write or duplication`, async () => {
    const client = local.createLocalApiEntityClient(entity);
    await assert.rejects(client.transact('synthetic', () => assert.fail('no business mutation')), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
    await assert.rejects(client.create({ id: 'synthetic' }), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
  });
}
test('local contract boundary fails before sending', () => assert.throws(localContractUnavailable, { outcome: 'not_sent' }));
test('actual frontend facade never writes cloud or IndexedDB in LOCAL, including cloud HTTP 402', async () => {
  const oldStorage = globalThis.localStorage;
  let mode = 'local-api'; let calls = 0;
  globalThis.localStorage = { getItem: () => mode };
  const cloudUrl = moduleUrl(`export const isCloudConfigured=()=>true; export const createEntityClient=()=>({list:()=>{throw Object.assign(new Error('cloud quota'),{status:402})}});`);
  const supabaseUrl = moduleUrl('export const supabaseAuth = {};');
  const dbUrl = moduleUrl('export const uploadFileLocal=()=>{throw new Error("Unexpected IndexedDB upload")};');
  const source = (await readFile(new URL('../src/api/base44Client.js', import.meta.url), 'utf8'))
    .replace("'@/lib/localDb'", JSON.stringify(dbUrl))
    .replace("'@/lib/localApiClient'", JSON.stringify(clientUrl))
    .replace("'@/lib/cloudDb'", JSON.stringify(cloudUrl))
    .replace("'@/lib/supabaseClient'", JSON.stringify(supabaseUrl))
    .replace("'@/lib/backendSelection.mjs'", JSON.stringify(boundaryUrl));
  const oldFetch = globalThis.fetch;
  const oldIndexedDB = globalThis.indexedDB;
  globalThis.indexedDB = { open: () => assert.fail('no browser database access'), deleteDatabase: () => assert.fail('no deletion') };
  globalThis.fetch = () => { calls++; assert.fail('no unverified requests'); };
  try {
    const { base44 } = await import(moduleUrl(source));
    const entity = base44.entities.Purchase;
    await assert.rejects(entity.list(), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
    assert.throws(() => base44.integrations.Core.UploadFile({}), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
    mode = 'supabase'; assert.throws(() => entity.list(), { status: 402 });
    mode = 'local-api'; await assert.rejects(entity.list(), { code: 'LOCAL_CONTRACT_UNAVAILABLE' });
    mode = 'indexeddb'; assert.throws(() => entity.create({}), { code: 'MODE_REQUIRED' });
    assert.equal(calls, 0);
  } finally { globalThis.localStorage = oldStorage; globalThis.fetch = oldFetch; globalThis.indexedDB = oldIndexedDB; }
});
