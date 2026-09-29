// ---------------------------------------------------------------------------
// Configuracao de ambiente do backend da IA.
//
// Separar DEV e PRODUCAO aqui, e' nao no codigo, e' o que permite a mesma build
// rodar em `localhost:5173` (DEV) e em `http://ADM-RUY:8080` (producao local).
// NADA e' hardcoded: cada valor vem do `process.env` do processo backend.
//
// A URL que o NAVEGADOR usa (`VITE_SOCIAL_AI_ENDPOINT`) e' outra coisa: aponta
// para ESTE processo, nunca para o Ollama. Em DEV ela e' `http://127.0.0.1:8788`
// (mesma maquina); em producao, `http://ADM-RUY:8788`.
//
// SEGREDOS: `SUPABASE_ANON_KEY` e' a chave publica (a unica necessaria para
// validar o JWT do usuario via Auth). A service_role NAO e' usada aqui e nao
// deve ser adicionada: este processo valida o usuario com o token DELE.
// ---------------------------------------------------------------------------
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSupabaseIdentityVerifier, createDenyAllAccountAccess } from './aiAuth.mjs';
import { socialAIFromEnvironment } from './ai.mjs';
import { createSocialAIHandler } from './aiHandler.mjs';
import { createSocialAIHost, createRateLimiter, createSafeLogger, parseOrigins } from './aiHost.mjs';
import { createSocialRepository } from './repository.mjs';

export const AI_API_PORT = 8788;
const num = (value, fallback) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : fallback; };

/**
 * Monta o backend da IA a partir do ambiente. Falha ALTO e cedo se faltar
 * configuração essencial: melhor não subir do que subir meio configurado.
 */
export function socialAIConfigFromEnvironment(env = process.env) {
  const port = num(env.SOCIAL_AI_PORT, AI_API_PORT);
  const origins = parseOrigins(env.SOCIAL_AI_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://ADM-RUY:8080');
  return {
    port,
    host: env.SOCIAL_AI_BIND || '127.0.0.1',
    origins,
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    ollamaBaseUrl: env.OLLAMA_BASE_URL || '',
    ollamaModel: env.OLLAMA_MODEL || '',
    ollamaTimeoutMs: num(env.OLLAMA_TIMEOUT_MS, 15000),
    aiProvider: env.SOCIAL_AI_PROVIDER || 'ollama',
    draftLimit: num(env.SOCIAL_AI_DRAFT_LIMIT, 10),
    draftWindowMs: num(env.SOCIAL_AI_DRAFT_WINDOW_MS, 60000),
    maxBodyBytes: num(env.SOCIAL_AI_MAX_BODY_BYTES, 8192),
    enforceLocal: env.SOCIAL_AI_ENFORCE_LOCAL !== 'false',
    logPath: env.SOCIAL_AI_LOG_PATH || '',
  };
}

/**
 * @param {object} o
 * @param {object} o.config     saida de `socialAIConfigFromEnvironment`
 * @param {Function} o.request  injetavel nos testes; nunca `fetch` cru
 * @param {Function} o.withClient  cliente Postgres (repository). Ausente = sem
 *        leitura de comentario, e o draft falha fechado com 503.
 * @param {Function} o.sink     destino do log seguro
 */
export function buildSocialAIBackend({ config, service = null, request = fetch, withClient = null, sink = () => {}, now } = {}) {
  const verifyIdentity = createSupabaseIdentityVerifier({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey, request, ...(now ? { now } : {}) });
  // `isAccountVisible` continua DENY-ALL: o schema social ainda nao foi aplicado
  // e nao ha escopo por conta no app_metadata. Autorizar "admin ve tudo" seria
  // a autorizacao fake que a fase 3 proibiu.
  const isAccountVisible = createDenyAllAccountAccess();
  const repository = withClient ? createSocialRepository({ withClient, isAccountVisible }) : null;
  // O provider (Ollama) sai do AMBIENTE, nunca do corpo da requisicao.
  const ai = service || socialAIFromEnvironment({ OLLAMA_BASE_URL: config.ollamaBaseUrl, OLLAMA_MODEL: config.ollamaModel, OLLAMA_TIMEOUT_MS: String(config.ollamaTimeoutMs), SOCIAL_AI_PROVIDER: config.aiProvider });

  const limiter = createRateLimiter({ limit: config.draftLimit, windowMs: config.draftWindowMs, ...(now ? { now } : {}) });
  const log = createSafeLogger(sink, ...(now ? [now] : []));

  // Sem Postgres configurado, nao inventamos leitura de comentario: o draft
  // devolve 503 em vez de confiar no texto do navegador.
  const loadComment = async (commentId) => {
    if (!repository) { const e = new Error('COMMENT_STORE_NOT_CONFIGURED'); e.code = 'COMMENT_STORE_NOT_CONFIGURED'; throw e; }
    return repository.commentFor(commentId);
  };

  const handler = createSocialAIHandler({ service: ai, verifyIdentity, loadComment, allowDraft: (userId) => limiter.check(`user:${userId}`) });
  return createSocialAIHost({ handler, origins: config.origins, log, limit: config.draftLimit, windowMs: config.draftWindowMs, enforceLocal: config.enforceLocal, maxBodyBytes: config.maxBodyBytes });

// Bootstrap do processo. Nao roda ao ser importado nos testes: so quando
// executado diretamente. `withClient` (Postgres) e' opcional de proposito —
// sem ele o draft falha fechado, e o health continua funcionando.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const config = socialAIConfigFromEnvironment();
  const server = buildSocialAIBackend({ config, sink: (entry) => console.log(JSON.stringify(entry)) });
  server.on('error', (error) => { console.error(`IA social: ${error.code || 'erro'}`); process.exit(error.code === 'EADDRINUSE' ? 20 : 1); });
  server.listen(config.port, config.host);
  console.log(`IA social: http://${config.host}:${config.port} (origens: ${config.origins.join(', ')})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

}
