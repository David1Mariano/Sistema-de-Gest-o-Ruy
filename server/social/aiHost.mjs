// ---------------------------------------------------------------------------
// Host Node para o `createSocialAIHandler`.
//
// POR QUE UM PROCESSO SEPARADO, e nao o `scripts/production/server.mjs`:
// auditando o servidor de producao, ele (a) so aceita GET/HEAD e responde 405
// para POST, (b) bloqueia explicitamente caminhos `/api`, (c) le arquivos
// atraves de manifesto de build com hash, e (d) roda de uma COPIA em
// `%LOCALAPPDATA%\GestaoRuy\producao\runtime`. Adicionar ali exigiria mexer no
// manifesto, no instalador de runtime e no filtro de metodo — ou seja, um
// servidor de arquivos virando gateway de IA, que e' exatamente o que nao
// queremos. Este processo e' separado, sobe em outra porta e nao altera a
// producao de estaticos.
//
// POR QUE NAO SUPABASE EDGE FUNCTION: Edge Function roda na nuvem do Supabase
// (Deno). O `OLLAMA_BASE_URL` aponta para `127.0.0.1:11434` na MAQUINA
// ADM-RUY; da nuvem isso nao existe. A funcao responderia sempre `offline`.
// Ver `docs/redes-sociais.md`.
//
// REGRA INEGOCIAVEL: este processo NAO expoe Ollama. Nao existe rota para
// escolher modelo, prompt ou URL. O backend decide tudo a partir do ambiente.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { localPeer } from '../../scripts/production/server.mjs';
import { FALLBACK_MESSAGE } from './aiHandler.mjs';

