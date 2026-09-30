// ===========================================================================
// HOST ÚNICO DO BACKEND SOCIAL (Fase 9).
//
// Um processo, uma porta, DOIS namespaces:
//   /social-ai/*     -> IA local (draft, health)
//   /social-admin/*  -> administração de contas e acessos
//
// POR QUE UM PROCESSO E NÃO DOIS: autenticação, CORS, rate limit e leitura de
// configuração são o MESMO trabalho para os dois. Duas cópias dessas camadas
// divergiriam — e divergência silenciosa em CORS ou rate limit é exatamente o
// tipo de bug que só aparece em produção.
//
// O QUE CONTINUA SEPARADO: a autorização. Cada namespace tem o SEU contrato e
// o SEU verificador de vínculo. `social-ai` exige `reply`/`approve_ai`;
// `social-admin` exige `configure` + `can_admin`. Compartilhar o handler
// Misturaria as duas políticas e criaria o atalho que a Fase 6 proibiu.
// ===========================================================================
import http from 'node:http';
import { createSupabaseIdentityVerifier, createAccountAccessResolver, createAccountPermissionResolver } from './aiAuth.mjs';
import { socialAIFromEnvironment } from './ai.mjs';
import { corsHeaders, parseOrigins, createRateLimiter, createSafeLogger } from './aiHost.mjs';
import { createSocialAIHandler, FALLBACK_MESSAGE } from './aiHandler.mjs';
import { createSocialAdminHandler } from './adminHandler.mjs';
import { createAccountAdminService } from './accountAdmin.mjs';
import { createSocialRepository } from './repository.mjs';
import { createSocialAccessStore } from './accountAccessStore.mjs';
import { createAccountAdminStoreAdapter } from './accountAdminStore.mjs';
import { localPeer } from '../../scripts/production/server.mjs';

export const SOCIAL_API_PORT = 8788;
const AI_PREFIX = '/social-ai/';
const ADMIN_PREFIX = '/social-admin/';
// Autoridade fixa, só para montar a URL interna. NÃO vem do header `Host`.
const LOCAL_AUTHORITY = 'backend.interno';

/**
 * @param {object} o
 * @param {object} o.config       `socialAPIConfigFromEnvironment`
 * @param {Function} o.request    injetável nos testes; nunca `fetch` cru
 * @param {Function} o.withClient cliente Postgres (store de acessos)
 * @param {Function} o.sink       destino do log seguro
 */
