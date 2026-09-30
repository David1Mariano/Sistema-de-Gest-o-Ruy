// ===========================================================================
// HANDLER HTTP DE ADMINISTRAÇÃO SOCIAL (Fase 8).
//
// SEPARADO de `/social-ai/*` de propósito. São duas autorizações com contratos
// diferentes: a IA responde "o que a IA sabe", a administração responde "quem
// pode ver e operar qual conta". Misturar os dois daria à tela de acessos um
// handler com rotas que não precisam existir.
//
// SEM CRUD GENÉRICO. Cada rota tem verbo, corpo e permissão próprios. Não existe
// `POST /social-admin/query` nem rota que aceite operação arbitrária: isso
// seria um proxy de escrita com o nome de API.
//
// NENHUM CAMINHO DE BOOTSTRAP AQUI. O primeiro administrador existe só no
// script one-shot, com conexão administrativa ao banco. Uma rota que concedesse
// o primeiro `can_admin` pela tela refaria o deadlock da Fase 7 — e pior, o
// tornaria alcançável por qualquer sessão autenticada.
// ===========================================================================
import { socialPermissions } from '../../src/lib/social/domain.js';
import { ACCOUNT_PERMISSION_FIELDS } from '../../src/lib/social/accountAccess.js';

const NO_STORE = { 'cache-control': 'no-store' };

// Erros de negócio → HTTP. Um código fora daqui NUNCA vira 200.
const STATUS = {
  UNAUTHORIZED: [401, 'Sessão inválida'],
  FORBIDDEN: [403, 'Sem permissão'],
  INVALID_ACCOUNT: [400, 'Conta não informada'],
  INVALID_USER: [400, 'Usuário não informado'],
  INVALID_ARGUMENT: [400, 'Requisição inválida'],
  INVALID_PERMISSION: [400, 'Permissão inválida'],
  NOT_FOUND: [404, 'Não encontrado'],
  ALREADY_EXISTS: [409, 'Já existe'],
  DUPLICATE_ACCESS: [409, 'Vínculo duplicado'],
  USER_INACTIVE: [409, 'Usuário inativo'],
  ACCOUNT_NOT_CONNECTED: [409, 'Conta desconectada'],
  ACCESS_SCHEMA_NOT_READY: [503, 'Schema de acesso social não aplicado'],
  STORE_MALFORMED: [502, 'Resposta inesperada do banco'],
  UNAVAILABLE: [503, 'Serviço indisponível'],
  RATE_LIMITED: [429, 'Muitas solicitações'],
};

const statusFor = (code) => STATUS[code] || [503, 'Operação indisponível'];

// Só estes códigos têm mensagem de negócio segura, redigida aqui. Qualquer
// outro — inclusive os de infraestrutura — recebe a mensagem GENÉRICA.
//
// Motivo concreto: `pg` inclui host, porta e às vezes credencial na mensagem de
// conexão ("conexão recusada em 10.0.0.5:5432"). Ecoar `error.message` para o
// navegador entregaria a topologia interna do banco. O detalhe vai para o log
// do servidor, não para a resposta.
const SAFE_MESSAGE_CODES = new Set([
  'FORBIDDEN', 'INVALID_ACCOUNT', 'INVALID_USER', 'INVALID_ARGUMENT', 'INVALID_PERMISSION',
  'NOT_FOUND', 'ALREADY_EXISTS', 'DUPLICATE_ACCESS', 'USER_INACTIVE', 'ACCOUNT_NOT_CONNECTED',
  'ACCESS_SCHEMA_NOT_READY', 'REVIEW_REQUIRED',
]);
const publicMessage = (code, fallback) => (SAFE_MESSAGE_CODES.has(code) ? fallback : 'Operação indisponível');

// Só os campos que a tela precisa. A resposta nunca ecoa a linha crua do banco:
// o identificador externo da plataforma viaja redigido.
const publicLink = (row) => ({
  auth_user_id: row.auth_user_id,
  active: row.active === true,
  revoked_at: row.revoked_at ?? null,
  ...Object.fromEntries(ACCOUNT_PERMISSION_FIELDS.map((f) => [f, row[f] === true])),
});

