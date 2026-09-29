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

// Autorização por contasocial.
//
// O repository (`assertAccountAccess`) exige `isAccountVisible` e falha fechado
// sem ele. Ate hoje as tabelas `social_accounts`/`social_comments` existem
// APENAS como proposta (`scripts/proposed-social-schema.sql`) e NAO foram
// aplicadas; e o `app_metadata` real do sistema carrega `system_role`,
// `legacy_auth_user_id` e `employee_payment_access` — nenhum escopo por conta,
// unidade ou loja.
//
// Logo NAO existe informacao suficiente para autorizar conta->usuario, e
// autorizar "admin ve tudo" seria justamente a autorizacao fake proibida.
// Esta funcao e' o deny-all explicito: enquanto o schema social existir de fato
// e um escopo por conta for definido, TODO acesso a conta e' negado, com um
// codigo de erro proprio para nao parecer um bug.
export function createDenyAllAccountAccess(reason = 'SCHEMA_SOCIAL_NAO_APLICADO') {
  return async function isAccountVisible() {
    const error = new Error('Autorizacao de conta social ainda nao disponivel.');
    error.code = reason;
    throw error;
  };
}