export function buildSocialAPI({ config, request = fetch, withClient = null, service = null, sink = () => {}, now } = {}) {
  const verifyIdentity = createSupabaseIdentityVerifier({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey, request, ...(now ? { now } : {}) });

  // `withClient` ausente = banco indisponível. A UI precisa distinguir isso de
  // "não há contas", então o store recusa com código claro, nunca lista vazia.
  const store = withClient ? createSocialAccessStore({ withClient, ...(now ? { now } : {}) }) : null;
  // Adaptador para o contrato de métodos NOMEADOS do serviço administrativo
  // (Fase 8). É ele que fecha a lacuna entre o store transacional e o serviço.
  const adminStore = withClient ? createAccountAdminStoreAdapter({ withClient, ...(now ? { now } : {}) }) : storeIndisponivel();

  // ── autorização por conta, sobre o resolver REAL da Fase 6 ───────────────
  // Sem `withClient` os resolvers são deny-all: nada é autorizado até o
  // responsável cadastrar os vínculos. Fail-closed por construção.
  //
  // O contrato do resolver é LISTA (`rows.length !== 1` → false), e é assim que
  // uma linha duplicada vira "não autorizado" em vez de "escolhe uma". Por isso
  // o `accountQuery` embrulha a linha única num array de 0 ou 1 elementos.
  // Passar a linha direto faria `Array.isArray` falhar e TODO acesso — inclusive
  // o do administrador legítimo — seria negado.
  const accountQuery = withClient
    ? (userId, accountId) => store.read(async (tx) => {
      const linha = await tx.findAccess(accountId, userId);
      return linha ? [linha] : [];
    })
    : null;
  const accountStatus = withClient ? (accountId) => store.read(async (tx) => (await tx.findAccount(accountId))?.status ?? null) : null;
  const isAccountVisible = accountQuery
    ? createAccountAccessResolver({ query: accountQuery, accountStatuses: accountStatus })
    : async () => false;
  // O MESMO resolver da Fase 6 decide `can_admin`. Não existe atalho de role
  // global: `createAccountPermissionResolver` já devolve false para vínculo
  // inativo, conta inválida, linha duplicada e erro de banco.
  const accountPermission = accountQuery
    ? createAccountPermissionResolver({ query: accountQuery })
    : async () => false;
  const canAdminAnyAccount = (userId, accountId) => accountPermission(userId, accountId, 'can_admin');

  // ── IA ───────────────────────────────────────────────────────────────────
  const ai = service || socialAIFromEnvironment({
    OLLAMA_BASE_URL: config.ollamaBaseUrl, OLLAMA_MODEL: config.ollamaModel,
    OLLAMA_TIMEOUT_MS: String(config.ollamaTimeoutMs), SOCIAL_AI_PROVIDER: config.aiProvider,
  });
  const repository = withClient ? createSocialRepository({ withClient, isAccountVisible }) : null;
  const limiter = createRateLimiter({ limit: config.rateLimit, windowMs: config.rateWindowMs });

  const aiHandler = createSocialAIHandler({
    service: ai,
    verifyIdentity,
    // `loadComment` é obrigatório: o texto do browser é sempre descartado e a
    // conta verificada é a do COMENTÁRIO PERSISTIDO.
    loadComment: async (commentId, userId) => {
      if (!repository) { const e = new Error('banco indisponível'); e.code = 'STORE_NOT_CONFIGURED'; throw e; }
      const comment = await repository.commentFor(commentId);
      if (!comment) return null;
      if (userId && comment.account_id && !await isAccountVisible(userId, comment.account_id)) {
        const e = new Error('Conta não autorizada'); e.code = 'FORBIDDEN'; throw e;
      }
      return comment;
    },
    allowDraft: (userId) => limiter.check(`ai:${userId}`),
  });

  // ── administração ────────────────────────────────────────────────────────
  const adminService = createAccountAdminService({ store: adminStore, verifyIdentity, canAdminAnyAccount });
  const adminHandler = createSocialAdminHandler({ service: adminService, store: adminStore, verifyIdentity, canAdminAnyAccount, limiter });

  // ── camadas compartilhadas ───────────────────────────────────────────────
  const allowed = parseOrigins(config.origins);
  const log = createSafeLogger(sink, ...(now ? [now] : []));

  const server = http.createServer(async (req, res) => {
    // `req.url` é RELATIVO ("/social-admin/accounts"), sem esquema nem host.
    // Passá-lo direto para `new URL()` estoura. A base é literal e não vem do
    // pedido — se viesse do header `Host`, um cliente poderia apontar o parse
    // para onde quisesse.
    const url = new URL(req.url, `http://${LOCAL_AUTHORITY}`);
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, allowed);
    const reply = (status, body) => {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
      if (cors) Object.assign(headers, cors);
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    const inicio = Date.now();

    // Preflight e CORS são decisão DO HOST, uma vez para os dois namespaces.
    if (req.method === 'OPTIONS') return reply(cors ? 204 : 403, cors ? {} : { error: 'cors_denied' });
    if (origin && !cors) { log({ event: 'cors_denied', route }); return reply(403, { error: 'cors_denied' }); }
    if (!route.startsWith(AI_PREFIX) && !route.startsWith(ADMIN_PREFIX) && route !== '/social-health') {
      return reply(404, { error: 'not_found' });
    }
    if (config.enforceLocal && !localPeer(req.socket.remoteAddress)) {
      log({ event: 'peer_denied', route });
      return reply(403, { error: 'forbidden' });
    }

    // Rate limit por IP antes de qualquer trabalho; por identidade, dentro de
    // cada handler (onde o usuário já foi resolvido).
    if (!limiter.check(`ip:${req.socket.remoteAddress || 'desconhecido'}`).allowed) {
      log({ event: 'rate_limited', route });
      return reply(429, { error: 'rate_limited' });
    }

    // Teto de corpo para os DOIS namespaces: um payload gigante não pode virar
    // alocação nem chegar perto do handler.
    let body = null;
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      const partes = [];
      let tamanho = 0;
      let grande = false;
      for await (const pedaco of req) {
        tamanho += pedaco.length;
        if (tamanho > config.maxBodyBytes) { grande = true; break; }
        partes.push(pedaco);
      }
      if (grande) { log({ event: 'payload_too_large', route }); return reply(413, { error: 'payload_too_large' }); }
      body = Buffer.concat(partes).toString('utf8');
    }

    // Reconstrói a requisição para o handler, com o corpo já lido. O handler
    // NÃO enxerga o socket nem precisa implementar limite de payload.
    const headers = new Headers();
    for (const [chave, valor] of Object.entries(req.headers)) {
      if (valor === undefined) continue;
      const baixo = chave.toLowerCase();
      // `authorization` PASSa: é o token que o handler valida. `cookie` NÃO
      // passa, e o corpo já foi lido, então não há segunda leitura.
      if (['host', 'content-length', 'connection', 'cookie'].includes(baixo)) continue;
      headers.set(chave, Array.isArray(valor) ? valor.join(', ') : String(valor));
    }
    const interno = new Request(`http://host${url.pathname}${url.search}`, { method: req.method, headers, ...(body !== null ? { body } : {}) });

    try {
      const handler = route.startsWith(AI_PREFIX) ? aiHandler
        : route.startsWith(ADMIN_PREFIX) ? adminHandler
          : healthHandler();
      const resposta = await handler(interno);
      const dados = await resposta.json().catch(() => ({}));
      // Log operacional: status, duração, rota e código. NUNCA prompt,
      // comentário, token ou corpo — este log pode acabar em relatório.
      log({
        event: route.startsWith(ADMIN_PREFIX) ? 'admin' : 'api',
        status: resposta.status, route: url.pathname, duration_ms: Date.now() - inicio, error_code: dados?.error || null,
      });
      return reply(resposta.status, resposta.status === 429 ? { error: 'rate_limited' } : dados);
    } catch (error) {
      // Falha inesperada: resposta GENÉRICA. A mensagem do driver pode conter
      // host, porta e credencial; ela vai para o log, não para o cliente.
      log({ event: 'unhandled', route: url.pathname, status: 500, error_code: error?.code || 'INTERNAL', duration_ms: Date.now() - inicio });
      return reply(503, { error: 'UNAVAILABLE', message: FALLBACK_MESSAGE });
    }
  });

  function healthHandler() {
    return async () => {
      const [supabase, ollama, schema] = await Promise.all([
        checarSupabase(request, config).catch(() => 'offline'),
        ai.health().catch(() => ({ state: 'error' })),
        checarSchema(store, Boolean(withClient)).catch(() => 'unknown'),
      ]);
      const estadoOllama = ollama?.state || 'error';
      // `ready` só é true com TODAS as dependências de pé. Uma dependência fora
      // do ar vira estado DEGRADADO explícito, nunca um 200 "tudo pronto" que
      // mentiria para o operador.
      const pronto = supabase === 'ok' && estadoOllama === 'ready' && schema === 'ok';
      return Response.json({
        status: pronto ? 'ready' : 'degraded',
        ready: pronto,
        degraded: !pronto,
        supabase,
        // Schema ausente NÃO é o mesmo que banco fora: a tela usa a diferença
        // para mostrar "configuração pendente" em vez de "erro".
        social_schema: schema,
        ai: {
          state: estadoOllama,
          provider: ollama?.provider ?? null,
          model: ollama?.model ?? null,
          // Host já redigido pelo provider. A URL do Ollama não sai daqui.
          host: ollama?.host ?? null,
        },
        // Nenhuma configuração, connection string ou segredo entra aqui.
      }, { status: 200, headers: { 'cache-control': 'no-store' } });
    };
  }

  return server;
}

