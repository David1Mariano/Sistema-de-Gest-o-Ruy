import { socialPermissions } from '../../src/lib/social/domain.js';
import { normalizeCategory } from './ai.mjs';

// ---------------------------------------------------------------------------
// Handler de leitura da IA para a CENTRAL. Mesmo desenho de
// `createManyChatEventsHandler`: Fetch handler CHAMAVEL, NAO MONTADO.
//
// Onde montar (Fase 4, documentado e nao improvisado):
//   Backend do projeto = Supabase Edge Function (Deno) ou a API Node do Ruy.
//   `server.mjs` so serve artefatos estaticos e NAO deve virar host de
//   integracao/IA implicitamente. Este modulo exporta `createSocialAIHandler`;
//   a hospedagem e' decisao de infra, nao deste arquivo.
//   `verifyIdentity` e' OBRIGATORIO e deve validar o bearer Supabase com Auth
//   getUser + perfil ativo (mesmo contrato de `createSocialService`).
//
// REGRA INEGOCIAVEL: nenhuma rota envia mensagem, cria worker ou grava rascunho
// sozinho. Este handler so LE a saude da IA e produz SUGESTAO em memoria.
// ---------------------------------------------------------------------------

const HEALTH_STATES = Object.freeze(['not_configured', 'offline', 'model_unavailable', 'ready', 'error']);
const NO_STORE = { 'cache-control': 'no-store' };
const FALLBACK_MESSAGE = 'Não foi possível gerar uma sugestão. Você pode responder manualmente.';

// Allowlist de SAIDA. Mesmo que um provider futuro comece a devolver campo novo,
// ele nao vaza: a resposta e' montada aqui, campo a campo.
const safeHealth = (health) => {
  const state = HEALTH_STATES.includes(health?.status) ? health.status : 'error';
  return {
    status: state,
    provider: typeof health?.provider === 'string' ? health.provider.slice(0, 40) : null,
    // `host` ja vem redigido do provider. URL completa, porta interna, headers,
    // token e resposta crua do Ollama NAO tem campo aqui.
    host: typeof health?.host === 'string' ? health.host.slice(0, 120) : null,
    model: typeof health?.model === 'string' ? health.model.slice(0, 80) : null,
    ready: state === 'ready',
  };
};

// Categoria tambem cruza a allowlist na SAIDA: a UI nunca recebe string livre.
const safeSuggestion = (draft) => ({
  text: typeof draft?.reply === 'string' ? draft.reply : '',
  category: normalizeCategory(draft?.category).category,
  confidence: Number.isFinite(draft?.confidence) ? Math.min(1, Math.max(0, draft.confidence)) : 0,
  // Sempre verdadeiro: e' a politica, nao o modelo, que exige humano.
  requiresHuman: true,
  automaticAllowed: false,
  status: 'draft',
  safety: {
    level: typeof draft?.safety?.level === 'string' ? draft.safety.level : 'low',
    requiresHuman: true,
    reasons: Array.isArray(draft?.safety?.reasons) ? draft.safety.reasons.filter((r) => typeof r === 'string').slice(0, 10) : [],
  },
});

// Erros de configuracao/infra viram HTTP honesto. O corpo NUNCA carrega a
// mensagem do provider: ela pode conter URL, path ou trecho da resposta crua.
const publicStatus = (code) => ({
  AI_NOT_CONFIGURED: [503, 'not_configured'],
  AI_TIMEOUT: [503, 'offline'],
  AI_OFFLINE: [503, 'offline'],
  AI_MODEL_UNAVAILABLE: [503, 'model_unavailable'],
  AI_INVALID_RESPONSE: [502, 'error'],
  AI_UNSAFE_OUTPUT: [502, 'error'],
  FORBIDDEN: [403, 'forbidden'],
  INVALID_PAYLOAD: [400, 'invalid_payload'],
  REVIEW_REQUIRED: [400, 'review_required'],
}[code] || [503, 'error']);


export function createSocialAIHandler({ service, verifyIdentity, loadComment = null }) {
  return async request => {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, '');
    const reply = (status, body) => Response.json(body, { status, headers: NO_STORE });

    // Sem identidade real, TODAS as rotas negam. Fail-closed por construcao:
    // um handler montado sem `verifyIdentity` nao vira porta aberta.
    if (typeof verifyIdentity !== 'function' || !service) return reply(503, { error: 'not_configured' });

    let identity;
    try {
      identity = await verifyIdentity(request.headers.get('authorization'));
    } catch {
      return reply(401, { error: 'unauthorized' });
    }
    if (!identity?.id || identity.active !== true) return reply(401, { error: 'unauthorized' });

    // GET /social-ai/health -> estado seguro da IA local.
    if (route.endsWith('/health')) {
      if (request.method !== 'GET') return reply(405, { error: 'method_not_allowed' });
      if (!socialPermissions(identity.app_metadata?.system_role).approve_ai) return reply(403, { error: 'forbidden' });
      try {
        return reply(200, safeHealth(await service.health()));
      } catch {
        return reply(200, safeHealth({ status: 'error' }));
      }
    }

    // POST /social-ai/draft -> SUGESTAO em memoria. Nao grava, nao envia.
    if (route.endsWith('/draft')) {
      if (request.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
      if (!socialPermissions(identity.app_metadata?.system_role).reply) return reply(403, { error: 'forbidden' });
      if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'invalid_content_type' });
      let payload;
      try {
        payload = await request.json();
      } catch {
        return reply(400, { error: 'invalid_payload' });
      }
      // Texto do comentario vem do CENTRAL; aqui so interessa para classificar e
      // moderar. Recusamos na entrada o que nao e' comentario utilizavel.
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text || text.length > 5000) return reply(400, { error: 'invalid_payload' });

      // Se houver carregador de comentario, ele e' a fonte do TEXTO. O corpo
      // nunca substitui conteudo persistido; so o comentario_id e' aceito.
      let comment = { text };
      if (typeof loadComment === 'function' && payload?.commentId) {
        let stored;
        try {
          stored = await loadComment(payload.commentId);
        } catch {
          return reply(403, { error: 'forbidden' });
        }
        if (!stored) return reply(404, { error: 'not_found' });
        comment = { text: String(stored.text || ''), category: stored.category };
      }

      try {
        // classify e' informativo; falhar nele NAO pode derrubar a sugestao.
        const [classification, draft] = await Promise.all([
          service.classifyComment(comment).catch(() => null),
          service.draftReply(comment),
        ]);
        return reply(200, {
          ...safeSuggestion(draft),
          category: normalizeCategory(classification?.category ?? draft?.category).category,
          categoryRecognized: classification ? classification.categoryRecognized !== false : false,
        });
      } catch (error) {
        const [status, code] = publicStatus(error?.code);
        // Fallback manual: a UI sempre recebe a frase de recuperacao e pode
        // escrever a resposta a mao. Nunca stack, nunca mensagem do provider.
        return reply(status, { error: code, message: FALLBACK_MESSAGE });
      }
    }

    return reply(404, { error: 'not_found' });
  };
}
