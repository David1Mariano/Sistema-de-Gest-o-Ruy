// ===========================================================================
// TESTE INTEGRADO DO BACKEND SOCIAL (Fase 9).
//
// Este é o teste que atravessa a cadeia INTEIRA:
//
//   cliente frontend -> handler HTTP -> autorizacao -> store -> TRANSACAO
//
// Nenhum banco real, nenhuma rede real. Por baixo entram um cliente Postgres de
// mentira (que registra as queries) e um `request` de mentira (que resolve
// identidades por token).
//
// POR QUE EXISTE: os testes das fases anteriores testavam PEDAÇOS. Um teste do
// handler usava um store falso, e um teste do store usava um handler falso. Um
// desalinhamento entre os dois — um metodo com nome errado, um codigo de erro que
// so um dos lados conhece — passava os dois suites e quebrava em uso real. Aqui
// os dois lados sao o MESMO objeto, ligado pelo Adaptador.
// ===========================================================================
import { buildSocialAPI } from '../server/social/socialApi.mjs';
import { STORE_NOT_READY } from '../server/social/accountAccessStore.mjs';

let passou = 0; const falhas = [];
const ok = (nome, cond, detalhe = '') => {
  if (cond) { passou++; return; }
  falhas.push(`${nome}${detalhe ? ` :: ${detalhe}` : ''}`);
};
const eq = (nome, got, esp) => ok(nome, got === esp, `esperado ${JSON.stringify(esp)}, obtido ${JSON.stringify(got)}`);

const config = {
  supabaseUrl: 'https://projeto.supabase.co', supabaseAnonKey: 'anon-teste',
  ollamaBaseUrl: 'http://127.0.0.1:11434', ollamaModel: 'modelo-teste',
  ollamaTimeoutMs: 1000, aiProvider: 'ollama', origins: 'http://localhost:5173',
  rateLimit: 100, rateWindowMs: 60000, maxBodyBytes: 8192, enforceLocal: false,
  port: 0, host: '127.0.0.1', dbUrl: '',
};

// Banco em memoria: reproduz linhas, violacao de `unique` e o SQL como texto.
// O log de queries e o que permite AFIRMAR begin/commit/rollback.
// O usuario precisa de `status` ATIVO: `isUserActive` recusa inativo, e um
// fixture sem status seria barrado antes mesmo da escrita.
const PESSOA = { id: 'u9', email: 'u9@ruy.com', full_name: 'Pessoa Nove', status: 'ativo' };
// Escopo COMPLETO das quatro dimensoes. Conceder define o escopo inteiro;
// so `can_view` seria recusado por escopo incompleto.
const ESCOPO = { can_view: true, can_reply: false, can_approve_ai: false, can_admin: false };
const vinculoPadrao = { account_id: 'acc-1', auth_user_id: 'u9', scope_role: 'membro', can_view: true, can_reply: false, can_approve_ai: false, can_admin: false, active: true, revoked_at: null };
const dataDe = (params) => (params.length >= 2 ? { account_id: params[0], auth_user_id: params[1] } : {});