// Store recusado quando não há cliente Postgres. Qualquer operação lança com
// código CLARO, em vez de devolver vazio e a tela mentir que "não há contas".
function storeIndisponivel() {
  const falha = () => { const e = new Error('banco indisponível'); e.code = 'STORE_NOT_CONFIGURED'; throw e; };
  return new Proxy({}, { get: () => falha });
}

async function checarSupabase(request, config) {
  if (!config.supabaseUrl) return 'not_configured';
  const resposta = await request(`${config.supabaseUrl}/auth/v1/health`, { signal: AbortSignal.timeout(5000) });
  return resposta.ok ? 'ok' : 'unreachable';
}

// Schema presente? Distingue "tabela não existe" (migration não aplicada) de
// "banco fora do ar" — a tela mostra coisas diferentes para cada um.
async function checarSchema(store, temCliente) {
  if (!temCliente) return 'absent';
  try {
    const linhas = await store.read((tx) => tx.listAccounts());
    return Array.isArray(linhas) ? 'ok' : 'unknown';
  } catch (error) {
    return error?.code === 'ACCESS_SCHEMA_NOT_READY' ? 'absent' : 'unknown';
  }
}

/** Configuração do backend social. Nada é hardcoded: tudo vem do ambiente. */
export function socialAPIConfigFromEnvironment(env = process.env) {
  const num = (v, padrao) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : padrao; };
  return {
    port: num(env.SOCIAL_API_PORT, SOCIAL_API_PORT),
    host: env.SOCIAL_API_BIND || '127.0.0.1',
    origins: env.SOCIAL_AI_ALLOWED_ORIGINS || 'http://localhost:5173,http://ADM-RUY:8080',
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    // `SUPABASE_DB_URL` é a conexão administrativa. NUNCA vai para o frontend
    // e NUNCA é logada: só o store a usa.
    dbUrl: env.SUPABASE_DB_URL || '',
    ollamaBaseUrl: env.OLLAMA_BASE_URL || '',
    ollamaModel: env.OLLAMA_MODEL || '',
    ollamaTimeoutMs: num(env.OLLAMA_TIMEOUT_MS, 15000),
    aiProvider: env.SOCIAL_AI_PROVIDER || 'ollama',
    rateLimit: num(env.SOCIAL_API_RATE_LIMIT, 60),
    rateWindowMs: num(env.SOCIAL_API_RATE_WINDOW_MS, 60000),
    maxBodyBytes: num(env.SOCIAL_API_MAX_BODY_BYTES, 8192),
    enforceLocal: env.SOCIAL_API_ENFORCE_LOCAL !== 'false',
  };
}

