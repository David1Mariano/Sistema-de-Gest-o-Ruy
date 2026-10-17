// API HTTP local de anexos do ADM-RUY (Agente 4).
//
// Roteada pelo servidor de produção ANTES do middleware estático — o site
// continua GET/HEAD e esta rota é a única porta de entrada para anexos.
// Regras transversais aplicadas aqui:
// - CORS por allowlist (nunca `*`); preflight respondido no host;
// - autenticação por `Authorization: Bearer <token>` (sem cookie → CSRF não
//   se aplica a esta rota; ver docs/seguranca-anexos-backup.md);
// - limite de tentativas de login (5 falhas/15 min por e-mail+IP);
// - bootstrap da primeira conta apenas em loopback e só com zero usuários;
// - resposta de conteúdo sempre com o MIME dos metadados + `nosniff`, e o
//   hash SHA-256 é conferido em cada leitura.

import { createAnexosStore, AnexosError, canAccess, ANEXOS_MAX_BYTES, ANEXOS_ID_RE } from './anexos.mjs';
import { createAuthStore, createLoginLimiter, DOWNLOAD_TTL_MS } from './anexosAuth.mjs';

export const ANEXOS_API_PREFIX = '/api/anexos';

export const DEFAULT_ANEXOS_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://ADM-RUY:8080',
]);

const ALLOWED_HEADERS = 'Authorization, Content-Type, X-File-Name, X-Record-Entity, X-Record-Id, X-Attachment-Field';
const ALLOWED_METHODS = 'GET, POST, DELETE, OPTIONS';
const JSON_BODY_LIMIT = 64 * 1024;

export function isLoopbackAddress(address) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  return ip === '::1' || ip === '127.0.0.1' || /^127\./.test(ip);
}

function parseOrigins(raw) {
  return String(raw || '').split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Allowlist de origens: defaults + host da própria requisição (`http://<host>`)
 * + extras via `RUY_ANEXOS_ORIGINS`. Sem origem (img/same-origin) → permitido.
 */
export function originAllowed(origin, { host = '', extra = [] } = {}) {
  if (!origin) return true;
  const allowed = new Set([...DEFAULT_ANEXOS_ORIGINS, ...extra]);
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
    const port = host.split(':').pop();
    if (port && port !== host) {
      allowed.add(`http://localhost:${port}`);
      allowed.add(`http://127.0.0.1:${port}`);
    }
  }
  return allowed.has(origin);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, error, extraHeaders = {}) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || 'erro_interno';
  const message = status >= 500 ? 'Erro interno ao processar a solicitação de anexos.' : (error.message || 'Erro.');
  if (status >= 500) console.error('[anexos] erro interno:', error);
  sendJson(res, status, { error: code, message }, extraHeaders);
}

async function readJsonBody(req, limit = JSON_BODY_LIMIT) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const error = new AnexosError('Corpo da requisição muito grande.', { status: 413, code: 'corpo_grande' });
      error.closeConnection = true;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AnexosError('JSON inválido no corpo da requisição.', { status: 400, code: 'json_invalido' });
  }
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '').trim());
  return match ? match[1].trim() : null;
}

