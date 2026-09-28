import { getAccessToken, supabase } from './supabaseClient.js';

export const PAYMENT_PROOF_BUCKET = 'anexos';
export const PAYMENT_PROOF_PREFIX = 'EmployeePayment';
export const PAYMENT_PROOF_SIGNED_TTL_SECONDS = 300;
export const PAYMENT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const PAYMENT_PROOF_MAX_BYTES = 15 * 1024 * 1024;

// Mantido apenas para compatibilidade com imports antigos do piloto.
export const PRIVATE_STORAGE_BLOCKED = 'O upload privado de comprovantes está indisponível nesta sessão.';

// Diagnóstico temporário do piloto. Registra APENAS metadados seguros:
// nunca access token, refresh token, senha, anon key, service_role ou base64.
export const PAYMENT_PROOF_DIAG = '[comprovante]';

function proofUrlKind(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',');
    return comma > 0 ? value.slice(0, comma).slice(0, 40) : 'data:';
  }
  return `${value.split(':')[0].slice(0, 12)}:`;
}

function diagMeta(payment) {
  return {
    employeePaymentId: payment?.id || null,
    proofUrlPresente: Boolean(payment?.proof_url),
    proofUrlTipo: proofUrlKind(payment?.proof_url),
    proofUrlTamanho: payment?.proof_url ? String(payment.proof_url).length : 0,
    storagePath: payment?.storage_path || null,
    fileName: payment?.file_name || null,
    mimeType: payment?.mime_type || null,
    fileSize: payment?.file_size ?? null,
  };
}

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function validateTypeAndSize(file) {
  if (!file || !file.size) throw new Error('O comprovante está vazio.');
  if (!PAYMENT_PROOF_TYPES.includes(file.type)) {
    throw new Error('Selecione um arquivo JPG, PNG, WEBP ou PDF.');
  }
}

export function validatePaymentProofFile(file) {
  validateTypeAndSize(file);
  if (file.size > PAYMENT_PROOF_MAX_BYTES) {
    throw new Error('O comprovante excede o limite de 15 MB (15.728.640 bytes).');
  }
  if (file.name && !/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) {
    throw new Error('A extensão do arquivo deve ser JPG, PNG, WEBP ou PDF.');
  }
}

export function paymentProofExtension(file) {
  const extension = EXTENSION_BY_MIME[file?.type];
  if (!extension) throw new Error('Tipo de comprovante não permitido.');
  return extension;
}

function randomUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Não foi possível gerar um identificador seguro para o comprovante.');
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildPaymentProofPath(recordId, file) {
  if (!recordId || typeof recordId !== 'string' || /[\\/]/.test(recordId)) {
    throw new Error('Pagamento sem ID definitivo para o comprovante.');
  }
  validatePaymentProofFile(file);
  return `${PAYMENT_PROOF_PREFIX}/${recordId}/${randomUuid()}.${paymentProofExtension(file)}`;
}

export function validateStoragePath(path, prefix = PAYMENT_PROOF_PREFIX) {
  if (typeof path !== 'string' || !path.startsWith(`${prefix}/`)) {
    throw new Error(`Caminho de comprovante inválido. Use o prefixo ${prefix}/{id}/{arquivo}.`);
  }
  const parts = path.split('/');
  if (parts.length !== 3 || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Caminho de comprovante inválido.');
  }
  if (!/\.(jpe?g|png|webp|pdf)$/i.test(parts[2])) {
    throw new Error('Caminho de comprovante inválido.');
  }
  return path;
}

export function dataUrlToPaymentBlob(value) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value);
  if (!match) throw new Error('Comprovante base64 inválido.');
  const type = match[1].toLowerCase();
  if (!PAYMENT_PROOF_TYPES.includes(type)) {
    throw new Error('Tipo de comprovante não permitido. Use JPG, PNG, WEBP ou PDF.');
  }
  const encoded = match[2].replace(/\s/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Comprovante base64 inválido.');
  }
  try {
    const decoded = atob(encoded);
    return new Blob([Uint8Array.from(decoded, (char) => char.charCodeAt(0))], { type });
  } catch {
    throw new Error('Não foi possível decodificar o comprovante base64.');
  }
}

export async function validateContent(blob) {
  // O limite de novos uploads não deve impedir a leitura de comprovantes legados.
  validateTypeAndSize(blob);
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = {
    'image/jpeg': bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10',
    'image/webp': ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'application/pdf': ascii(0, 5) === '%PDF-',
  };
  if (!valid[blob.type]) {
    throw new Error('O conteúdo recebido não corresponde ao tipo do comprovante. O arquivo pode estar corrompido.');
  }
  return blob;
}

async function authorizeStorage(accessToken) {
  try {
    const token = await accessToken();
    if (!token || typeof token !== 'string') throw new Error('sessão inválida');
    return token;
  } catch (error) {
    throw new Error(`Não foi possível autorizar o Storage com Supabase Auth: ${error.message || 'sessão inválida.'}`);
  }
}

