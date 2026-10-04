// ===========================================================================
// HOST DO BACKEND DE ARQUIVOS (R2).
//
// Processo Node separado, na MESMA linha do backend social
// (`server/social/socialApi.mjs`): mesma identidade real (Supabase Auth),
// mesma camada de CORS, mesmo rate limit, mesmo log sem conteúdo.
//
// POR QUE SEPARADO DO SERVIDOR DE PRODUÇÃO: `scripts/production/server.mjs`
// só aceita GET/HEAD, bloqueia `/api`, serve arquivos por manifesto com hash
// e roda de uma CÓPIA em `%LOCALAPPDATA%`. Transformá-lo em gateway de
// arquivo seria trocar um servidor de estáticos por um de integração.
//
// CREDENCIAIS: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
// `R2_BUCKET` e `R2_ENDPOINT` são lidas de `process.env` — nunca do
// ambiente de build e nunca de variável prefixada com VITE (que iria
// parar dentro do bundle do navegador).
// `scripts/test-storage-r2.mjs` verifica que nenhuma delas aparece em `src/`.
//
// `npm run storage:dev` sobe isto. `npm run storage:check` diz o que falta.
// ===========================================================================
import http from 'node:http';
import os from 'node:os';
import { createSupabaseIdentityVerifier } from '../social/aiAuth.mjs';
import { corsHeaders, parseOrigins, createRateLimiter, createSafeLogger } from '../social/aiHost.mjs';
import { localPeer } from '../../scripts/production/server.mjs';
import { createR2Client } from './r2Client.mjs';
import { createStorageService } from './storageService.mjs';
import { createStorageHandler } from './storageHandler.mjs';
import { STORAGE_BUCKET_R2, STORAGE_R2_PREFIX } from '../../src/lib/storage/attachmentPath.js';

