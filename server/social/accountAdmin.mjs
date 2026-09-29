// ===========================================================================
// GESTÃO DE CONTAS E ACESSOS (Fase 7).
//
// O objetivo desta fase é tirar o cadastro de vínculos do SQL manual: a gestão
// cotidiana passa a acontecer por estas operações. O SQL continua necessário
// UMA vez, para criar o schema.
//
// Princípios que valem para TODAS as operações abaixo:
//  - fail-closed: schema ausente, conta inexistente, usuário inexistente,
//    resposta malformada ou erro de banco NUNCA viram "sem permissões" ou
//    "sem vínculos" silenciosos — viram erro controlado, com código que a tela
//    sabe mostrar;
//  - nada de CRUD genérico: cada método é uma operação de negócio com nome
//    próprio, validação própria e auditoria própria;
//  - revogar é `active=false` (histórico preservado), nunca DELETE;
//  - a tela NÃO é a segurança: cada operação revalida a permissão funcional
//    (`system_role`) e o vínculo de conta (`can_admin`) no backend.
// ===========================================================================
import { socialPermissions } from '../../src/lib/social/domain.js';
import { normalizeAccountPermissions, isUserActive } from '../../src/lib/social/accountAccess.js';
import { SocialError } from './providers.mjs';

const fail = (code, message) => new SocialError(code, message);
const ACCOUNTS_NOT_READY = 'ACCESS_SCHEMA_NOT_READY';

// Códigos do Postgres que significam "a tabela de acesso não existe ainda".
// Enquanto a migration não for aplicada, este é o resultado esperado — e a
// tela mostra "configuração pendente" em vez de uma lista vazia.
const NOT_READY_CODES = new Set([ACCOUNTS_NOT_READY, '42P01', 'PGRST205', '42883']);

// Ações registradas na auditoria. Espelham as quatro operações da tela, para que
// "quem tirou o acesso" também fique registrado.
// Ações registradas na auditoria. Espelham as quatro operações da tela, para que
// "quem tirou o acesso" também fique registrado.
export const ACCOUNT_AUDIT_ACTIONS = Object.freeze(['access_granted', 'access_updated', 'access_revoked', 'access_reactivated']);