function criarBanco({ tabelasAusentes = [], accounts = [], access = [], users = [] } = {}) {
  const q = (t) => String(t || '').toLowerCase();
  const log = [];
  let auditoriaQuebrada = false;
  const client = {
    async query(texto, params = []) {
      const sql = q(texto);
      log.push({ sql: sql.trim(), params });
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [] };
      for (const t of tabelasAusentes) {
        if (sql.includes(t)) { const e = new Error(`relation "${t}" does not exist`); e.code = '42P01'; throw e; }
      }
      // Despacho pela TABELA DE FATO, extraida do ultimo `from` da sentenca.
      // Ler por "a query contem X" nao funciona aqui: `listAccounts` tem
      // `social_account_access` dentro de um SUBCOUNT e `social_accounts` como
      // fonte externa — o primeiro "contem" pegava a tabela errada, devolvia
      // `{count}` onde a tela esperava contas, e o administrador legitimo
      // aparecia sem nenhuma conta. Escritas (`insert into`/`update`) nao tem
      // `from`, entao sao resolvidas pelo proprio verbo.
      const froms = [...sql.matchAll(/from\s+(public\.[a-z_]+)/g)].map((m) => m[1]);
      const escrito = /\b(?:insert into|update)\s+(public\.[a-z_]+)/.exec(sql)?.[1] || null;
      const alvo = escrito || froms[froms.length - 1] || null;

      if (alvo === 'public.social_account_access_audit') {
        if (auditoriaQuebrada) { const e = new Error('auditoria falhou'); e.code = '23514'; throw e; }
        return { rows: [{ id: 'audit-1' }] };
      }
      if (alvo === 'public.social_account_access') {
        if (sql.includes('count(*)')) return { rows: [{ count: String(access.filter((a) => a.active).length) }] };
        // O verbo e o PRIMEIRO token, nunca um substring. `... for update`
        // contem "update": checar por substring fazia o SELECT de leitura ser
        // tratado como UPDATE, devolvia a linha generica (can_admin=false) e
        // fazia o administrador legitimo parecer sem vinculo em toda rota.
        const verbo = /^\s*(select|insert|update|delete)\b/.exec(sql)?.[1] || 'select';
        if (verbo === 'insert') {
          const [accountId, authUserId] = params;
          if (access.some((a) => a.account_id === accountId && a.auth_user_id === authUserId)) {
            const e = new Error('duplicate key'); e.code = '23505'; throw e;
          }
          return { rows: [{ ...vinculoPadrao, ...dataDe(params) }] };
        }
        if (verbo === 'update') return { rows: [{ ...vinculoPadrao, ...dataDe(params) }] };
        if (verbo === 'delete') return { rows: [] };
        if (sql.includes('order by created_at')) {
          return { rows: access.filter((a) => a.account_id === params[0]) };
        }
        return { rows: access.filter((a) => a.account_id === params[0] && a.auth_user_id === params[1]) };
      }
      if (alvo === 'public.social_accounts') {
        // `findAccount` filtra por id; `listAccounts` devolve todas.
        if (sql.includes('where') && params.length) return { rows: accounts.filter((c) => c.id === params[0]) };
        return { rows: accounts };
      }
      if (alvo === 'public.records') {
        if (!sql.includes('authuser')) return { rows: [] };
        return { rows: users.length === 0 ? [] : users.filter((u) => !params.length || u.id === params[0]) };
      }
      if (sql.includes('select 1') || sql.includes('pg_advisory')) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    },
    release() {},
  };
  return {
    // Cada `withClient()` entrega um client NOVO, como um pool de verdade.
    // Compartilhar um único client fazia duas transações concorrentes
    // embaralharem `begin`/`commit` e o resultado virava não-determinístico.
    withClient: async () => ({ query: client.query, release() {} }),
    log,
    setAuditoriaQuebrada(v) { auditoriaQuebrada = v; },
    consultar(t) { return log.filter((l) => l.sql.includes(t)).length; },
  };
}

// Identidades de teste. O verificador real exige DUAS coisas: `app_metadata`
// com `legacy_auth_user_id` + `system_role`, e uma linha em `AuthUser` com
// status ativo. Sem as duas nao existe identidade interna — e o teste precisa
// exercitar o caminho real, nao um atalho.
const IDENTIDADES = {
  'token-sem-configure': { id: 'u1', app_metadata: { system_role: 'user', legacy_auth_user_id: 'legacy-1' } },
  'token-configure-sem-admin': { id: 'u2', app_metadata: { system_role: 'admin', legacy_auth_user_id: 'legacy-2' } },
  'token-admin-valido': { id: 'u3', app_metadata: { system_role: 'admin', legacy_auth_user_id: 'legacy-3' } },
  'token-inativo': { id: 'u4', app_metadata: { system_role: 'admin', legacy_auth_user_id: 'legacy-4' } },
};
const INATIVOS = new Set(['inativo', 'inactive', 'disabled']);