const publicAccount = (row) => {
  const ext = row.external_account_id ? String(row.external_account_id) : null;
  return {
    id: row.id,
    provider: row.provider,
    display_name: row.display_name,
    status: row.status,
    access_count: Number(row.access_count) || 0,
    external_account_id: ext && ext.length > 4 ? `${ext.slice(0, 2)}${'•'.repeat(Math.min(8, ext.length - 4))}${ext.slice(-2)}` : ext,
  };
};

const publicPerson = (row) => ({
  auth_user_id: row.auth_user_id,
  full_name: row.full_name,
  email: row.email,
  status: row.status,
  active: !['inactive', 'inativo', 'disabled', 'bloqueado', 'desativado'].includes(String(row.status || '').toLowerCase().trim()),
});

function permissionsFrom(body) {
  const out = {};
  for (const field of ACCOUNT_PERMISSION_FIELDS) {
    if (body?.[field] === undefined) continue;
    // Tipo errado é recusa, não coerção: `can_admin: "true"` viraria string.
    if (typeof body[field] !== 'boolean') return { error: 'INVALID_PERMISSION' };
    out[field] = body[field];
  }
  return { permissions: out };
}

export function createSocialAdminHandler({ service, store, verifyIdentity, canAdminAnyAccount = null, limiter = null } = {}) {
  // O handler PRECISA do serviço de contas. O store sozinho não basta: a
  // autorização por conta e a normalização das permissões moram no serviço, e
  // duplicá-las aqui criaria duas regras que divergem.
  if (!service) throw new Error('createSocialAdminHandler exige service');
  if (!store) throw new Error('createSocialAdminHandler exige store');
  if (typeof verifyIdentity !== 'function') throw new Error('createSocialAdminHandler exige verifyIdentity');

  // A MESMA função da Fase 6/7, sobre a tabela real: `can_admin` na conta.
  const podeAdministrar = async (identity, accountId) => {
    if (typeof canAdminAnyAccount !== 'function') return false;
    return (await canAdminAnyAccount(identity.id, accountId, 'can_admin')) === true;
  };

  return async function handle(request) {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    const reply = (status, body) => Response.json(body, { status, headers: NO_STORE });
    if (!route.startsWith('/social-admin/')) return reply(404, { error: 'not_found' });

    let identity;
    try { identity = await verifyIdentity(request.headers.get('authorization')); }
    catch { return reply(401, { error: 'unauthorized' }); }
    if (!identity?.id || identity.active !== true) return reply(401, { error: 'unauthorized' });

    // Taxa por usuário, depois da identidade. O teto é folgado: isto é tela de
    // administração, não API pública — mas clique repetido ainda incomoda.
    if (limiter) {
      const verdict = limiter.check(`admin:${identity.id}`);
      if (!verdict.allowed) return reply(429, { error: 'rate_limited' });
    }

    // Permissão FUNCIONAL: mesma matriz do domínio, já usada em todas as fases.
    if (!socialPermissions(identity.app_metadata?.system_role).configure) return reply(403, { error: 'forbidden' });

    // O serviço revalida a identidade em CADA operação (defesa em profundidade:
    // esconder o botão no frontend não autoriza nada). Para isso ele precisa do
    // token BRUTO — o header `Authorization` original.
    //
    // Antes passava `{ id: identity.id }`, que não é um bearer: o
    // `verifyIdentity` recebia um objeto, não extraía nada, e TODA operação
    // administrativa respondia 401. Os testes da Fase 8 não viram porque o
    // `verifyIdentity` falso deles ignorava o argumento.
    const token = { id: identity.id, raw: request.headers.get('authorization') };
    const wrap = async (fn) => {
      try { return await fn(); }
      catch (error) {
        const [status, message] = statusFor(error?.code);
        // A mensagem original NUNCA vai para a resposta: pode conter host,
        // porta e credencial. O operador vê a genérica, e o código do erro
        // permite à tela distinguir "sem permissão" de "banco fora".
        return reply(status, { error: error?.code || 'UNAVAILABLE', message: publicMessage(error?.code, message) });
      }
    };
    const accountIdDe = (sufixo) => {
      const m = new RegExp(`^/social-admin/accounts/([^/]+)/${sufixo}$`).exec(route);
      return m ? decodeURIComponent(m[1]) : null;
    };
    const corpo = async () => {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return null;
      try { return await request.json(); } catch { return null; }
    };
    // Toda rota que age sobre uma conta exige o VÍNCULO de administrar nela.
    const exigirVinculo = async (accountId) => {
      if (!accountId) return reply(400, { error: 'invalid_account' });
      if (!await podeAdministrar(identity, accountId)) return reply(403, { error: 'forbidden' });
      return null;
    };

    if (route === '/social-admin/accounts' && request.method === 'GET') {
      // DESCOBERTA ADMINISTRATIVA AUTORIZADA.
      //
      // A Fase 8 dizia que esta rota não exigia vínculo, "porque o operador
      // precisa ver as contas antes de administrar uma". Isso é vazamento de
      // metadado: bastava `configure` para enumerar TODAS as contas da empresa,
      // inclusive de outras unidades.
      //
      // Regra final: quem chega aqui precisa de `configure` E `can_admin` em
      // pelo menos UMA conta. A lista é a exceção mínima para a tela vazia: ela
      // mostra apenas as contas que a pessoa administra, e a entrada normal
      // segue sendo o link "Gerenciar".
      // A chamada fica DENTRO do `wrap`. Awaitada de fora, uma falha de banco
      // escapava do handler, perdia o código (`ACCESS_SCHEMA_NOT_READY` virava
      // `UNAVAILABLE`) e o host tinha que responder com mensagem genérica — a
      // tela deixava de distinguir "schema pendente" de "banco fora".
      return wrap(async () => {
        const administradas = await service.listAdministeredAccounts(token);
        return reply(200, { accounts: administradas.map(publicAccount) });
      });
    }

    if (request.method === 'GET' && accountIdDe('access')) {
      const accountId = accountIdDe('access');
      const negado = await exigirVinculo(accountId);
      if (negado) return negado;
      return wrap(async () => reply(200, { account_id: accountId, access: (await service.listAccountAccess(token, accountId)).map(publicLink) }));
    }
    if (request.method === 'GET' && accountIdDe('candidates')) {
      const accountId = accountIdDe('candidates');
      const negado = await exigirVinculo(accountId);
      if (negado) return negado;
      return wrap(async () => reply(200, { candidates: (await service.listCandidates(token, accountId)).map(publicPerson) }));
    }
    if (request.method === 'POST' && accountIdDe('grant')) {
      const accountId = accountIdDe('grant');
      const negado = await exigirVinculo(accountId);
      if (negado) return negado;
      const body = await corpo();
      if (!body || typeof body.auth_user_id !== 'string') return reply(400, { error: 'invalid_argument' });
      const perms = permissionsFrom(body);
      if (perms.error) return reply(400, { error: perms.error });
      return wrap(async () => {
        const r = await service.grantAccountAccess(token, { accountId, authUserId: body.auth_user_id, permissions: perms.permissions });
        return reply(200, { access: publicLink(r), reactivated: r.reactivated === true, adjusted: r.adjusted ?? [] });
      });
    }
    if (request.method === 'PATCH' && accountIdDe('access')) {
      const accountId = accountIdDe('access');
      const negado = await exigirVinculo(accountId);
      if (negado) return negado;
      const body = await corpo();
      if (!body || typeof body.auth_user_id !== 'string') return reply(400, { error: 'invalid_argument' });
      const perms = permissionsFrom(body);
      if (perms.error) return reply(400, { error: perms.error });
      return wrap(async () => {
        const r = await service.updateAccountAccess(token, { accountId, authUserId: body.auth_user_id, permissions: perms.permissions });
        return reply(200, { access: publicLink(r), adjusted: r.adjusted ?? [] });
      });
    }
    for (const acao of ['revoke', 'reactivate']) {
      if (request.method !== 'POST') continue;
      const accountId = accountIdDe(acao);
      if (!accountId) continue;
      const negado = await exigirVinculo(accountId);
      if (negado) return negado;
      const body = await corpo();
      if (!body || typeof body.auth_user_id !== 'string') return reply(400, { error: 'invalid_argument' });
      const perms = permissionsFrom(body);
      if (perms.error) return reply(400, { error: perms.error });
      return wrap(async () => {
        if (acao === 'revoke') {
          const rev = await service.revokeAccountAccess(token, { accountId, authUserId: body.auth_user_id });
          return reply(200, { access: publicLink(rev) });
        }
        const re = await service.reactivateAccountAccess(token, { accountId, authUserId: body.auth_user_id, permissions: perms.permissions });
        return reply(200, { access: publicLink(re), adjusted: re.adjusted ?? [] });
      });
    }

    return reply(404, { error: 'not_found' });
  };
}
