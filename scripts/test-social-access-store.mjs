// Fase 8: store Postgres de acesso social e handler HTTP de administraÃ§Ã£o.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSocialAccessStore, STORE_MALFORMED, STORE_NOT_READY } from '../server/social/accountAccessStore.mjs';
import { createSocialAdminHandler } from '../server/social/adminHandler.mjs';
import { createAccountAdminService } from '../server/social/accountAdmin.mjs';
import { createRateLimiter } from '../server/social/aiHost.mjs';

const PERMISSOES = { can_view: true, can_reply: false, can_approve_ai: false, can_admin: false };

/**
 * Cliente Postgres de mentira que responde conforme o SQL recebido. NÃ£o faz
 * parsing: decide por fragmento, como faria um humano lendo a consulta. O que
 * importa Ã© que o store EMITA as instruÃ§Ãµes certas (lock, for update, on
 * conflict) e trate o retorno do driver corretamente.
 */
function fakePg({ acessos = [], contas = [{ id: 'acc-1', provider: 'instagram', display_name: 'Ruy', status: 'connected', external_account_id: '17841400' }], usuarios = [], auditoria = [], falhar = null, respostaEstranha = false } = {}) {
  const estado = { acessos, contas, usuarios, auditoria, sql: [], commit: 0, rollback: 0, begin: 0, liberado: 0 };
  const client = {
    async query(sql, params = []) {
      estado.sql.push(sql.replace(/\s+/g, ' ').trim());
      if (falhar && sql.includes(falhar)) throw Object.assign(new Error('db caiu'), { code: '08006' });
      if (respostaEstranha) return { rows: null };
      if (sql === 'begin') { estado.begin += 1; return { rows: [] }; }
      if (sql === 'commit') { estado.commit += 1; return { rows: [] }; }
      if (sql === 'rollback') { estado.rollback += 1; return { rows: [] }; }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
      if (sql.includes('count(*)') && sql.includes('can_admin')) return { rows: [{ n: acessos.filter((a) => a.active && a.can_admin).length }] };
      if (sql.includes('insert into') && sql.includes('_audit')) { auditoria.push({ params }); return { rows: [{ id: 'aud-1' }] }; }
      if (sql.includes('insert into')) {
        // `on conflict do nothing` devolvendo 0 linhas Ã‰ a corrida de grant.
        if (acessos.some((a) => a.account_id === params[0] && a.auth_user_id === params[2])) return { rows: [] };
        const row = { account_id: params[0], auth_user_id: params[2], can_view: params[4], can_reply: params[5], can_approve_ai: params[6], can_admin: params[7], active: params[8] };
        acessos.push(row);
        return { rows: [row] };
      }
      if (sql.startsWith('update')) {
        const alvo = acessos.find((a) => a.account_id === params[0] && a.auth_user_id === params[1]);
        if (!alvo) return { rows: [] };
        Object.assign(alvo, { can_view: params[2], can_reply: params[3], can_approve_ai: params[4], can_admin: params[5], active: params[6] });
        return { rows: [alvo] };
      }
      if (sql.includes('for update')) return { rows: acessos.filter((a) => a.account_id === params[0] && a.auth_user_id === params[1]) };
      if (sql.includes('from public.records')) return { rows: usuarios };
      if (sql.includes('from public.social_accounts a')) {
        return { rows: contas.map((c) => ({ ...c, access_count: acessos.filter((x) => x.account_id === c.id && x.active).length })) };
      }
      // `findAccount` busca por id: o fake precisa filtrar, senão "conta
      // inexistente" devolveria a primeira da lista e o teste não provaria nada.
      if (sql.includes('from public.social_accounts')) return { rows: contas.filter((c) => c.id === params[0]) };
      return { rows: [] };
    },
    release() { estado.liberado += 1; },
  };
  return { client, estado, withClient: async () => client };
}