// Origens permitidas. `*` NUNCA: o backend responde a cookies/bearer e '*'
// transformaria qualquer pagina aberta num cliente autorizado. Configuravel por
// ambiente, com default sensato para DEV e producao local.
const DEFAULT_ORIGINS = Object.freeze(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://ADM-RUY:8080']);

export function parseOrigins(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .map((value) => String(value).trim()).filter(Boolean);
  const bad = list.filter((value) => {
    if (value === '*') return true;
    try { const url = new URL(value); return url.protocol !== 'http:' && url.protocol !== 'https:'; } catch { return true; }
  });
  if (bad.length) throw new Error(`Origem CORS invalida: ${bad.join(', ')}`);
  return Object.freeze([...new Set(list)]);
}

export function corsHeaders(origin, allowed) {
  // Sem `Origin` (ex.: curl de saude) nao e' cross-origin: devolve o JSON sem
  // cabecalhos CORS em vez de ecoar qualquer coisa.
  if (!origin) return {};
  if (!allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

// Rate limit por identidade, em janela deslizante simples. Protege o Ollama de
// clique repetido: cada geracao custa inferencia local, e abuse viraria fila.
export function createRateLimiter({ limit = 10, windowMs = 60000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return {
    check(key) {
      const stamp = now();
      const kept = (hits.get(key) || []).filter((t) => stamp - t < windowMs);
      if (kept.length >= limit) {
        hits.set(key, kept);
        return { allowed: false, retryAfterMs: Math.max(0, windowMs - (stamp - kept[0])) };
      }
      kept.push(stamp);
      hits.set(key, kept);
      return { allowed: true, retryAfterMs: 0 };
    },
    size: () => hits.size,
  };
}

// Log operacional SEM conteudo. Nunca prompt, comentario, texto, dado pessoal,
// Authorization, token ou secret. So metadados de operacao.
export function createSafeLogger(sink = () => {}, now = () => new Date().toISOString()) {
  const ALLOWED = ['event', 'status', 'duration_ms', 'provider', 'model', 'error_code', 'user', 'route'];
  return function log(entry) {
    const safe = {};
    for (const key of ALLOWED) {
      if (entry?.[key] === undefined || entry[key] === null) continue;
      // `user` e' o id interno (UUID/legado), nao email nem nome.
      // `status` e `duration_ms` ficam NUMERICOS: um log de operacao com
      // "200" como texto quebra quem filtra por numero.
      if (key === 'user') safe[key] = String(entry[key]).slice(0, 64);
      else if (typeof entry[key] === 'number') safe[key] = entry[key];
      else safe[key] = String(entry[key]).slice(0, 120);
    }
    safe.at = now();
    sink(safe);
    return safe;
  };
}


// `loadComment` é OBRIGATÓRIO na hospedagem real. Sem ele, o handler aceitaria
// o texto do corpo — e o navegador poderia pedir sugestão para qualquer texto,
// inclusive um que ele mesmo inventou. Com ele, o backend resolve o comentário
// persistido e devolve 404/403 conforme o caso.
export function requireLoadComment(loadComment) {
  if (typeof loadComment !== 'function') throw new Error('createSocialAIHost exige loadComment');
  return loadComment;
}

/**
 * @param {object} o
 * @param {Function} o.handler   `createSocialAIHandler({service, verifyIdentity, loadComment})`
 * @param {string[]} o.origins   allowlist de origins (nunca `*`)
 * @param {Function} o.log       logger seguro
 * @param {boolean} o.enforceLocal  aceita apenas loopback/sub-rede privada
 */
export function createSocialAIHost({ handler, origins = DEFAULT_ORIGINS, log = createSafeLogger(), limiter = null, enforceLocal = true, maxBodyBytes = 8192, networkInterfaces = undefined, limit = 10, windowMs = 60000 } = {}) {
  if (typeof handler !== 'function') throw new Error('createSocialAIHost exige handler');
  const allowed = parseOrigins(origins);
  const gate = limiter || createRateLimiter({ limit, windowMs });
  const readBody = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) { const e = new Error('PAYLOAD_TOO_LARGE'); e.code = 'PAYLOAD_TOO_LARGE'; throw e; }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  return http.createServer(async (req, res) => {
    const started = Date.now();
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, allowed);
    const send = (status, body) => {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
      if (cors) Object.assign(headers, cors);
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    // Preflight: só origens permitidas recebem CORS; as demais caem sem
    // cabeçalho de autorização (o browser bloqueia de qualquer forma).
    if (req.method === 'OPTIONS') return send(cors ? 204 : 403, cors ? {} : { error: 'cors_denied' });
    if (enforceLocal && !localPeer(req.socket.remoteAddress, networkInterfaces)) return send(403, { error: 'forbidden' });
    if (!req.url.startsWith('/social-ai/')) return send(404, { error: 'not_found' });
    if (origin && !cors) { log({ event: 'cors_denied', route: req.url }); return send(403, { error: 'cors_denied' }); }

    const route = req.url.split('?')[0];
    if (route === '/social-ai/draft') {
      // Limite por IP segura o Ollama de abuso anônimo, antes de qualquer
      // inferência. O limite por usuário fica no handler, que já o resolveu.
      const ip = req.socket.remoteAddress || 'desconhecido';
      const verdict = gate.check(`ip:${ip}`);
      if (!verdict.allowed) { log({ event: 'rate_limited', route, error_code: 'RATE_LIMITED' }); return send(429, { error: 'rate_limited' }); }
      let raw;
      try { raw = await readBody(req); }
      catch (error) { if (error.code === 'PAYLOAD_TOO_LARGE') { log({ event: 'payload_too_large', route }); return send(413, { error: 'payload_too_large' }); } throw error; }
      // `commentId` é obrigatório no corpo real: o TEXTO vem do banco, nunca
      // do navegador. Reaproveitar só o id mantém a fronteira honesta.
      let payload;
      try { payload = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'invalid_payload' }); }
      if (!payload || typeof payload.commentId !== 'string' || !/^[\w:.-]{1,200}$/.test(payload.commentId)) return send(400, { error: 'invalid_payload' });
      const request = new Request(`http://host${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}) }, body: JSON.stringify({ commentId: payload.commentId }) });
      const response = await handler(request);
      const body = await response.json();
      if (response.status === 429) return send(429, { error: 'rate_limited' });
      log({ event: 'draft', status: response.status, duration_ms: Date.now() - started, error_code: body?.error || null });
      return send(response.status, body?.error ? { ...body, message: FALLBACK_MESSAGE } : body);
    }
    if (route === '/social-ai/health') {
      const request = new Request(`http://host${route}`, { method: 'GET', headers: req.headers.authorization ? { authorization: req.headers.authorization } : {} });
      const response = await handler(request);
      const body = await response.json();
      log({ event: 'health', status: response.status, provider: body?.provider || null, model: body?.model || null, duration_ms: Date.now() - started });
      return send(response.status, body);
    }
    return send(404, { error: 'not_found' });
  });
}