/**
 * Variáveis obrigatórias para o DEV subir. Ausente, o comando diz o que falta
 * e NÃO sobe meio configurado: subir e responder 503 em tudo seria pior que
 * não subir.
 */
export function missingRequiredConfig(config) {
  const faltando = [];
  if (!config.supabaseUrl) faltando.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) faltando.push('SUPABASE_ANON_KEY');
  return faltando;
}

// ── DEV ────────────────────────────────────────────────────────────────────
// Sobe o backend em primeiro plano, para desenvolvimento. NÃO é serviço de
// produção: não instala tarefa agendada, não abre firewall e não sobrevive a um
// logout.
//
// `npm run social:dev`
//
// O que este comando NÃO faz, por desenho: não aplica migration, não executa
// bootstrap, não conecta canal. Aplicar schema e criar o primeiro admin são
// ações deliberadas, feitas à mão pelo responsável.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const config = socialAPIConfigFromEnvironment();
  const faltando = missingRequiredConfig(config);
  if (faltando.length) {
    console.error(`Configuração incompleta. Faltam: ${faltando.join(', ')}`);
    console.error('Defina no ambiente e rode de novo. Nada foi iniciado e nada foi escrito.');
    process.exit(1);
  }
  if (!config.ollamaBaseUrl || !config.ollamaModel) {
    // Não é bloqueio: a IA responde `not_configured` no health e a tela mostra
    // "IA local não configurada". O resto do backend sobe normalmente.
    console.warn('Aviso: OLLAMA_BASE_URL/OLLAMA_MODEL ausentes. A IA ficará em not_configured.');
  }

  let pool = null;
  if (config.dbUrl) {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: config.dbUrl, max: 4, ssl: { rejectUnauthorized: false } });
  } else {
    // Sem `SUPABASE_DB_URL` o backend SOBE, mas a administração responde 503
    // com STORE_NOT_CONFIGURED. A tela mostra "banco indisponível" em vez de
    // fingir que não existem contas.
    console.warn('Aviso: SUPABASE_DB_URL ausente. Administração de acessos ficará indisponível (503).');
  }

  const server = buildSocialAPI({
    config,
    withClient: pool ? () => pool.connect() : null,
    sink: (linha) => console.log(JSON.stringify(linha)),
  });
  server.on('error', (error) => {
    console.error(`Backend social: ${error.code || 'erro'}`);
    process.exit(error.code === 'EADDRINUSE' ? 20 : 1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Backend social (DEV): http://${config.host}:${config.port}`);
    console.log(`  /social-ai/*      IA local`);
    console.log(`  /social-admin/*   administração de acessos`);
    console.log(`  /social-health    saúde do conjunto`);
  });
  for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.on(sinal, () => server.close(() => pool?.end().finally(() => process.exit(0))));
  }
}
