// ---------------------------------------------------------------------------
// verifyIdentity REAL, do lado do servidor.
//
// A UI já valida sessão em `src/lib/authAdapter.js` (`me()`), mas isso é
// conveniência para o operador, NÃO autorização: o navegador pode ser enganado. Este
// módulo revalida o MESMO contrato no backend, com o JWT do usuário.
//
// Mecanismo real do projeto (nenhum inventado):
//   1. `GET {SUPABASE_URL}/auth/v1/user` com o bearer do usuário. O Supabase
//      valida a assinatura e devolve o `app_metadata`, que só o painel do
//      Supabase/admin escreve — o cliente não consegue forjá-lo.
//   2. `GET {SUPABASE_URL}/rest/v1/records?entity=eq.AuthUser...` com o MESMO
//      token do usuário, espelhando `authAdapter.me()`, para exigir o vinculo
//      legado e recusar perfil inativo.
//
// NUNCA aceitamos `userId`, `role` ou `app_metadata` do corpo da requisição.
// Sem token, com token invalido ou sem vinculo, a resposta e' `null` e o
// handler responde 401/403 — falha fechada por construcao.
// ---------------------------------------------------------------------------

const semVinculo = { id: null, active: false, app_metadata: {} };
const INATIVOS = ['inactive', 'inativo', 'disabled', 'bloqueado', 'desativado'];

function bearerDe(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

function assertBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('SUPABASE_URL nao configurada no backend');
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('SUPABASE_URL invalida');
  if (url.username || url.password || url.search || url.hash) throw new Error('SUPABASE_URL invalida');
  return url.origin.replace(/\/+$/, '');
}

/**
 * @param {object} o
 * @param {string} o.url      SUPABASE_URL (somente backend)
 * @param {string} o.anonKey  SUPABASE_ANON_KEY publica — serve para chamar Auth;
 *                           NUNCA a service_role, que nao vai no backend local
 *                           e nao seria verificada contra RLS de usuario.
 * @param {Function} o.request injetavel nos testes; nunca `fetch` cru.
 */
export function createSupabaseIdentityVerifier({ url, anonKey, request = fetch, now = () => new Date().toISOString() } = {}) {
  if (typeof request !== 'function') throw new Error('createSupabaseIdentityVerifier requer request()');
  const base = assertBaseUrl(url);
  if (typeof anonKey !== 'string' || !anonKey.trim()) throw new Error('SUPABASE_ANON_KEY nao configurada no backend');
  const key = anonKey.trim();

  return async function verifyIdentity(authorization) {
    const token = bearerDe(authorization);
    if (!token) return null;
    // Headers de rede, nunca o token em log: este modulo nao loga nada.
    const headers = { apikey: key, authorization: `Bearer ${token}`, accept: 'application/json' };

    let user = null;
    try {
      const response = await request(`${base}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return null;
      user = (await response.json()) || null;
    } catch { return null; }
    if (!user?.id) return null;

    // app_metadata e' administrado no servidor do Supabase. `user_metadata` e'
    // editavel pelo proprio usuario e por isso NUNCA e' lido aqui.
    const meta = user.app_metadata || {};
    const legacyId = meta.legacy_auth_user_id;
    const systemRole = meta.system_role;
    // Vinculo legado e papel sao obrigatorios: sem eles nao existe identidade
    // interna sobre a qual autorizar.
    if (!legacyId || !systemRole) return semVinculo;

    let rows = null;
    try {
      const query = new URLSearchParams({
        entity: 'eq.AuthUser',
        id: `eq.${legacyId}`,
        select: 'id,full_name:data->>full_name,status:data->>status',
      });
      const response = await request(`${base}/rest/v1/records?${query}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!response.ok) return semVinculo;
      rows = await response.json();
    } catch { return semVinculo; }
    if (!Array.isArray(rows) || rows.length !== 1) return semVinculo;

    const status = String(rows[0].status || '').toLowerCase();
    const active = Boolean(rows[0].id) && !INATIVOS.includes(status);
    return {
      id: String(rows[0].id),
      auth_user_id: user.id,
      system_role: systemRole,
      active,
      // Só o app_metadata confiável viaja adiante, na forma que o
      // `socialPermissions` do dominio espera.
      app_metadata: { system_role: systemRole, legacy_auth_user_id: String(legacyId) },
      checked_at: now(),
    };
  };
}

