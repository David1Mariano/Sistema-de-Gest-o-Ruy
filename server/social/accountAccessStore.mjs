// ===========================================================================
// STORE POSTGRES DE ACESSO SOCIAL (Fase 8).
//
// Implementa o contrato que `createAccountAdminService` consome, sobre as
// tabelas `social_account_access` e `social_account_access_audit` (migration
// PROPOSTA, NÃO APLICADA).
//
// Duas decisões que valem para tudo aqui:
//
// 1. TUDO QUE ESCREVE PASSA POR `transaction()`. Concessão + auditoria na MESMA
//    transação: se a auditoria falhar, a concessão não fica aplicada pela
//    metade. Um acesso concedido sem rastro é um acesso que ninguém pode
//    explicar depois.
//
// 2. NENHUMA FALHA VIRA "VAZIO". Erro de banco propaga; resposta fora do
//    formato é `MALFORMED_RESPONSE`. Devolver lista vazia num erro faria a tela
//    mostrar "ninguém tem acesso" quando o banco é que está fora do ar.
//
// Concorrência: `select ... for update` serializa quem mexe no mesmo vínculo, e
// o `insert ... on conflict do nothing` + checagem de linhas devolvidas
// transforma a corrida de concessão em erro explícito, em vez de exceção opaca
// do Postgres.
// ===========================================================================
import { SocialError } from './providerBase.mjs';

const TABLES = {
  access: 'public.social_account_access',
  audit: 'public.social_account_access_audit',
  accounts: 'public.social_accounts',
};

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';
// Chave fixa de advisory lock ("RUYA"). Fixa de propósito: o lock precisa ser
// o mesmo para qualquer processo que rode o bootstrap.
const ADMIN_POOL = 0x52555941;

const fail = (code, message) => new SocialError(code, message);

export const STORE_MALFORMED = 'MALFORMED_RESPONSE';
export const STORE_NOT_READY = 'ACCESS_SCHEMA_NOT_READY';

// Traduz código do Postgres para o vocabulário de negócio. O frontend e os
// testes não precisam saber dialeto de driver.
function translate(error) {
  if (error?.code === UNDEFINED_TABLE || error?.code === UNDEFINED_COLUMN) {
    return fail(STORE_NOT_READY, 'Schema de acesso social não aplicado');
  }
  return error;
}

const rowsOrMalformed = (result) => {
  if (!result || !Array.isArray(result.rows)) throw fail(STORE_MALFORMED, 'Resposta inesperada do banco');
  return result.rows;
};