export async function uploadPaymentProof({
  recordId,
  file,
  storageClient = supabase.storage.from(PAYMENT_PROOF_BUCKET),
  accessToken = getAccessToken,
} = {}) {
  validatePaymentProofFile(file);
  await validateContent(file);
  const path = buildPaymentProofPath(recordId, file);
  await authorizeStorage(accessToken);

  const { data, error } = await storageClient.upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    console.error(PAYMENT_PROOF_DIAG, 'upload falhou', {
      recordId, bucket: PAYMENT_PROOF_BUCKET, path, mimeType: file.type, fileSize: file.size,
      errorStatus: error?.status ?? null, errorCode: error?.code ?? null, errorMessage: error?.message || null,
    });
    throw new Error(`Falha ao enviar comprovante ao Storage: ${error.message}`);
  }
  if (!data?.path) throw new Error('O Storage não confirmou o caminho do comprovante.');

  // Confirma que o objeto realmente existe no bucket (sem bytes de arquivo).
  const listed = typeof storageClient.list === 'function'
    ? await storageClient.list(`${PAYMENT_PROOF_PREFIX}/${recordId}`)
    : null;
  console.info(PAYMENT_PROOF_DIAG, 'upload ok', {
    recordId, bucket: PAYMENT_PROOF_BUCKET, path, mimeType: file.type, fileSize: file.size,
    listError: listed?.error?.message || null,
    listPaths: Array.isArray(listed?.data) ? listed.data.map((o) => o?.name) : null,
  });

  return {
    storage_path: path,
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
  };
}

async function loadPrivatePaymentProof(payment, {
  signal,
  prefix = PAYMENT_PROOF_PREFIX,
  diagLabel = PAYMENT_PROOF_DIAG,
  storageClient = supabase.storage.from(PAYMENT_PROOF_BUCKET),
  accessToken = getAccessToken,
} = {}) {
  const path = validateStoragePath(payment.storage_path, prefix);
  await authorizeStorage(accessToken);
  const { data, error } = await storageClient.createSignedUrl(path, PAYMENT_PROOF_SIGNED_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error(diagLabel, 'signed URL FALHOU', {
      ...diagMeta(payment), metodo: 'STORAGE_SIGNED_URL', path,
      errorStatus: error?.status ?? null, errorCode: error?.code ?? null, errorMessage: error?.message || null,
    });
    throw new Error(`Não foi possível gerar a URL temporária do comprovante: ${error?.message || 'acesso negado.'}`);
  }
  console.info(diagLabel, 'signed URL gerada', { ...diagMeta(payment), metodo: 'STORAGE_SIGNED_URL', path });

  let response;
  try {
    response = await fetch(data.signedUrl, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Não foi possível carregar o comprovante privado.');
  }
  if (!response.ok) {
    console.error(PAYMENT_PROOF_DIAG, 'download da signed URL falhou', { path, httpStatus: response.status });
    throw new Error(`Falha ao carregar comprovante privado (HTTP ${response.status}).`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  console.info(PAYMENT_PROOF_DIAG, 'download ok', { path, httpStatus: response.status, contentType });
  if (!PAYMENT_PROOF_TYPES.includes(contentType)) {
    throw new Error('O Storage devolveu um tipo de conteúdo não permitido para o comprovante.');
  }
  return validateContent(new Blob([await response.arrayBuffer()], { type: contentType }));
}

export async function loadPaymentProof(payment, options = {}) {
  const metodo = payment?.storage_path ? 'STORAGE_SIGNED_URL' : 'LEGACY_BLOB';
  const tag = options.diagLabel || PAYMENT_PROOF_DIAG;
  console.info(tag, 'abrindo comprovante', { ...diagMeta(payment), metodo });
  if (payment?.storage_path) return loadPrivatePaymentProof(payment, options);

  const value = payment?.proof_url;
  if (!value || typeof value !== 'string') throw new Error('Pagamento sem comprovante.');
  if (value.startsWith('data:')) return validateContent(dataUrlToPaymentBlob(value));

  let url;
  try { url = new URL(value); } catch { throw new Error('URL do comprovante inválida.'); }
  if (!['https:', 'http:', 'blob:'].includes(url.protocol)) {
    throw new Error('Protocolo de comprovante não permitido.');
  }
  let response;
  try {
    response = await fetch(url.href, {
      signal: options.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error(url.protocol === 'blob:'
      ? 'A Blob URL antiga não está mais disponível. Ela não é um comprovante persistente; é necessário recuperar o arquivo original.'
      : 'Não foi possível carregar o comprovante. Verifique acesso, rede e CORS.');
  }
  if (!response.ok) {
    throw new Error(`Falha ao carregar comprovante (HTTP ${response.status}). Verifique se o arquivo existe e se a URL expirou ou o acesso foi negado.`);
  }
  return validateContent(await response.blob());
}