export const STORAGE_API_PORT = 8789;
const STORAGE_PREFIX = '/storage/';
const DEFAULT_ORIGINS = Object.freeze(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://ADM-RUY:8080']);

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Lê a configuração do ambiente. NUNCA loga nem retorna segredo em erro:
 * o `check` imprime o NOME da variável, nunca o valor.
 */
export function storageAPIConfigFromEnvironment(env = process.env) {
  const accountId = (env.R2_ACCOUNT_ID || '').trim();
  return {
    host: env.STORAGE_API_HOST || '127.0.0.1',
    port: num(env.STORAGE_API_PORT, STORAGE_API_PORT),
    // Endpoint derivado quando não vier explícito: o R2 usa o account id
    // como subdomínio no formato `https://<account>.r2.cloudflarestorage.com`.
    endpoint: (env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim(),
    accountId,
    accessKeyId: (env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: (env.R2_BUCKET || STORAGE_BUCKET_R2).trim(),
    r2Prefix: (env.R2_PREFIX || STORAGE_R2_PREFIX).trim(),
    region: (env.R2_REGION || 'auto').trim(),
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || '',
    origins: parseOrigins(env.STORAGE_API_ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(',')),
    rateLimit: num(env.STORAGE_API_RATE_LIMIT, 120),
    rateWindowMs: num(env.STORAGE_API_RATE_WINDOW_MS, 60000),
    enforceLocal: env.STORAGE_API_ENFORCE_LOCAL !== 'false',
    // Exclusão real de arquivo é uma decisão separada e desligada por padrão.
    allowDelete: env.STORAGE_DELETE_ENABLED === 'true',
  };
}

export function missingStorageConfig(config) {
  const faltando = [];
  if (!config.endpoint) faltando.push('R2_ENDPOINT ou R2_ACCOUNT_ID');
  if (!config.accessKeyId) faltando.push('R2_ACCESS_KEY_ID');
  if (!config.secretAccessKey) faltando.push('R2_SECRET_ACCESS_KEY');
  if (!config.bucket) faltando.push('R2_BUCKET');
  if (!config.supabaseUrl) faltando.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) faltando.push('SUPABASE_ANON_KEY');
  return faltando;
}
/** Constrói o host HTTP. `request`/`client` injetáveis para os testes. */
export function buildStorageAPI({ config, request = fetch, client = undefined, sink = () => {} } = {}) {
  const log = createSafeLogger(sink);
  const gate = createRateLimiter({ limit: config.rateLimit, windowMs: config.rateWindowMs });
  const networkInterfaces = os.networkInterfaces();

  // Sem credencial o serviço EXISTE e responde 503 honesto: o frontend
  // continua abrindo comprovante legado (Supabase/base64) e mostra uma
  // mensagem clara no lugar de quebrar a tela inteira.
  let r2 = client;
  if (r2 === undefined) {
    try {
      r2 = createR2Client({
        endpoint: config.endpoint,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: config.bucket,
        region: config.region,
        request,
      });
    } catch {
      r2 = null;
      log({ event: 'r2_not_configured' });
    }
  }

  const service = createStorageService({ client: r2, allowDelete: config.allowDelete, r2Prefix: config.r2Prefix });
  const verifyIdentity = createSupabaseIdentityVerifier({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey, request });
  const handler = createStorageHandler({ service, verifyIdentity });

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, config.origins);
    const send = (status, body, extra = {}) => {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra };
      if (cors) Object.assign(headers, cors);
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return send(cors ? 204 : 403, cors ? {} : { error: 'cors_denied' });
    if (config.enforceLocal && !localPeer(req.socket.remoteAddress, networkInterfaces)) return send(403, { error: 'forbidden' });
    if (!req.url.startsWith(STORAGE_PREFIX)) return send(404, { error: 'not_found' });
    if (origin && !cors) return send(403, { error: 'cors_denied' });

    const rota = req.url.split('?')[0];
    const ip = req.socket.remoteAddress || 'desconhecido';
    const verdict = gate.check(`ip:${ip}`);
    if (!verdict.allowed) return send(429, { error: 'rate_limited' }, { 'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000)) });

    const request_ = new Request(`http://host${req.url}`, {
      method: req.method,
      headers: { ...req.headers },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handler(request_);

    // Resposta binária (o proxy do arquivo) passa direto; JSON é remontado.
    const tipo = response.headers.get('content-type') || '';
    if (tipo && !tipo.includes('json')) {
      const headers = {};
      for (const nome of ['content-type', 'content-length', 'content-disposition', 'x-content-type-options', 'referrer-policy', 'cache-control']) {
        const valor = response.headers.get(nome);
        if (valor) headers[nome] = valor;
      }
      if (cors) Object.assign(headers, cors);
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
      log({ event: 'object', route: rota, status: response.status, duration_ms: Date.now() - started });
      return;
    }

    const body = await response.json();
    send(response.status, body);
    log({ event: 'storage', route: rota, status: response.status, error_code: body?.error || null, duration_ms: Date.now() - started });
  });
}

// ── DEV ────────────────────────────────────────────────────────────────────
// `npm run storage:dev`. Sobe em primeiro plano; não é serviço de produção.
// Não aplica migration, não apaga nada e não grava credencial em lugar nenhum.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const config = storageAPIConfigFromEnvironment();
  const faltando = missingStorageConfig(config);
  if (faltando.length) {
    console.error('Configuracao incompleta. Faltam:');
    for (const nome of faltando) console.error(`  - ${nome}`);
    console.error('Nada foi iniciado e nada foi escrito.');
    process.exit(1);
  }
  if (config.bucket !== STORAGE_BUCKET_R2) {
    console.warn(`Aviso: R2_BUCKET="${config.bucket}" difere do bucket do contrato (${STORAGE_BUCKET_R2}).`);
  }
  const server = buildStorageAPI({ config, sink: (linha) => console.log(JSON.stringify(linha)) });
  server.on('error', (error) => {
    console.error(`Backend de arquivos: ${error.code || 'erro'}`);
    process.exit(error.code === 'EADDRINUSE' ? 20 : 1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`Backend de arquivos (DEV): http://${config.host}:${config.port}`);
    console.log(`  ${STORAGE_PREFIX}*          anexos no R2`);
    console.log(`  exclusao real: ${config.allowDelete ? 'LIGADA' : 'desligada'}`);
  });
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => server.close(() => process.exit(0)));
}