export function createSocialAccessStore({ withClient, now = () => new Date().toISOString() } = {}) {
  if (typeof withClient !== 'function') throw new Error('createSocialAccessStore requer withClient()');

  async function open() {
    const client = await withClient();
    if (!client?.query) throw new Error('withClient() precisa devolver um client com query()');
    return client;
  }

  const shape = (row) => ({
    account_id: row.account_id,
    auth_user_id: row.auth_user_id,
    scope_role: row.scope_role,
    can_view: row.can_view === true,
    can_reply: row.can_reply === true,
    can_approve_ai: row.can_approve_ai === true,
    can_admin: row.can_admin === true,
    active: row.active === true,
    revoked_at: row.revoked_at ?? null,
  });

  // ── leituras ──────────────────────────────────────────────────────────────
  async function listAccounts(client) {
    const result = await client.query(
      `select a.id, a.provider, a.display_name, a.status, a.external_account_id,
              (select count(*) from ${TABLES.access} x
                where x.account_id = a.id and x.active) as access_count
         from ${TABLES.accounts} a
        order by a.provider, a.display_name`,
    );
    return rowsOrMalformed(result).map((row) => ({
      id: row.id,
      provider: row.provider,
      display_name: row.display_name,
      status: row.status,
      external_account_id: row.external_account_id ?? null,
      // Postgres devolve `count` como string; converter evita que a UI receba
      // "1" e mostre "1 pessoas".
      access_count: Number(row.access_count) || 0,
    }));
  }

  async function findAccount(client, accountId) {
    const result = await client.query(
      `select id, provider, display_name, status, external_account_id from ${TABLES.accounts} where id = $1`,
      [accountId],
    );
    const rows = rowsOrMalformed(result);
    return rows.length === 1 ? rows[0] : null;
  }

  async function listAccess(client, accountId) {
    const result = await client.query(
      `select account_id, auth_user_id, scope_role, can_view, can_reply, can_approve_ai,
              can_admin, active, revoked_at
         from ${TABLES.access} where account_id = $1 order by created_at desc`,
      [accountId],
    );
    return rowsOrMalformed(result).map(shape);
  }

  async function findAccessRow(client, accountId, authUserId) {
    // `for update` serializa dois edits do mesmo vínculo. Sem isso, dois
    // operadores poderiam sobrescrever as permissões um do outro em silêncio.
    const result = await client.query(
      `select account_id, auth_user_id, scope_role, can_view, can_reply, can_approve_ai,
              can_admin, active, revoked_at
         from ${TABLES.access} where account_id = $1 and auth_user_id = $2 for update`,
      [accountId, authUserId],
    );
    const rows = rowsOrMalformed(result);
    if (rows.length === 0) return null;
    if (rows.length > 1) throw fail('DUPLICATE_ACCESS', 'Vínculo duplicado detectado');
    return shape(rows[0]);
  }

  // Usuários vêm do inventário legado (`records`, entidade AuthUser), o mesmo
  // que `authAdapter.me()` consulta. O `auth_user_id` do Auth é o que o
  // vínculo referencia; o id legado é o que o inventário conhece.
  async function listUsers(client) {
    const result = await client.query(
      `select id, data->>'auth_user_id' as auth_user_id, data->>'full_name' as full_name,
              data->>'email' as email, data->>'status' as status
         from public.records where entity = 'AuthUser' order by data->>'full_name' nulls last`,
    );
    return rowsOrMalformed(result);
  }

  async function findUser(client, authUserId) {
    const result = await client.query(
      `select id, data->>'auth_user_id' as auth_user_id, data->>'full_name' as full_name,
              data->>'email' as email, data->>'status' as status
         from public.records where entity = 'AuthUser' and data->>'auth_user_id' = $1`,
      [authUserId],
    );
    const rows = rowsOrMalformed(result);
    return rows.length === 1 ? rows[0] : null;
  }

  /** Resolução por nome/e-mail, para o bootstrap NÃO depender de digitar UUID. */
  async function findUsersByTerm(client, term) {
    const result = await client.query(
      `select id, data->>'auth_user_id' as auth_user_id, data->>'full_name' as full_name,
              data->>'email' as email, data->>'status' as status
         from public.records
        where entity = 'AuthUser'
          and (data->>'full_name' ilike $1 or data->>'email' ilike $1 or data->>'auth_user_id' = $2)`,
      [`%${term}%`, term],
    );
    return rowsOrMalformed(result);
  }

  async function findAccountsByTerm(client, term) {
    const result = await client.query(
      `select id, provider, display_name, status, external_account_id
         from ${TABLES.accounts}
        where display_name ilike $1 or external_account_id = $2 or id::text = $2`,
      [`%${term}%`, term],
    );
    return rowsOrMalformed(result);
  }

  // ── escritas ──────────────────────────────────────────────────────────────
  async function insertAccess(client, { accountId, provider, authUserId, permissions, active }) {
    const result = await client.query(
      `insert into ${TABLES.access}
         (account_id, provider, auth_user_id, scope_role, can_view, can_reply, can_approve_ai,
          can_admin, active, revoked_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       on conflict (account_id, auth_user_id) do nothing
       returning account_id, auth_user_id, scope_role, can_view, can_reply, can_approve_ai,
                 can_admin, active, revoked_at`,
      [accountId, provider, authUserId, permissions.scope_role ?? 'operator',
        permissions.can_view, permissions.can_reply, permissions.can_approve_ai, permissions.can_admin,
        active, active ? null : now(), now()],
    );
    const rows = rowsOrMalformed(result);
    // Nenhuma linha = outro processo ganhou a corrida. O `unique` impediu a
    // duplicata; cabe a nós devolver o erro que o operador entende.
    if (rows.length === 0) throw fail('ALREADY_EXISTS', 'Este usuário já tem vínculo com esta conta');
    return shape(rows[0]);
  }

  async function updateAccessRow(client, { accountId, authUserId, permissions, active, revokedAt = null }) {
    const result = await client.query(
      `update ${TABLES.access}
          set can_view = $3, can_reply = $4, can_approve_ai = $5, can_admin = $6,
              active = $7, revoked_at = $8, updated_at = $9
        where account_id = $1 and auth_user_id = $2
        returning account_id, auth_user_id, scope_role, can_view, can_reply, can_approve_ai,
                  can_admin, active, revoked_at`,
      [accountId, authUserId, permissions.can_view, permissions.can_reply, permissions.can_approve_ai,
        permissions.can_admin, active, revokedAt, now()],
    );
    const rows = rowsOrMalformed(result);
    if (rows.length === 0) throw fail('NOT_FOUND', 'Vínculo não encontrado');
    return shape(rows[0]);
  }


  /**
   * Auditoria. `origin` distingue o caminho one-shot do bootstrap das operações
   * da tela: são ações de risco diferente e precisam ser distinguíveis numa
   * auditoria. Nenhum token, senha ou chave entra em `details`.
   */
  async function appendAudit(client, { action, accountId, provider, targetUserId, operatorUserId, details = null, origin = 'ui' }) {
    const result = await client.query(
      `insert into ${TABLES.audit}
         (account_id, provider, action, target_user_id, operator_user_id, details, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, action, account_id, target_user_id, operator_user_id, created_at`,
      [accountId, provider, action, targetUserId, operatorUserId, JSON.stringify({ origin, ...details }), now()],
    );
    const rows = rowsOrMalformed(result);
    if (rows.length !== 1) throw fail(STORE_MALFORMED, 'Falha ao registrar auditoria');
    return rows[0];
  }

  /**
   * Advisory lock transacional: serializa bootstraps concorrentes no MESMO
   * banco. Dois operadores rodando o script ao mesmo tempo não conseguem criar
   * dois "primeiros administradores" — o segundo espera e então vê que já
   * existe, e para. `pg_advisory_xact_lock` é liberado no commit/rollback, então
   * não sobra lock órfão se o processo morrer no meio.
   */
  async function lockBootstrap(client) {
    await client.query('select pg_advisory_xact_lock($1)', [ADMIN_POOL]);
  }

  /** Existe algum admin ativo? É o que fecha o bootstrap para sempre. */
  async function countActiveAdmins(client) {
    const result = await client.query(
      `select count(*) as n from ${TABLES.access} where active and can_admin`,
    );
    const rows = rowsOrMalformed(result);
    return Number(rows[0]?.n) || 0;
  }

  /**
   * `work` recebe o objeto transacional com TODAS as operações. Concessão e
   * auditoria acontecem dentro do mesmo callback, então o commit é único.
   */
  async function transaction(work) {
    const client = await open();
    let begun = false;
    try {
      await client.query('begin');
      begun = true;
      const result = await work(txFor(client));
      await client.query('commit');
      begun = false;
      return result;
    } catch (error) {
      // ROLLBACK antes de traduzir: a tradução não pode mascarar o erro
      // original que o log do banco tem.
      if (begun) { try { await client.query('rollback'); } catch { /* conexão perdida */ } }
      throw translate(error);
    } finally {
      try { client.release?.(); } catch { /* pool já devolvido */ }
    }
  }

  function txFor(client) {
    return {
      listAccounts: () => listAccounts(client),
      findAccount: (id) => findAccount(client, id),
      listAccess: (id) => listAccess(client, id),
      findAccess: (accountId, authUserId) => findAccessRow(client, accountId, authUserId),
      listUsers: () => listUsers(client),
      findUser: (authUserId) => findUser(client, authUserId),
      findUsersByTerm: (term) => findUsersByTerm(client, term),
      findAccountsByTerm: (term) => findAccountsByTerm(client, term),
      insertAccess: (data) => insertAccess(client, data),
      updateAccess: (data) => updateAccessRow(client, data),
      appendAudit: (data) => appendAudit(client, data),
      lockBootstrap: () => lockBootstrap(client),
      countActiveAdmins: () => countActiveAdmins(client),
    };
  }

  return Object.freeze({
    transaction,
    // Leitura fora de transação para telas de consulta. Auditoria e escritas
    // exigem `transaction()`.
    read: (work) => transaction(work),
    STORE_NOT_READY,
    UNIQUE_VIOLATION,
    CHECK_VIOLATION,
  });
}