async function requestFalso(url, init = {}) {
  const u = String(url);
  if (u.includes('/auth/v1/health')) return { ok: true, json: async () => ({}) };
  const token = String(init.headers?.authorization || '').replace('Bearer ', '');
  const identidade = IDENTIDADES[token];
  if (!identidade) return { ok: false, status: 401, json: async () => ({ code: 'invalid_token' }) };
  if (u.includes('/auth/v1/user')) return { ok: true, status: 200, json: async () => ({ ...identidade }) };
  if (u.includes('/rest/v1/records')) {
    // Linha de `AuthUser`. `token-inativo` responde com status inativo para
    // exercitar o caminho de sessão revogada.
    const status = token === 'token-inativo' ? 'inativo' : 'ativo';
    return { ok: true, status: 200, json: async () => [{ id: identidade.id, status }] };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}

async function comBackend(fn, opcoes = {}) {
  const banco = opcoes.banco || criarBanco();
  const server = buildSocialAPI({
    config: { ...config, ...(opcoes.config || {}) },
    request: requestFalso,
    withClient: opcoes.semBanco ? null : banco.withClient,
    service: opcoes.service || {
      draft: async () => ({ text: 'rascunho' }),
      health: async () => ({ state: 'ready', provider: 'ollama', model: 'modelo-teste', host: 'localhost' }),
    },
    sink: opcoes.sink || (() => {}),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = (caminho, { method = 'GET', token, body, origin } = {}) => fetch(`${base}${caminho}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(origin ? { origin } : {}),
      'content-type': 'application/json',
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  try { return await fn({ chamar, banco, base }); }
  finally {
    // `server.close()` sozinho ESPERA as conexoes keep-alive do `fetch` e o
    // processo nao termina. Fechar as conexoes e o que faz o teste acabar.
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

const CONTA = { id: 'acc-1', provider: 'instagram', display_name: 'RUY Oficial', status: 'connected', external_account_id: '1784abc', access_count: 1 };
const CONTA_ALHEIA = { id: 'acc-2', provider: 'facebook', display_name: 'Filial Norte', status: 'connected', external_account_id: '999zzz', access_count: 0 };
const vinculoAdmin = { account_id: 'acc-1', auth_user_id: 'u3', scope_role: 'admin', can_view: true, can_reply: true, can_approve_ai: true, can_admin: true, active: true, revoked_at: null };
const bancoBom = () => criarBanco({ accounts: [CONTA], access: [vinculoAdmin] });

// ══ 1. Sem sessao ═════════════════════════════════════════════════════════
await comBackend(async ({ chamar }) => {
  eq('1. sem sessao -> 401', (await chamar('/social-admin/accounts')).status, 401);
}, { banco: bancoBom() });

// ══ 2. Autenticado sem `configure` ═════════════════════════════════════════
await comBackend(async ({ chamar }) => {
  eq('2. sem configure -> 403', (await chamar('/social-admin/accounts', { token: 'token-sem-configure' })).status, 403);
}, { banco: bancoBom() });

// ══ 3. `configure` sem `can_admin` ═════════════════════════════════════════
// Regra central da Fase 9: role global nao substitui vinculo de conta.
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts', { token: 'token-configure-sem-admin' });
  const b = await r.json();
  eq('3. configure sem can_admin -> lista vazia', (b.accounts || []).length, 0);
  const g = await chamar('/social-admin/accounts/acc-1/access', { token: 'token-configure-sem-admin' });
  eq('3b. configure sem can_admin nao concede -> 403', g.status, 403);
}, { banco: bancoBom() });

// ══ 4. Admin valido: ve SO as contas que administra ══════════════════════
await comBackend(async ({ chamar, banco }) => {
  const r = await chamar('/social-admin/accounts', { token: 'token-admin-valido' });
  const b = await r.json();
  eq('4. admin valido -> 200', r.status, 200);
  eq('4b. lista so traz contas administradas', (b.accounts || []).length, 1);
  eq('4c. conta alheia nao aparece', (b.accounts || []).some((a) => a.id === CONTA_ALHEIA.id), false);
}, { banco: criarBanco({ accounts: [CONTA, CONTA_ALHEIA], access: [vinculoAdmin] }) });

// ══ 5. Schema ausente: 503 + codigo estavel, sem crash ════════════════════
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts', { token: 'token-admin-valido' });
  const b = await r.json();
  eq('5. schema ausente -> 503', r.status, 503);
  eq('5b. codigo ACCESS_SCHEMA_NOT_READY', b.error, STORE_NOT_READY);
}, { banco: criarBanco({ tabelasAusentes: ['social_account_access'] }) });

// ══ 6. Banco indisponivel: 503, nunca lista vazia ═════════════════════════
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts', { token: 'token-admin-valido' });
  const b = await r.json();
  eq('6. sem withClient -> 503', r.status, 503);
  // A diferenca importa: "banco fora" nao pode virar "nao ha contas".
  ok('6b. banco fora NAO vira lista vazia', !Array.isArray(b.accounts), `obtido ${JSON.stringify(b)}`);
}, { semBanco: true });

// ══ 7. Grant, dentro de transacao ═════════════════════════════════════════
// As permissoes vao no TOPO do corpo (e o que `permissionsFrom` le) e as QUATRO
// juntas: conceder define o escopo inteiro, enquanto editar e patch. Enviar
// so `can_view` seria recusado como escopo incompleto.
await comBackend(async ({ chamar, banco }) => {
  const r = await chamar('/social-admin/accounts/acc-1/grant', {
    method: 'POST', token: 'token-admin-valido',
    body: { auth_user_id: 'u9', ...ESCOPO },
  });
  eq('7. grant -> 200', r.status, 200);
  ok('7b. houve begin', banco.consultar('begin') > 0);
  ok('7c. houve commit', banco.consultar('commit') > 0);
  ok('7d. auditoria gravada', banco.consultar('social_account_access_audit') > 0);
}, { banco: criarBanco({ accounts: [CONTA], access: [vinculoAdmin], users: [PESSOA] }) });

// ══ 8. Grant duplicado ════════════════════════════════════════════════════
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts/acc-1/grant', {
    method: 'POST', token: 'token-admin-valido',
    body: { auth_user_id: 'u9', ...ESCOPO },
  });
  ok('8. grant duplicado -> 4xx', r.status >= 400 && r.status < 500, `status ${r.status}`);
}, { banco: criarBanco({ accounts: [CONTA], access: [vinculoAdmin, { ...vinculoAdmin, auth_user_id: 'u9', can_admin: false }] }) });

// ══ 9. Update de permissoes ══════════════════════════════════════════════
await comBackend(async ({ chamar, banco }) => {
  const r = await chamar('/social-admin/accounts/acc-1/access', {
    method: 'PATCH', token: 'token-admin-valido',
    body: { auth_user_id: 'u9', can_view: true, can_admin: true },
  });
  ok('9. update -> 2xx', r.status >= 200 && r.status < 300, `status ${r.status}`);
  ok('9b. update gravou auditoria', banco.consultar('social_account_access_audit') > 0);
}, { banco: criarBanco({ accounts: [CONTA], access: [vinculoAdmin, { ...vinculoAdmin, auth_user_id: 'u9', can_admin: false }] }) });

// ══ 10. Revoke ════════════════════════════════════════════════════════════
await comBackend(async ({ chamar, banco }) => {
  const r = await chamar('/social-admin/accounts/acc-1/revoke', {
    method: 'POST', token: 'token-admin-valido', body: { auth_user_id: 'u9' },
  });
  ok('10. revoke -> 2xx', r.status >= 200 && r.status < 300, `status ${r.status}`);
  // Revogar e `active=false`, nunca DELETE: o historico precisa sobreviver.
  ok('10b. revoke usa update', banco.log.some((l) => l.sql.includes('update') && l.sql.includes('social_account_access')), 'sem update');
  ok('10c. revoke nao emite delete', !banco.log.some((l) => l.sql.trim().startsWith('delete')), 'delete encontrado');
}, { banco: criarBanco({ accounts: [CONTA], access: [vinculoAdmin, { ...vinculoAdmin, auth_user_id: 'u9' }] }) });

// ══ 11. Reactivate ════════════════════════════════════════════════════════
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts/acc-1/reactivate', {
    method: 'POST', token: 'token-admin-valido', body: { auth_user_id: 'u9', can_view: true },
  });
  ok('11. reactivate -> 2xx', r.status >= 200 && r.status < 300, `status ${r.status}`);
}, { banco: criarBanco({ accounts: [CONTA], access: [vinculoAdmin, { ...vinculoAdmin, auth_user_id: 'u9', active: false, revoked_at: '2026-01-01' }], users: [PESSOA] }) });

// ══ 12. Falha de auditoria faz ROLLBACK da alteracao ══════════════════════
// O teste que mais importa: se a auditoria falha, a concessao NAO pode ficar.
//
// A prova e em tres partes, e a ordem importa:
//   1. o INSERT foi TENTADO (a concessao chegou a escrever);
//   2. a auditoria foi tentada e falhou;
//   3. houve ROLLBACK, e nenhum commit depois dele.
// Sem (1), o teste passaria trivialmente porque nada foi escrito.
await comBackend(async ({ chamar, banco }) => {
  banco.setAuditoriaQuebrada(true);
  const r = await chamar('/social-admin/accounts/acc-1/grant', {
    method: 'POST', token: 'token-admin-valido',
    body: { auth_user_id: 'u9', ...ESCOPO },
  });
  ok('12. auditoria falha -> erro', r.status >= 400, `status ${r.status}`);
  // Normaliza espacos: o SQL real quebra a linha DEPOIS do nome da tabela
  // (`insert into public.social_account_access\n  (account_id, ...)`), e um
  // `startsWith` com espaco fixo nao encontraria nada.
  const sqlDe = (l) => l.sql.replace(/\s+/g, ' ');
  const tentouGravar = banco.log.some((l) => sqlDe(l).startsWith('insert into public.social_account_access '));
  ok('12a. a concessao chegou a tentar gravar', tentouGravar, 'nenhum insert no vinculo');
  ok('12b. a auditoria foi tentada', banco.log.some((l) => l.sql.includes('social_account_access_audit')), 'auditoria nao chamada');
  ok('12c. houve rollback', banco.consultar('rollback') > 0, 'sem rollback');
  const ultimo = banco.log.map((l) => l.sql).filter((s) => ['begin', 'commit', 'rollback'].includes(s)).pop();
  ok('12d. a transacao terminou em rollback, nao em commit', ultimo === 'rollback', `ultimo comando: ${ultimo}`);
}, { banco: criarBanco({ accounts: [CONTA], access: [vinculoAdmin], users: [PESSOA] }) });

// ══ 13. Conta inexistente: 403, nao 404 ═══════════════════════════════════
// A conta e conferida DEPOIS do vinculo. Sem vinculo, a resposta e 403 — e isso
// e o comportamento CORRETO: um 404 confirmaria a quem nao administra que a
// conta existe, virando oraculo de existencia.
await comBackend(async ({ chamar }) => {
  eq('13. conta inexistente -> 403 (nao revela existencia)', (await chamar('/social-admin/accounts/acc-inexistente/access', { token: 'token-admin-valido' })).status, 403);
}, { banco: bancoBom() });

// ══ 13b. Grant em conta que nao existe: 404, com vinculo válido ═══════════
// Aqui o vinculo existe de fato (o fake devolve a linha), então a operacao
// avanca e a ausencia da conta aparece como 404.
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts/acc-inexistente/grant', {
    method: 'POST', token: 'token-admin-valido', body: { auth_user_id: 'u9', can_view: true },
  });
  ok('13b. grant em conta inexistente -> 404', r.status === 404, `status ${r.status}`);
}, { banco: criarBanco({ accounts: [CONTA], access: [{ ...vinculoAdmin, account_id: 'acc-inexistente' }], users: [PESSOA] }) });

// ══ 14. Usuario inexistente: INVALID_USER (400) ═══════════════════════════
// O serviço responde 400 e nao 404 de proposito: "404" confirmaria a quem
// administra a conta que aquele id NAO existe no inventario, e essa busca
// livre por pessoas e a mesma que o bootstrap usa.
await comBackend(async ({ chamar }) => {
  const r = await chamar('/social-admin/accounts/acc-1/grant', {
    method: 'POST', token: 'token-admin-valido',
    body: { auth_user_id: 'u-inexistente', can_view: true },
  });
  eq('14. usuario inexistente -> 400 INVALID_USER', r.status, 400);
}, { banco: bancoBom() });

// ══ 15. Coexistencia dos dois namespaces no MESMO processo ═════════════════
// `/social-health` e o health do HOST (sem sessao, so leitura de estado).
// `/social-ai/health` e o do NAMESPACE de IA, que exige identidade e
// `approve_ai` — por isso leva token. Os tres convivem na mesma porta.
await comBackend(async ({ chamar }) => {
  eq('15. /social-health (host) -> 200 sem sessao', (await chamar('/social-health')).status, 200);
  eq('15b. /social-ai/health coexiste', (await chamar('/social-ai/health', { token: 'token-admin-valido' })).status, 200);
  eq('15c. /social-admin/accounts coexiste', (await chamar('/social-admin/accounts', { token: 'token-admin-valido' })).status, 200);
  // Um namespace nao pode satisfazer rota do outro.
  const d = await chamar('/social-ai/draft', { method: 'POST', token: 'token-admin-valido', body: { comment_id: 'c1' } });
  ok('15d. /social-ai/draft nao e 404 do host', d.status !== 404, `status ${d.status}`);
  eq('15e. rota admin inexistente -> 404', (await chamar('/social-admin/nao-existe', { token: 'token-admin-valido' })).status, 404);
  eq('15f. rota fora dos dois namespaces -> 404', (await chamar('/outra-coisa')).status, 404);
}, { banco: bancoBom() });

// ══ 16. Seguranca: nada sensivel em resposta HTTP ════════════════════════
const conexaoSecreta = 'postgres://usuario:senhasupersecreta@host.interno:5432/banco';
await comBackend(async ({ chamar }) => {
  const texto = JSON.stringify(await (await chamar('/social-admin/accounts', { token: 'token-admin-valido' })).json());
  ok('16. resposta sem senha', !texto.includes('senhasupersecreta'), 'senha vazou');
  ok('16b. resposta sem host interno', !texto.includes('host.interno'), 'host vazou');
  ok('16c. resposta sem token', !texto.includes('token-admin-valido'), 'token vazou');
  ok('16d. resposta sem URL de conexao', !texto.includes('postgres://'), 'connection string vazou');
}, { banco: bancoBom(), config: { dbUrl: conexaoSecreta } });

// ══ 17. CORS e payload limit no host compartilhado ════════════════════════
await comBackend(async ({ chamar }) => {
  const liberada = await chamar('/social-ai/health', { origin: 'http://localhost:5173', token: 'token-admin-valido' });
  eq('17. origem permitida -> ok', liberada.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const mau = await chamar('/social-ai/health', { origin: 'http://malvado.example', token: 'token-admin-valido' });
  eq('17b. origem nao permitida -> 403', mau.status, 403);
  ok('17c. origem bloqueada sem header ACAO', mau.headers.get('access-control-allow-origin') === null, 'ACAO em origem bloqueada');
  const grande = await chamar('/social-admin/accounts', { method: 'POST', token: 'token-admin-valido', body: 'x'.repeat(20000) });
  eq('17d. payload grande -> 413', grande.status, 413);
}, { banco: bancoBom() });

// ══ 18. Log operacional sem payload ═══════════════════════════════════════
{
  const linhas = [];
  await comBackend(async ({ chamar }) => {
    await chamar('/social-admin/accounts', { token: 'token-admin-valido' });
  }, { banco: bancoBom(), sink: (l) => linhas.push(l) });
  const texto = JSON.stringify(linhas);
  ok('18. log sem token', !texto.includes('token-admin-valido'), 'token no log');
  ok('18b. log registra status', linhas.some((l) => l.status === 200), 'sem status');
}

console.log(`integrado: ${passou} ok, ${falhas.length} falhas`);
for (const f of falhas) console.log(`  FALHA ${f}`);
if (falhas.length) process.exit(1);