/** Cabeçalhos de upload chegam percent-codificados (nomes com acento/ espaço). */
function headerValue(value) {
  const raw = String(value || '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Cria o handler da rota `/api/anexos`.
 *
 * @param {object} opções
 * @param {string} home            diretório de produção (dono de `anexos/` e `auth/`).
 * @param {() => number} [now]     relógio injetável (testes de expiração).
 * @param {number} [downloadTtlMs] TTL das URLs assinadas de conteúdo.
 * @param {string[]} [extraOrigins] origens extras de DEV via ambiente.
 */
export function createAnexosApi({
  home,
  now,
  downloadTtlMs = DOWNLOAD_TTL_MS,
  extraOrigins,
  sessionTtlMs,
  loopbackOnlyBootstrap = true,
} = {}) {
  if (!home) throw new Error('createAnexosApi requer o diretório `home` de produção.');
  const clock = now || (() => Date.now());
  const store = createAnexosStore({ home, now: () => new Date(clock()).toISOString() });
  const auth = createAuthStore({ home, now: clock, ...(sessionTtlMs ? { sessionTtlMs } : {}) });
  const limiter = createLoginLimiter({ now: clock });
  const extra = extraOrigins ?? parseOrigins(process.env.RUY_ANEXOS_ORIGINS);

  // Varredura única de uploads interrompidos (queda do servidor) na primeira
  // requisição; `ready` é compartilhada para todos os pedidos.
  let ready = null;
  const ensureSwept = () => {
    if (!ready) ready = store.sweepInterrupted({ motivo: 'reinicio_do_servidor' });
    return ready;
  };

  async function requireSession(req) {
    const token = bearerToken(req);
    if (!token) {
      throw new AnexosError('Autenticação necessária para a API de anexos.', { status: 401, code: 'sem_sessao' });
    }
    const actor = await auth.verifySession(token);
    if (!actor) {
      throw new AnexosError('Sessão da API de anexos inválida ou expirada. Entre novamente.', {
        status: 401, code: 'sessao_invalida',
      });
    }
    return actor;
  }

  async function handleLogin(req, res, headers) {
    const body = await readJsonBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const key = `${req.socket.remoteAddress}|${email}`;
    const gate = limiter.check(key);
    if (!gate.allowed) {
      sendJson(res, 429, {
        error: 'tentativas_excedidas',
        message: 'Muitas tentativas de login. Aguarde antes de tentar de novo.',
        retry_after_ms: gate.retryAfterMs,
      }, { ...headers, 'Retry-After': String(Math.ceil(gate.retryAfterMs / 1000) || 1) });
      return;
    }
    try {
      const user = await auth.authenticate({ email, password: body.password });
      limiter.succeed(key);
      const session = await auth.issueSession(user);
      sendJson(res, 200, session, headers);
    } catch (error) {
      limiter.fail(key);
      sendError(res, error, headers);
    }
  }

  async function handleBootstrap(req, res, headers) {
    if (loopbackOnlyBootstrap && !isLoopbackAddress(req.socket.remoteAddress)) {
      sendJson(res, 403, {
        error: 'bootstrap_restrito',
        message: 'O cadastro inicial da API de anexos só é permitido a partir desta máquina (loopback).',
      }, headers);
      return;
    }
    if (await auth.countUsers() > 0) {
      sendJson(res, 409, {
        error: 'bootstrap_indisponivel',
        message: 'Já existe uma conta na API de anexos. Use login ou o script scripts/anexos-user.mjs.',
      }, headers);
      return;
    }
    const body = await readJsonBody(req);
    try {
      const user = await auth.createUser({ email: body.email, password: body.password, role: 'admin', name: body.name });
      sendJson(res, 201, { user }, headers);
    } catch (error) {
      sendError(res, error, headers);
    }
  }

  /**
   * Upload em streaming: valida declaração → grava `.part` → finaliza com
   * validação de conteúdo + hash. Só a resposta 201 declara o anexo pronto.
   */
  async function handleUpload(req, res, headers) {
    const actor = await requireSession(req);
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const fileName = headerValue(req.headers['x-file-name']);
    const entity = headerValue(req.headers['x-record-entity']);
    const recordId = headerValue(req.headers['x-record-id']);
    const field = headerValue(req.headers['x-attachment-field']);
    if (!req.headers['content-length']) {
      throw new AnexosError('Envie o tamanho do arquivo no cabeçalho Content-Length.', {
        status: 411, code: 'tamanho_obrigatorio',
      });
    }
    const declaredLength = Number(req.headers['content-length']);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) {
      throw new AnexosError('Tamanho do arquivo inválido.', { status: 400, code: 'tamanho_invalido' });
    }
    if (declaredLength === 0) {
      throw new AnexosError('O arquivo está vazio.', { status: 422, code: 'arquivo_vazio' });
    }
    if (declaredLength > ANEXOS_MAX_BYTES) {
      throw new AnexosError(`O anexo excede o limite de ${ANEXOS_MAX_BYTES} bytes.`, {
        status: 413, code: 'limite_excedido',
      });
    }
    const { uploadId } = await store.beginUpload({ fileName, mimeType: contentType });
    let finalized = false;
    try {
      for await (const chunk of req) {
        await store.writeUpload(uploadId, chunk);
      }
      const meta = await store.finalizeUpload({ uploadId, entity, recordId, field, actor });
      finalized = true;
      sendJson(res, 201, {
        attachment_id: meta.id,
        available: true,
        status: meta.status,
        sha256: meta.sha256,
        bytes: meta.bytes,
        mime_type: meta.mime_type,
        file_name: meta.file_name,
        entity: meta.entity,
        record_id: meta.record_id,
        field: meta.field,
        created_at: meta.created_at,
        content_url: `${ANEXOS_API_PREFIX}/${meta.id}/conteudo`,
      }, headers);
    } catch (error) {
      if (!finalized) await store.abortUpload(uploadId, error.code || 'erro_upload').catch(() => {});
      if (error.code === 'ERR_STREAM_PREMATURE_CLOSE' || req.aborted) {
        throw new AnexosError('Upload interrompido pelo cliente. Tente novamente.', {
          status: 400, code: 'conexao_interrompida',
        });
      }
      throw error;
    }
  }

  async function loadAuthorizedMeta(req, id) {
    const actor = await requireSession(req);
    const meta = await store.getMeta(id);
    if (!meta) throw new AnexosError('Anexo não encontrado.', { status: 404, code: 'nao_encontrado' });
    if (!canAccess(meta, actor)) {
      throw new AnexosError('Este anexo pertence a outro usuário.', { status: 403, code: 'sem_permissao' });
    }
    return { actor, meta };
  }

  async function serveContent(req, res, id, headers) {
    const meta = await store.getMeta(id);
    if (!meta) throw new AnexosError('Anexo não encontrado.', { status: 404, code: 'nao_encontrado' });
    let authorized = false;
    const tk = new URL(req.url, 'http://anexos.local').searchParams.get('tk');
    if (tk) {
      authorized = await auth.verifyDownload({ attachmentId: meta.id, token: tk });
    }
    if (!authorized) {
      // Sem URL assinada, exige sessão + dono/admin (mesma política dos metadados).
      const actor = await requireSession(req);
      if (!canAccess(meta, actor)) {
        throw new AnexosError('Este anexo pertence a outro usuário.', { status: 403, code: 'sem_permissao' });
      }
    }
    // A leitura confere o SHA-256: adulteração no disco nunca é servida.
    const bytes = await store.readContent(meta);
    res.writeHead(200, {
      ...headers,
      'Content-Type': meta.mime_type,
      'Content-Length': bytes.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.file_name)}`,
    });
    res.end(bytes);
  }

  const FIXED_ROUTES = new Set(['', '/ping', '/auth/login', '/auth/bootstrap', '/pendencias']);
  const ID_ROUTE = /^\/(anx_[0-9a-f]{32})(\/(?:conteudo|url-assinada))?$/;

  return async function handleAnexosApi(req, res) {
    await ensureSwept();
    const origin = String(req.headers.origin || '');
    const host = String(req.headers.host || '');
    const corsAllowed = originAllowed(origin, { host, extra });
    const headers = origin
      ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      }
      : {};

    if (origin && !corsAllowed) {
      sendJson(res, 403, { error: 'cors_negado', message: 'Origem não autorizada para a API de anexos.' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://anexos.local').pathname);
    } catch {
      sendJson(res, 400, { error: 'url_invalida', message: 'Caminho inválido.' }, headers);
      return;
    }
    if (!pathname.startsWith(ANEXOS_API_PREFIX)) {
      sendJson(res, 404, { error: 'nao_encontrado', message: 'Rota inexistente.' }, headers);
      return;
    }
    const rel = pathname.slice(ANEXOS_API_PREFIX.length);

    try {
      if (rel === '/ping' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, service: 'anexos-locais', max_bytes: ANEXOS_MAX_BYTES }, headers);
        return;
      }
      if (rel === '/auth/login' && req.method === 'POST') {
        await handleLogin(req, res, headers);
        return;
      }
      if (rel === '/auth/bootstrap' && req.method === 'POST') {
        await handleBootstrap(req, res, headers);
        return;
      }
      if (rel === '' && req.method === 'POST') {
        await handleUpload(req, res, headers);
        return;
      }
      if (rel === '/pendencias' && req.method === 'GET') {
        const actor = await requireSession(req);
        if (actor.role !== 'admin') {
          throw new AnexosError('Apenas administradores consultam a fila de pendências.', {
            status: 403, code: 'sem_permissao',
          });
        }
        sendJson(res, 200, { pendencias: await store.listPendencias() }, headers);
        return;
      }

      const idMatch = ID_ROUTE.exec(rel);
      if (idMatch) {
        const [, id, sub] = idMatch;
        if (!sub && req.method === 'GET') {
          const { meta } = await loadAuthorizedMeta(req, id);
          sendJson(res, 200, meta, headers);
          return;
        }
        if (!sub && req.method === 'DELETE') {
          const { actor } = await loadAuthorizedMeta(req, id);
          sendJson(res, 200, await store.deleteAttachment({ id, actor }), headers);
          return;
        }
        if (sub === '/conteudo' && req.method === 'GET') {
          await serveContent(req, res, id, headers);
          return;
        }
        if (sub === '/url-assinada' && req.method === 'POST') {
          const { meta } = await loadAuthorizedMeta(req, id);
          const signed = await auth.signDownload({ attachmentId: meta.id, ttlMs: downloadTtlMs });
          sendJson(res, 200, {
            url: `${ANEXOS_API_PREFIX}/${meta.id}/conteudo?tk=${encodeURIComponent(signed.token)}`,
            expires_in: signed.expires_in,
          }, headers);
          return;
        }
        sendJson(res, 405, { error: 'metodo_nao_permitido', message: 'Método não permitido para este anexo.' }, headers);
        return;
      }
      if (FIXED_ROUTES.has(rel)) {
        sendJson(res, 405, { error: 'metodo_nao_permitido', message: 'Método não permitido.' }, headers);
        return;
      }
      sendJson(res, 404, { error: 'nao_encontrado', message: 'Rota inexistente.' }, headers);
    } catch (error) {
      if (error?.closeConnection) {
        sendError(res, error, headers);
        setImmediate(() => req.destroy());
        return;
      }
      sendError(res, error, headers);
    }
  };
}



