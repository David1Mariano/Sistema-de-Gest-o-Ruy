// ===========================================================================
// Cliente S3/Cloudflare R2 — SigV4 com `node:crypto`, sem SDK.
//
// POR QUE SEM O AWS SDK: o projeto não usa o AWS SDK em lugar nenhum, e
// adicionar megabytes de dependência para assinar quatro requisições seria
// aumento de superfície sem ganho. A API do S3 usada aqui é pequena e
// estável (PUT/GET/HEAD/DELETE de um objeto + URL pré-assinada), e o
// SigV4 cabe em `node:crypto`.
//
// POR QUE ISTO SÓ EXISTE NO BACKEND: as credenciais (`R2_ACCESS_KEY_ID`,
// `R2_SECRET_ACCESS_KEY`) entram por `process.env` e NUNCA são exportadas,
// logadas ou devolvidas. Um `src/` com este arquivo no bundle já seria
// vazamento de segredo. `scripts/test-storage-r2.mjs` verifica isso.
//
// REGIAS QUE NÃO SE NEGOCIAM:
//   - `request` é INJETÁVEL. Os testes nunca tocam a rede.
//   - Nenhum método loga corpo, cabeçalho assinado ou chave.
//   - Nenhum método apaga nada sem `deleteObject` ser chamado explicitamente.
// ===========================================================================
import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// RFC 3986: `encodeURIComponent` deixa `!'()*` intactos, e o S3 exige escape
// nesses cinco caracteres — sem isso a assinatura muda e o R2 devolve 403.
const rfc3986 = (value) => encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Cada segmento do caminho é codificado; a barra continua sendo separador. */
export function encodeKeyPath(key) {
  return String(key).split('/').map(rfc3986).join('/');
}

function assertEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) throw new Error('R2_ENDPOINT nao configurada no backend');
  const url = new URL(endpoint.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('R2_ENDPOINT invalida');
  if (url.username || url.password || url.search || url.hash) throw new Error('R2_ENDPOINT invalida');
  return url.origin.replace(/\/+$/, '');
}

const amzDate = (date) => `${date.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;

function signingKey(secretAccessKey, dateStamp, region) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}

function canonicalQuery(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`)
    .join('&');
}

function canonicalHeaders(headers) {
  const keys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  return {
    canonical: keys.map((key) => `${key}:${String(headers[keys.find((k) => k.toLowerCase() === key)]).trim()}\n`).join(''),
    signed: keys.join(';'),
  };
}

function buildCanonicalRequest({ method, path, query, headers, payloadHash }) {
  const { canonical, signed } = canonicalHeaders(headers);
  return [`${method}\n${path}\n${query}\n${canonical}\n${signed}\n${payloadHash}`].join('\n');
}

function buildScope(dateStamp, region) {
  return `${dateStamp}/${region}/${SERVICE}/aws4_request`;
}
/**
 * Cliente do R2. Toda a rede passa por `request(url, init)`, injetável nos
 * testes. Sem `request` válido o construtor falha — não existe caminho que
 * "tente a rede real" por acidente.
 *
 * @param {object} o
 * @param {string} o.endpoint         https://<account>.r2.cloudflarestorage.com
 * @param {string} o.accessKeyId      R2_ACCESS_KEY_ID
 * @param {string} o.secretAccessKey  R2_SECRET_ACCESS_KEY
 * @param {string} o.bucket           R2_BUCKET
 * @param {string} [o.region=auto]    R2 usa `auto`
 * @param {Function} [o.request]      injetável; nunca `fetch` cru nos testes
 * @param {Function} [o.now]          injetável; assinatura determinística
 */