test('store: list devolve contagem numÃ©rica, nÃ£o string do Postgres', async () => {
  const pg = fakePg({ acessos: [{ account_id: 'acc-1', auth_user_id: 'u1', ...PERMISSOES, active: true }] });
  const store = createSocialAccessStore({ withClient: pg.withClient });
  const contas = await store.read((tx) => tx.listAccounts());
  assert.equal(contas[0].access_count, 1);
  assert.equal(typeof contas[0].access_count, 'number', '"1" faria a tela escrever "1 pessoas"');
});
test('store: audit entra na mesma transaÃ§Ã£o da concessÃ£o', async () => {
  const pg = fakePg();
  const store = createSocialAccessStore({ withClient: pg.withClient });
  await store.transaction(async (tx) => {
    await tx.insertAccess({ accountId: 'acc-1', provider: 'instagram', authUserId: 'u1', permissions: PERMISSOES, active: true });
    await tx.appendAudit({ action: 'access_granted', accountId: 'acc-1', provider: 'instagram', targetUserId: 'u1', operatorUserId: 'op-1', origin: 'ui' });
  });
  assert.equal(pg.estado.auditoria.length, 1);
  assert.equal(pg.estado.commit, 1, 'um commit sÃ³ para concessÃ£o + auditoria');
  assert.equal(JSON.parse(pg.estado.auditoria[0].params[5]).origin, 'ui', 'a origem precisa ser gravada');
});
test('store: erro depois do grant derruba a transaÃ§Ã£o inteira', async () => {
  const pg = fakePg();
  const store = createSocialAccessStore({ withClient: pg.withClient });
  await assert.rejects(store.transaction(async (tx) => {
    await tx.insertAccess({ accountId: 'acc-1', provider: 'instagram', authUserId: 'u1', permissions: PERMISSOES, active: true });
    throw Object.assign(new Error('falhou depois'), { code: 'XX000' });
  }));
  assert.equal(pg.estado.commit, 0, 'nada pode ser commitado');
  assert.equal(pg.estado.rollback, 1);
});
test('store: resposta malformada vira STORE_MALFORMED, nunca lista vazia', async () => {
  const pg = fakePg({ respostaEstranha: true });
  const store = createSocialAccessStore({ withClient: pg.withClient });
  await assert.rejects(store.read((tx) => tx.listAccounts()), { code: STORE_MALFORMED });
});
test('store: schema ausente vira ACCESS_SCHEMA_NOT_READY', async () => {
  const pg = fakePg();
  pg.client.query = async (sql) => {
    if (sql.includes('social_account_access')) throw Object.assign(new Error('relation does not exist'), { code: '42P01' });
    return { rows: [] };
  };
  const store = createSocialAccessStore({ withClient: pg.withClient });
  await assert.rejects(store.read((tx) => tx.listAccounts()), { code: STORE_NOT_READY });
});
test('store: conta e usuÃ¡rio ausentes devolvem null, sem inventar linha', async () => {
  const pg = fakePg();
  const store = createSocialAccessStore({ withClient: pg.withClient });
  assert.equal(await store.read((tx) => tx.findAccount('nao-existe')), null);
  assert.equal(await store.read((tx) => tx.findUser('nao-existe')), null);
  assert.equal(await store.read((tx) => tx.findAccess('acc-1', 'ninguem')), null);
});
test('store: advisory lock e contagem de admins para o bootstrap', async () => {
  const pg = fakePg({ acessos: [{ account_id: 'acc-1', auth_user_id: 'u1', ...PERMISSOES, can_admin: true, active: true }] });
  const store = createSocialAccessStore({ withClient: pg.withClient });
  await store.transaction(async (tx) => {
    await tx.lockBootstrap();
    assert.equal(await tx.countActiveAdmins(), 1);
  });
  assert.ok(pg.estado.sql.some((s) => s.includes('pg_advisory_xact_lock')), 'o lock precisa ser advisory');
});