export function createAccountAdminService({ verifyIdentity, store, canAdminAnyAccount = null, now = () => new Date().toISOString() } = {}) {
  // O store é um objeto de operações NOMEADAS, não uma função solta: cada
  // método tem nome de negócio, e é essa lista que se revê quando o backend
  // ganhar o cliente Postgres de verdade.
  const REQUIRED = ['listAccounts', 'listAccess', 'findAccess', 'findUser', 'listUsers', 'upsertAccess', 'updateAccess', 'appendAudit'];
  const faltando = REQUIRED.filter((m) => typeof store?.[m] !== 'function');
  if (faltando.length) throw new Error(`createAccountAdminService store incompleto: ${faltando.join(', ')}`);

  /**
   * Autorização da PRÓPRIA tela. Exige as DUAS coisas: `configure` no
   * `system_role` (o que o sistema já chama de administração) e `can_admin` em
   * ao menos uma conta. Esconder o botão no frontend não é autorização: cada
   * operação revalida aqui, e o `canAdminAnyAccount` volta a consultar a conta
   * real, então um admin sem vínculo admin é barrado mesmo sabendo o id.
   */
  async function authorizeAdmin(token, accountId) {
    const identity = await verifyIdentity(token);
    if (!identity?.id || identity.active !== true) throw fail('UNAUTHORIZED', 'Sessão inválida');
    if (!socialPermissions(identity.app_metadata?.system_role).configure) throw fail('FORBIDDEN', 'Sem permissão administrativa');
    if (accountId) {
      const allowed = typeof canAdminAnyAccount === 'function'
        ? await canAdminAnyAccount(identity.id, accountId, 'can_admin')
        : false;
      if (!allowed) throw fail('FORBIDDEN', 'Você não administra esta conta');
    }
    return identity;
  }

  // Traduz "tabela não existe" em um código estável, para a tela diferenciar
  // "schema pendente" de "banco fora do ar".
  const asFailure = (error, message) => {
    if (NOT_READY_CODES.has(error?.code)) throw fail(ACCOUNTS_NOT_READY, 'Schema de acesso social não aplicado');
    throw fail('UNAVAILABLE', message);
  };

  async function audit(identity, action, { accountId, authUserId, details = null } = {}) {
    if (!ACCOUNT_AUDIT_ACTIONS.includes(action)) throw new Error(`Ação de auditoria inválida: ${action}`);
    // Registro com operador, alvo e instante. Nunca token, senha ou segredo:
    // esta linha pode acabar em relatório.
    return store.appendAudit({
      action, account_id: accountId ?? null, target_user_id: authUserId ?? null,
      operator_user_id: identity.id, details, created_at: now(),
    });
  }

  async function findAccess(accountId, authUserId) {
    let rows;
    try { rows = await store.findAccess(accountId, authUserId); }
    catch (error) { asFailure(error, 'Não foi possível consultar o vínculo'); }
    // Resposta malformada é FALHA, não "sem vínculo". Devolver `null` aqui
    // trataria um banco quebrado como "este usuário não tem acesso" — e uma
    // concessão subsequente passaria a recriar a linha que existe.
    if (!Array.isArray(rows)) throw fail('UNAVAILABLE', 'Resposta inesperada ao consultar o vínculo');
    if (rows.length === 0) return null;
    // Duplicata é violação de `unique`: estado inconsistente, não "sem vínculo".
    if (rows.length > 1) throw fail('DUPLICATE_ACCESS', 'Vínculo duplicado detectado');
    return rows[0];
  }

  // A conta precisa EXISTIR antes de qualquer concessão. Sem esta checagem, um
  // `canAdminAnyAccount` permissivo demais deixaria criar vínculo para uma conta
  // que não está no banco.
  async function assertAccountExists(accountId) {
    let rows;
    try { rows = await store.listAccounts(); }
    catch (error) { asFailure(error, 'Não foi possível conferir as contas'); }
    if (!Array.isArray(rows)) throw fail('UNAVAILABLE', 'Resposta inesperada ao conferir as contas');
    if (!rows.some((c) => c.id === accountId)) throw fail('NOT_FOUND', 'Conta não encontrada');
  }

  async function resolveUser(authUserId) {
    const rows = await store.findUser(authUserId);
    return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  }

  return Object.freeze({
    async listAccounts(token) {
      await authorizeAdmin(token, null);
      let rows;
      try { rows = await store.listAccounts(); }
      catch (error) { asFailure(error, 'Não foi possível carregar as contas'); }
      if (!Array.isArray(rows)) throw fail('UNAVAILABLE', 'Resposta inesperada ao carregar contas');
      return rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        display_name: row.display_name,
        status: row.status,
        // O identificador externo viaja para que a tela possa EXIBI-LO
        // REDIGIDO. Sem este campo, `redactExternalId()` da Fase 7 recebia
        // `undefined` e toda conta aparecia como "não informado".
        external_account_id: row.external_account_id ?? null,
        access_count: Number.isInteger(row.access_count) ? row.access_count : 0,
      }));
    },

    async listAccountAccess(token, accountId) {
      if (!accountId) throw fail('INVALID_ACCOUNT', 'Conta não informada');
      await authorizeAdmin(token, accountId);
      // Abrir uma conta que não existe é erro, não "lista vazia": a tela não pode
      // sugerir "ninguém tem acesso" para uma conta inexistente.
      await assertAccountExists(accountId);
      let rows;
      try { rows = await store.listAccess(accountId); }
      catch (error) { asFailure(error, 'Não foi possível carregar os acessos'); }
      if (!Array.isArray(rows)) throw fail('UNAVAILABLE', 'Resposta inesperada ao carregar acessos');
      return rows;
    },

    /**
     * Concede acesso. Se já existir vínculo (ativo OU revogado), isto é uma
     * REATIVAÇÃO com novas permissões — nunca uma segunda linha. Duplicata
     * violaria `unique (account_id, auth_user_id)` e fragmentaria a auditoria.
     */
    async grantAccountAccess(token, { accountId, authUserId, permissions } = {}) {
      if (!accountId) throw fail('INVALID_ACCOUNT', 'Conta não informada');
      if (!authUserId) throw fail('INVALID_USER', 'Usuário não informado');
      const identity = await authorizeAdmin(token, accountId);
      await assertAccountExists(accountId);
      const pessoa = await resolveUser(authUserId);
      if (!pessoa) throw fail('INVALID_USER', 'Usuário não encontrado');
      // Usuário inativo no Auth não ganha acesso pela tela: ele não conseguiria
      // nem entrar no sistema para usar o que foi concedido.
      if (!isUserActive(pessoa.status)) throw fail('USER_INACTIVE', 'Usuário inativo não pode receber acesso');
      const normalized = normalizeAccountPermissions(permissions, true);
      if (normalized.invalid.length) throw fail('INVALID_PERMISSION', 'Permissão inválida');
      const existing = await findAccess(accountId, authUserId);
      if (existing && existing.active) throw fail('ALREADY_EXISTS', 'Este usuário já tem acesso a esta conta');
      if (existing) {
        const saved = await store.upsertAccess({ accountId, authUserId, ...normalized.permissions, active: true, revoked_at: null, operatorUserId: identity.id });
        await audit(identity, 'access_reactivated', { accountId, authUserId, details: { permissions: normalized.permissions, adjusted: normalized.adjusted } });
        return { ...saved, reactivated: true, adjusted: normalized.adjusted };
      }
      const saved = await store.upsertAccess({ accountId, authUserId, ...normalized.permissions, active: true, operatorUserId: identity.id });
      await audit(identity, 'access_granted', { accountId, authUserId, details: { permissions: normalized.permissions, adjusted: normalized.adjusted } });
      return { ...saved, reactivated: false, adjusted: normalized.adjusted };
    },

    /** Edita permissões de um vínculo EXISTENTE. Nunca cria. */
    async updateAccountAccess(token, { accountId, authUserId, permissions } = {}) {
      if (!accountId) throw fail('INVALID_ACCOUNT', 'Conta não informada');
      if (!authUserId) throw fail('INVALID_USER', 'Usuário não informado');
      const identity = await authorizeAdmin(token, accountId);
      await assertAccountExists(accountId);
      const existing = await findAccess(accountId, authUserId);
      if (!existing) throw fail('NOT_FOUND', 'Vínculo não encontrado');
      // Editar permissões de um vínculo revogado é permitido, mas ele continua
      // revogado: só `reactivateAccountAccess` devolve acesso. Assim, editar
      // "Aprovar IA" não ressuscita ninguém por acidente.
      const normalized = normalizeAccountPermissions(permissions, existing.active);
      if (normalized.invalid.length) throw fail('INVALID_PERMISSION', 'Permissão inválida');
      const saved = await store.updateAccess({ accountId, authUserId, ...normalized.permissions, active: existing.active, operatorUserId: identity.id });
      await audit(identity, 'access_updated', { accountId, authUserId, details: { before: existing, after: normalized.permissions, adjusted: normalized.adjusted } });
      return { ...saved, adjusted: normalized.adjusted };
    },

    /**
     * Revoga. `active=false` + `revoked_at` + TODAS as permissões em false,
     * coerente com a constraint `active_no_permission`. Nenhum DELETE: o
     * histórico de quem teve acesso continua respondendo "por quê".
     */
    async revokeAccountAccess(token, { accountId, authUserId } = {}) {
      if (!accountId) throw fail('INVALID_ACCOUNT', 'Conta não informada');
      if (!authUserId) throw fail('INVALID_USER', 'Usuário não informado');
      const identity = await authorizeAdmin(token, accountId);
      await assertAccountExists(accountId);
      const existing = await findAccess(accountId, authUserId);
      if (!existing) throw fail('NOT_FOUND', 'Vínculo não encontrado');
      if (!existing.active) return { ...existing, already_revoked: true };
      const zero = { can_view: false, can_reply: false, can_approve_ai: false, can_admin: false };
      const saved = await store.updateAccess({ accountId, authUserId, ...zero, active: false, revoked_at: now(), operatorUserId: identity.id });
      await audit(identity, 'access_revoked', { accountId, authUserId, details: { before: existing } });
      return { ...saved, already_revoked: false };
    },

    /** Reativação EXPLÍCITA. Nunca como efeito colateral de edição. */
    async reactivateAccountAccess(token, { accountId, authUserId, permissions } = {}) {
      if (!accountId) throw fail('INVALID_ACCOUNT', 'Conta não informada');
      if (!authUserId) throw fail('INVALID_USER', 'Usuário não informado');
      const identity = await authorizeAdmin(token, accountId);
      await assertAccountExists(accountId);
      const existing = await findAccess(accountId, authUserId);
      if (!existing) throw fail('NOT_FOUND', 'Vínculo não encontrado');
      if (existing.active) return { ...existing, already_active: true };
      const pessoa = await resolveUser(authUserId);
      if (!pessoa) throw fail('INVALID_USER', 'Usuário não encontrado');
      if (!isUserActive(pessoa.status)) throw fail('USER_INACTIVE', 'Usuário inativo não pode ser reativado');
      // Reativar sem reaproveitar permissões devolveria acesso zero, o que o
      // CHECK impede; por isso as permissões são reescolhidas na reativação.
      const normalized = normalizeAccountPermissions(permissions ?? existing, true);
      if (normalized.invalid.length) throw fail('INVALID_PERMISSION', 'Permissão inválida');
      const saved = await store.upsertAccess({ accountId, authUserId, ...normalized.permissions, active: true, revoked_at: null, operatorUserId: identity.id });
      await audit(identity, 'access_reactivated', { accountId, authUserId, details: { permissions: normalized.permissions, adjusted: normalized.adjusted } });
      return { ...saved, adjusted: normalized.adjusted };
    },

    /**
     * Candidatos para "Adicionar usuário". A escolha é por NOME, nunca por UUID
     * digitado: o `auth_user_id` viaja junto, mas o operador não precisa
     * conhecê-lo nem copiá-lo de lugar nenhum.
     */
    async listCandidates(token, accountId) {
      if (!accountId) throw fail('INVALID_ACCOUNT', 'Conta não informada');
      await authorizeAdmin(token, accountId);
      const rows = await store.listUsers();
      if (!Array.isArray(rows)) throw fail('UNAVAILABLE', 'Resposta inesperada ao carregar usuários');
      return rows.map((row) => ({
        auth_user_id: row.auth_user_id, full_name: row.full_name, email: row.email,
        status: row.status, active: isUserActive(row.status),
      }));
    },
  });
}