export function createR2Client({
  endpoint, accessKeyId, secretAccessKey, bucket, region = 'auto',
  request, now = () => new Date(),
} = {}) {
  if (typeof request !== 'function') throw new Error('createR2Client requer request()');
  const origin = assertEndpoint(endpoint);
  const bucketName = typeof bucket === 'string' ? bucket.trim() : '';
  if (!bucketName) throw new Error('R2_BUCKET nao configurada no backend');
  const keyId = typeof accessKeyId === 'string' ? accessKeyId.trim() : '';
  const secret = typeof secretAccessKey === 'string' ? secretAccessKey.trim() : '';
  if (!keyId || !secret) throw new Error('R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY nao configuradas no backend');

  const bucketPath = `/${rfc3986(bucketName)}`;
  const urlHost = new URL(origin).host;

  function sign({ method, key, query = {}, headers = {}, payloadHash, date = now() }) {
    const stamp = amzDate(date);
    const dateStamp = stamp.slice(0, 8);
    const path = `${bucketPath}/${encodeKeyPath(key)}`;
    const allHeaders = { host: urlHost, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, ...headers };
    const { canonical, signed: signedHeaders } = canonicalHeaders(allHeaders);
    const stringToSign = [ALGORITHM, stamp, buildScope(dateStamp, region), sha256Hex(
      buildCanonicalRequest({ method, path, query: canonicalQuery(query), headers: allHeaders, payloadHash }),
    )].join('\n');
    const signature = createHmac('sha256', signingKey(secret, dateStamp, region)).update(stringToSign).digest('hex');
    return { path, query, headers: allHeaders, signedHeaders, stamp, dateStamp, scope: buildScope(dateStamp, region), signature, stringToSign };
  }

  const authorization = (signed, signedHeaders) => `${ALGORITHM} Credential=${keyId}/${signed.scope}, SignedHeaders=${signedHeaders}, Signature=${signed.signature}`;

  async function call(method, key, { query = {}, headers = {}, body, contentType } = {}) {
    const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
    const signed = sign({
      method, key, query,
      headers: contentType ? { 'content-type': contentType, ...headers } : headers,
      payloadHash,
    });
    const qs = canonicalQuery(signed.query);
    return request(`${origin}${signed.path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: { ...signed.headers, authorization: authorization(signed, signed.signedHeaders) },
      body,
      signal: AbortSignal.timeout(20000),
    });
  }

  // ------------------------------------------------------------------ ops

  /** Grava um objeto. `upsert: false` é o padrão e não é negociável. */
  async function putObject(key, body, { contentType, cacheControl = 'private, max-age=3600' } = {}) {
    const response = await call('PUT', key, {
      body,
      contentType,
      headers: { 'cache-control': cacheControl },
    });
    if (!response.ok) throw await erroR2('PUT', key, response);
    return { key, contentType: contentType || '', size: body?.length ?? 0 };
  }

  /** Lê um objeto inteiro. 404 vira `R2_NOT_FOUND`, não exceção opaca. */
  async function getObject(key) {
    const response = await call('GET', key);
    if (response.status === 404) throw erro('R2_NOT_FOUND', `Objeto inexistente no R2: ${key}`);
    if (!response.ok) throw await erroR2('GET', key, response);
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      key,
      body: buffer,
      size: buffer.length,
      contentType: (response.headers.get('content-type') || '').split(';')[0].toLowerCase(),
      etag: response.headers.get('etag') || '',
    };
  }

  /** Existe? Head não baixa corpo — é o que o `exists` do serviço usa. */
  async function headObject(key) {
    const response = await call('HEAD', key);
    if (response.status === 404) return { exists: false, key };
    if (!response.ok) throw await erroR2('HEAD', key, response);
    return {
      exists: true,
      key,
      size: Number(response.headers.get('content-length') || 0),
      contentType: (response.headers.get('content-type') || '').split(';')[0].toLowerCase(),
      etag: response.headers.get('etag') || '',
    };
  }

  /**
   * Apaga um objeto. NÃO é chamado por nenhum fluxo automático: o serviço
   * só chega aqui quando o chamador pediu e a exclusão está habilitada.
   */
  async function deleteObject(key) {
    const response = await call('DELETE', key);
    if (response.status === 404) return { deleted: false, key, reason: 'not_found' };
    if (!response.ok) throw await erroR2('DELETE', key, response);
    return { deleted: true, key };
  }

  /**
   * URL pré-assinada (SigV4 na query string, `UNSIGNED-PAYLOAD`).
   * É o mecanismo de leitura: o navegador recebe a URL temporária, traz o
   * arquivo como Blob e nada de credencial atravessa a rede do app.
   */
  async function createPresignedUrl(key, { expiresIn = 300, method = 'GET', responseContentType, responseContentDisposition, date = now() } = {}) {
    const ttl = Math.min(Math.max(1, Math.floor(Number(expiresIn) || 300)), 604800);
    const query = {
      'X-Amz-Algorithm': ALGORITHM,
      'X-Amz-Credential': `${keyId}/${buildScope(amzDate(date).slice(0, 8), region)}`,
      'X-Amz-Date': amzDate(date),
      'X-Amz-Expires': String(ttl),
      'X-Amz-SignedHeaders': 'host',
    };
    if (responseContentType) query['response-content-type'] = responseContentType;
    if (responseContentDisposition) query['response-content-disposition'] = responseContentDisposition;
    const signed = sign({ method, key, query, headers: {}, payloadHash: UNSIGNED_PAYLOAD, date });
    return {
      url: `${origin}${signed.path}?${canonicalQuery(signed.query)}&X-Amz-Signature=${signed.signature}`,
      expiresIn: ttl,
    };
  }

  return Object.freeze({
    bucket: bucketName,
    endpoint: origin,
    putObject, getObject, headObject, deleteObject, createPresignedUrl,
    // Exposto só para teste/auditoria da assinatura; não é usado em runtime.
    __sign: sign,
  });
}

// Erro de transporte com código estável. A mensagem do R2 NUNCA é repassada
// para o navegador: pode conter endpoint, account id ou trecho do corpo.
function erro(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function erroR2(method, key, response) {
  let body = '';
  try { body = (await response.text()).slice(0, 200); } catch { /* corpo ilegível */ }
  const error = erro(response.status === 403 ? 'R2_FORBIDDEN' : response.status === 404 ? 'R2_NOT_FOUND' : 'R2_ERROR',
    `R2 ${method} falhou (HTTP ${response.status})`);
  error.status = response.status;
  error.detail = body; // só para log do OPERADOR no backend; nunca vai ao cliente
  return error;
}