// Autorização por conta, sobre o modelo REAL.
//
// A tabela `social_account_access` (ver `scripts/proposed-social-account-access.sql`,
// MIGRATION PROPOSTA E NÃO APLICADA) liga usuário a conta com permissões
// separadas. Esta função é o ÚNICO lugar que a consulta; `repository` e o
// handler da IA consomem só o booleano.
//
// As quatro dimensões do escopo de conta. `can_view` é o piso comum; as demais
// são independentes entre si, para que "operar" não arraste "administrar".
export const ACCOUNT_PERMISSIONS = Object.freeze(['can_view', 'can_reply', 'can_approve_ai', 'can_admin']);

// Regra de ouro: NENHUM caminho devolve `true` por acidente. Cada ausência —
// sem usuário, sem conta, vínculo inativo, conta desconectada, erro de banco —
// devolve `false`.
//
// `system_role` NÃO aparece aqui de propósito. Ele é a permissão FUNCIONAL, já
// verificada antes (`socialPermissions`) e combinada com este resultado pelo
// chamador: ter `reply` sem vínculo de conta continua sendo 403. Se esta função
// dissesse "admin vê tudo", um admin de uma filial operaria contas de outra.
export function createAccountAccessResolver({ query, accountStatuses = null } = {}) {
  if (typeof query !== 'function') throw new Error('createAccountAccessResolver requer query()');
  return async function isAccountVisible(userId, accountId) {
    // Sem identidade ou sem conta não há o que verificar.
    if (!userId || typeof userId !== 'string' || !accountId || typeof accountId !== 'string') return false;
    let rows;
    try {
      rows = await query(userId, accountId);
    } catch {
      // Erro de banco NÃO é permissão: negamos. Devolver `true` aqui transformaria
      // uma falha de rede em vazamento de dados entre contas.
      return false;
    }
    if (!Array.isArray(rows) || rows.length === 0) return false;
    // Linhas duplicadas indicariam vínculo inconsistente; negar é mais seguro
    // que escolher a primeira.
    if (rows.length > 1) return false;
    const row = rows[0];
    if (!row || row.active !== true) return false;
    // `can_view` é o piso: quem não pode ver a conta não a opera. Uma linha com
    // can_reply e can_view=false só entraria se o CHECK fosse contornado.
    if (row.can_view !== true) return false;
    // Conta inativa/desconectada não sustenta operação normal. Sem esta
    // checagem, um vínculo válido continuaria autorizando sobre uma conta cujo
    // token OAuth já morreu.
    if (accountStatuses) {
      let status;
      try { status = await accountStatuses(accountId); } catch { return false; }
      if (status !== 'connected') return false;
    }
    return true;
  };
}

// O que `createAccountAccessResolver` acima responde: "pode VER?". As demais
// dimensões (responder, aprovar IA, administrar) são consultadas pelo mesmo
// vínculo, e combinadas com a permissão funcional pelo serviço. Esta função
// existe para o repository poder checar cada dimensão sem repetir a consulta.
export function createAccountPermissionResolver({ query } = {}) {
  if (typeof query !== 'function') throw new Error('createAccountPermissionResolver requer query()');
  return async function accountPermission(userId, accountId, permission) {
    if (!ACCOUNT_PERMISSIONS.includes(permission)) throw new Error(`Permissão de conta desconhecida: ${permission}`);
    if (!userId || typeof userId !== 'string' || !accountId || typeof accountId !== 'string') return false;
    let rows;
    try { rows = await query(userId, accountId); } catch { return false; }
    if (!Array.isArray(rows) || rows.length !== 1) return false;
    const row = rows[0];
    if (!row || row.active !== true || row.can_view !== true) return false;
    return row[permission] === true;
  };
}

// Combina a permissão FUNCIONAL (já verificada pelo `socialPermissions`) com o
// VÍNCULO DE CONTA. É esta a porta que o handler da IA e o service usam:
// `reply` sem acesso à conta => 403, e acesso sem `reply` => 403 também.
export async function authorizeSocialAction({ functionalPermission, accountPermission }) {
  if (functionalPermission !== true || accountPermission !== true) return false;
  return true;
}