// â”€â”€ HTTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function montarHandler({ role = 'admin', vinculo = true, limiter = null } = {}) {
  // Duplo no CONTRATO do `createAccountAdminService` (Fase 7). Nomes e formatos
  // importam: é o serviço que dirige a operação, não o handler.
  // É STATEFUL de propósito: grant precisa criar a linha que update/revoke
  // encontram depois. Um duplo sempre-vazio faria update dar 404 e o teste
  // passaria a medir o duplo, não o fluxo.
  const links = [{ auth_user_id: 'u1', account_id: 'acc-1', active: true, can_view: true, can_reply: false, can_approve_ai: false, can_admin: false }];
  const linha = (extra) => ({ auth_user_id: 'u1', account_id: 'acc-1', active: true, can_view: true, can_reply: false, can_approve_ai: false, can_admin: false, ...extra });
  const store = {
    async listAccounts() { return [{ id: 'acc-1', provider: 'instagram', display_name: 'Ruy', status: 'connected', external_account_id: '17841400', access_count: links.filter((l) => l.active).length }]; },
    async listAccess() { return links.map((l) => ({ ...l })); },
    // `findAccess` também devolve LINHAS: o serviço rejeita resposta que não seja
    // array com `MALFORMED`/UNAVAILABLE, em vez de tratar como "sem vínculo".
    async findAccess(_accountId, authUserId) { const l = links.find((x) => x.auth_user_id === authUserId); return l ? [{ ...l }] : []; },
    // `findUser` devolve LINHAS (array), como o driver: o `resolveUser` do
    // serviço faz `Array.isArray(rows) && rows.length === 1`. Devolver um objeto
    // faria toda concessão cair em "usuário não encontrado".
    async findUser() { return [{ auth_user_id: 'u1', full_name: 'Maria Souza', email: 'maria@ruy.com', status: 'ativo' }]; },
    async listUsers() { return [{ auth_user_id: 'u1', full_name: 'Maria Souza', email: 'maria@ruy.com', status: 'ativo' }]; },
    async upsertAccess(d) {
      const novo = { auth_user_id: d.authUserId, account_id: d.accountId, active: d.active === true, ...d.permissions };
      const i = links.findIndex((x) => x.auth_user_id === d.authUserId);
      if (i >= 0) links[i] = novo; else links.push(novo);
      return { ...novo };
    },
    async updateAccess(d) {
      const alvo = links.find((x) => x.auth_user_id === d.authUserId);
      if (!alvo) throw Object.assign(new Error('não achou'), { code: 'NOT_FOUND' });
      Object.assign(alvo, d.permissions, { active: d.active === true });
      return { ...alvo };
    },
    async appendAudit() { return {}; },
  };
  const service = createAccountAdminService({
    store,
    verifyIdentity: async () => ({ id: 'op-1', active: true, app_metadata: { system_role: role } }),
    canAdminAnyAccount: async () => vinculo,
  });
  return createSocialAdminHandler({
    service,
    store,
    verifyIdentity: async (h) => (h === 'Bearer bom' ? { id: 'op-1', active: true, app_metadata: { system_role: role } } : null),
    canAdminAnyAccount: async () => vinculo,
    ...(limiter ? { limiter } : {}),
  });
}
const chamar = (handler, path, { method = 'GET', body, token = 'Bearer bom' } = {}) => handler(new Request(`https://api.invalid${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}));

test('http: 401 sem sessÃ£o', async () => {
  assert.equal((await montarHandler()(new Request('https://api.invalid/social-admin/accounts'))).status, 401);
});
test('http: 403 sem configure no system_role', async () => {
  assert.equal((await chamar(montarHandler({ role: 'viewer' }), '/social-admin/accounts')).status, 403);
});
test('http: 403 sem can_admin na conta, e nunca 200 com lista vazia', async () => {
  const r = await chamar(montarHandler({ vinculo: false }), '/social-admin/accounts/acc-1/access');
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, 'forbidden');
});
test('http: lista de contas devolve id externo redigido', async () => {
  const r = await chamar(montarHandler(), '/social-admin/accounts');
  assert.equal(r.status, 200);
  const { accounts } = await r.json();
  assert.equal(accounts[0].external_account_id, `17${'•'.repeat(4)}00`);
test('http: payload invÃ¡lido Ã© 400, nÃ£o 500', async () => {
  const h = montarHandler();
  assert.equal((await chamar(h, '/social-admin/accounts/acc-1/grant', { method: 'POST', body: { can_view: true } })).status, 400, 'sem auth_user_id');
  assert.equal((await chamar(h, '/social-admin/accounts/acc-1/grant', { method: 'POST', body: { auth_user_id: 'u2', can_view: 'sim' } })).status, 400, 'permissÃ£o nÃ£o booleana');
});
test('http: nÃ£o existe CRUD genÃ©rico nem rota de bootstrap', async () => {
  const h = montarHandler();
  for (const p of ['/social-admin/query', '/social-admin/bootstrap', '/social-admin/accounts/acc-1/bootstrap', '/social-admin/accounts/acc-1/exec']) {
    assert.equal((await chamar(h, p, { method: 'POST', body: { sql: 'select 1' } })).status, 404, `${p} nÃ£o pode existir`);
  }
});
test('http: rate limit devolve 429', async () => {
  const h = montarHandler({ limiter: createRateLimiter({ limit: 2, windowMs: 60000 }) });
  await chamar(h, '/social-admin/accounts/acc-1/grant', { method: 'POST', body: { auth_user_id: 'u1', can_view: true } });
  await chamar(h, '/social-admin/accounts/acc-1/grant', { method: 'POST', body: { auth_user_id: 'u2', can_view: true } });
  assert.equal((await chamar(h, '/social-admin/accounts/acc-1/grant', { method: 'POST', body: { auth_user_id: 'u3', can_view: true } })).status, 429);
});
test('http: CORS fica no host, nÃ£o neste handler', async () => {
  const h = montarHandler();
  const r = await h(new Request('https://api.invalid/social-admin/accounts', { headers: { origin: 'https://malicioso.example' } }));
  // Quem decide CORS Ã© o `aiHost`, onde a allowlist vive. Duplicar aqui criaria
  // duas polÃ­ticas de origem â€” e a mais frouxa venceria.
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
test('http: namespace separado de /social-ai', async () => {
  const h = montarHandler();
  assert.equal((await chamar(h, '/social-ai/draft', { method: 'POST', body: { commentId: 'c1' } })).status, 404);
  assert.equal((await chamar(h, '/social-admin/accounts')).status, 200);
});
test('http: erro nÃ£o vaza host interno, senha ou SQL', async () => {
  const segredo = 'conexÃ£o recusada em 10.0.0.5:5432 com senha hunter2';
  const store = { async listAccountAccess() {}, async listCandidates() {} };
  const h = createSocialAdminHandler({
    service: { listAccounts: () => { throw Object.assign(new Error(segredo), { code: 'UNAVAILABLE' }); } },
    store,
    verifyIdentity: async () => ({ id: 'op-1', active: true, app_metadata: { system_role: 'admin' } }),
    canAdminAnyAccount: async () => true,
  });
  const r = await h(new Request('https://api.invalid/social-admin/accounts', { headers: { authorization: 'Bearer bom' } }));
  const corpo = JSON.stringify(await r.json());
  assert.equal(r.status, 503);
  assert.ok(!corpo.includes('10.0.0.5'), 'host interno nÃ£o pode vazar');
  assert.ok(!corpo.includes('hunter2'), 'senha nÃ£o pode vazar');
  assert.ok(!corpo.toLowerCase().includes('select'), 'SQL nÃ£o pode vazar');
});
test('handler falha fechado sem store, service e verifyIdentity', () => {
  assert.throws(() => createSocialAdminHandler({ service: {}, verifyIdentity: () => {} }), /store/);
  assert.throws(() => createSocialAdminHandler({ service: {}, store: {} }), /service|verifyIdentity/);
  assert.throws(() => createSocialAdminHandler({ service: {}, store: {} }), /verifyIdentity/);
});
test('o store ausente nunca cai para memÃ³ria em produÃ§Ã£o', async () => {
  // O host Ã© quem decide; aqui verificamos que o store NÃƒO tem fallback prÃ³prio.
  const src = await readFile(new URL('../server/social/accountAccessStore.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('createSocialAccessStore requer withClient()'), 'sem withClient, o store nÃ£o sobe');
  assert.ok(!/new Map\(\)|memoryStore|fallbackStore/.test(src), 'nÃ£o pode existir store em memÃ³ria no store de produÃ§Ã£o');
});


});
test('http: grant, update, revoke e reactivate respondem 200', async () => {
  const h = montarHandler();
  const grant = await chamar(h, '/social-admin/accounts/acc-1/grant', { method: 'POST', body: { auth_user_id: 'u2', can_view: true } });
  assert.equal(grant.status, 200);
  assert.equal((await grant.json()).access.auth_user_id, 'u2');
  const upd = await chamar(h, '/social-admin/accounts/acc-1/access', { method: 'PATCH', body: { auth_user_id: 'u2', can_reply: true } });
  assert.equal(upd.status, 200);
  assert.deepEqual((await upd.json()).adjusted, ['→can_view'], 'a correção de hierarquia precisa voltar para a UI');
  const rev = await chamar(h, '/social-admin/accounts/acc-1/revoke', { method: 'POST', body: { auth_user_id: 'u2' } });
  assert.equal((await rev.json()).access.active, false);
  assert.equal((await chamar(h, '/social-admin/accounts/acc-1/reactivate', { method: 'POST', body: { auth_user_id: 'u2', can_view: true } })).status, 200);
});
