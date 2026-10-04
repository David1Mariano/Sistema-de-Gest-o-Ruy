import { getAccessToken, supabase } from './supabaseClient.js';
import {
  ATTACHMENT_SIGNED_TTL_SECONDS,
  ATTACHMENT_TYPES as STORAGE_ATTACHMENT_TYPES,
  ATTACHMENT_MAX_BYTES as STORAGE_ATTACHMENT_MAX_BYTES,
  ATTACHMENT_ORIGIN,
  STORAGE_PROVIDER,
  resolveAttachmentSource,
  storagePathPrefix,
  validateStoragePath as validateStoragePathContract,
} from './storage/attachmentPath.js';
import { createAttachmentStorageClient } from './storage/attachmentClient.js';

// Bucket legado do Supabase Storage. Continua sendo o destino padrão de
// leitura e de upload: o registro que não foi marcado `storage_provider`
// vem SEMPRE do Supabase, sem exceção e sem tentativa automática no R2.
export const PAYMENT_PROOF_BUCKET = 'anexos';
export const PAYMENT_PROOF_PREFIX = 'EmployeePayment';
export const PAYMENT_PROOF_SIGNED_TTL_SECONDS = ATTACHMENT_SIGNED_TTL_SECONDS;
export const PAYMENT_PROOF_TYPES = STORAGE_ATTACHMENT_TYPES;
export const PAYMENT_PROOF_MAX_BYTES = STORAGE_ATTACHMENT_MAX_BYTES;

// Mantido apenas para compatibilidade com imports antigos do piloto.
export const PRIVATE_STORAGE_BLOCKED = 'O upload privado de comprovantes está indisponível nesta sessão.';

// ---------------------------------------------------------------------------
// ENDPOINT DO BACKEND DE ARQUIVOS.
//
// Só uma URL interna. Nenhuma credencial, nenhuma access key, nenhum
// segredo: o backend assina a URL com as chaves que ficam nele.
// Ausente (hoje) => o cliente falha fechado e o provedor legado segue
// funcionando normalmente.
// ---------------------------------------------------------------------------
export const STORAGE_API_ENDPOINT = import.meta.env?.VITE_STORAGE_API_URL || '';

// Cliente único, criado sob demanda: sem endpoint ele nem é construído.
let clienteAnexos = null;
export function attachmentStorageClient() {
  if (clienteAnexos) return clienteAnexos;
  clienteAnexos = createAttachmentStorageClient({ endpoint: STORAGE_API_ENDPOINT, getToken: getAccessToken });
  return clienteAnexos;
}

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

// O caminho é o MESMO nos dois provedores e em todas as entidades:
// `{Prefixo}/{id-do-registro}/{uuid}.{ext}`. É o formato que já existe no
// bucket `anexos` e, portanto, o que a cópia para o R2 preservou.
export function buildPaymentProofPath(recordId, file, prefix = PAYMENT_PROOF_PREFIX) {
  if (!recordId || typeof recordId !== 'string' || /[\\/]/.test(recordId)) {
    throw new Error('Pagamento sem ID definitivo para o comprovante.');
  }
  validatePaymentProofFile(file);
  return `${prefix}/${recordId}/${randomUuid()}.${paymentProofExtension(file)}`;
}

// O contrato de caminho mora em `storage/attachmentPath.js` — o mesmo
// arquivo usado pelo backend. Aqui só existe a reexportação com o prefixo
// padrão, porque o chamador já passa o prefixo certo.
export function validateStoragePath(path, prefix = PAYMENT_PROOF_PREFIX) {
  return validateStoragePathContract(path, prefix);
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

/**
 * Upload no R2. O navegador envia o binário ao BACKEND; o backend assina a
 * gravação com as chaves que ficam nele. O registro devolve exatamente o
 * mesmo conjunto de metadados do caminho legado, acrescido de
 * `storage_provider`/`storage_bucket` — que é o que faz a próxima leitura
 * saber de onde buscar.
 *
 * FALHA FECHADA (requisito da Fase 2): se o upload não acontecer, este
 * método LANÇA. Ele nunca devolve `proof_url` em base64, nunca devolve
 * caminho sem objeto e nunca "simula" sucesso. O `PaymentForm` trata o erro
 * e mantém o comprovante anterior — o Operator vê a mensagem, e o registro
 * não nasce com anexo que não existe.
 */
async function uploadR2Attachment({ recordId, file, prefix, storageApiClient }) {
  const path = buildPaymentProofPath(recordId, file, prefix);
  try {
    const reference = await storageApiClient.upload({ prefix, recordId, file });
    if (!reference?.storage_path || reference?.storage_provider !== STORAGE_PROVIDER.R2) {
      throw new Error('O armazenamento não confirmou onde o comprovante foi gravado.');
    }
    console.info(PAYMENT_PROOF_DIAG, 'upload R2 ok', {
      recordId, path: reference.storage_path, mimeType: file.type, fileSize: file.size,
    });
    return reference;
  } catch (error) {
    console.error(PAYMENT_PROOF_DIAG, 'upload R2 falhou', {
      recordId, path, mimeType: file.type, fileSize: file.size,
      errorCode: error?.code ?? null, errorStatus: error?.status ?? null,
    });
    if (error?.code === 'not_configured') {
      throw new Error('O envio para o novo armazenamento ainda não está configurado neste ambiente. Nada foi anexado.');
    }
    if (error?.code === 'unauthorized' || error?.code === 'forbidden') {
      throw new Error('Sua sessão não autorizou o envio do comprovante. Nada foi anexado.');
    }
    throw new Error('Falha ao enviar o comprovante. Nada foi anexado — tente novamente.');
  }
}

// ---------------------------------------------------------------------------
// UPLOAD.
//
// `provider` decide o destino e o padrão é `supabase`: com a ausência
// explícita de provider, o comportamento é exatamente o de antes desta
// etapa — mesmo bucket, mesmo caminho, mesmas três linhas no log. O R2
// entra por marcação, nunca por detecção.
//
// O caminho gerado é IDÊNTICO nos dois provedores
// (`EmployeePayment/{id}/{uuid}.{ext}`), então o R2 recebe o objeto em
// `anexos/EmployeePayment/{id}/{uuid}.{ext}` — exatamente onde a cópia já
// feita deixou os arquivos antigos. Não existe um segundo formato de
// caminho convivendo com o primeiro.
// ---------------------------------------------------------------------------
export async function uploadPaymentProof({
  recordId,
  file,
  provider,
  prefix = PAYMENT_PROOF_PREFIX,
  storageClient = supabase.storage.from(PAYMENT_PROOF_BUCKET),
  accessToken = getAccessToken,
  storageApiClient = attachmentStorageClient(),
} = {}) {
  validatePaymentProofFile(file);
  await validateContent(file);

  // Sem provider explícito, quem decide é o BACKEND (feature flag
  // STORAGE_WRITE_PROVIDER). O padrão é o comportamento de antes desta fase:
  // bucket `anexos` do Supabase. `paymentProof.js` é o ÚNICO chamador de
  // `uploadPaymentProof`, então a flag liga exatamente o EmployeePayment.
  const destino = provider || await storageApiClient.writeProvider();

  if (destino === STORAGE_PROVIDER.R2) {
    return uploadR2Attachment({ recordId, file, prefix, storageApiClient });
  }
  if (destino !== STORAGE_PROVIDER.SUPABASE) {
    // Provider desconhecido é falha, não palpite: arquivo silêncio no lugar
    // errado é pior do que erro na tela.
    throw new Error('Provedor de armazenamento desconhecido. Nada foi enviado.');
  }

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

// ---------------------------------------------------------------------------
// R2 — LEITURA.
//
// Só é usado quando o registro está MARCADO com `storage_provider: 'r2'`.
// A sequência é a mesma do Supabase: pedir URL temporária ao backend,
// baixar os bytes, conferir o Content-Type e validar o conteúdo. O arquivo
// chega ao `AttachmentPreview` como Blob, exatamente como sempre — nenhum
// byte de mudança no visualizador.
// ---------------------------------------------------------------------------
async function loadR2Attachment(payment, {
  signal,
  prefix = PAYMENT_PROOF_PREFIX,
  diagLabel = PAYMENT_PROOF_DIAG,
  storageApiClient = attachmentStorageClient(),
} = {}) {
  const path = validateStoragePath(payment.storage_path, prefix);
  let signedUrl;
  try {
    signedUrl = await storageApiClient.signedUrl(path, { prefix, signal });
  } catch (error) {
    // Falha do backend vira mensagem de tela, não crash: o anexo continua
    // sendo um registro válido e o operador pode tentar de novo.
    console.error(diagLabel, 'signed URL R2 FALHOU', {
      ...diagMeta(payment), metodo: 'R2_SIGNED_URL', path,
      errorCode: error?.code ?? null, errorStatus: error?.status ?? null,
    });
    throw new Error(
      error?.code === 'not_configured'
        ? 'O armazenamento de arquivos ainda não está configurado neste ambiente.'
        : error?.code === 'unauthorized' || error?.code === 'forbidden'
          ? 'Sua sessão não autorizou a leitura deste comprovante. Entre novamente.'
          : 'Não foi possível gerar a URL temporária do comprovante.',
    );
  }

  console.info(diagLabel, 'signed URL R2 gerada', { ...diagMeta(payment), metodo: 'R2_SIGNED_URL', path });

  let response;
  try {
    response = await fetch(signedUrl, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Não foi possível carregar o comprovante.');
  }
  if (!response.ok) {
    console.error(diagLabel, 'download da signed URL R2 falhou', { path, httpStatus: response.status });
    throw new Error(`Falha ao carregar comprovante privado (HTTP ${response.status}).`);
  }
  const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  console.info(diagLabel, 'download R2 ok', { path, httpStatus: response.status, contentType });
  if (!PAYMENT_PROOF_TYPES.includes(contentType)) {
    throw new Error('O armazenamento devolveu um tipo de conteúdo não permitido para o comprovante.');
  }
  return validateContent(new Blob([await response.arrayBuffer()], { type: contentType }));
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

// ---------------------------------------------------------------------------
// RESOLUÇÃO DO ANEXO — o ponto único de decisão.
//
// Ordem fixa, sem exceção e sem tentativa automática entre provedores:
//
//   storage_provider === 'r2'  -> R2 (URL assinada pelo backend)
//   storage_path sem provider  -> Supabase legado (bucket `anexos`)
//   'data:...'                  -> base64 gravado dentro do registro
//   'http(s)://...' / 'blob:...'-> URL (legado Base44 / Blob URL)
//
// NÃO existe fallback automático "tenta o R2 e, se falhar, tenta o Supabase":
// um erro do R2 com objeto presente no Supabase viraria leitura sem
// registro, e um erro do Supabase viria esconder defeito do R2. Durante a
// transição quem está marcado lê de onde está marcado.
// ---------------------------------------------------------------------------
export async function loadPaymentProof(payment, options = {}) {
  const source = resolveAttachmentSource(payment, { field: options.field, prefix: options.prefix });
  const metodo = source.origin === ATTACHMENT_ORIGIN.R2
    ? 'R2_SIGNED_URL'
    : source.origin === ATTACHMENT_ORIGIN.SUPABASE
      ? 'STORAGE_SIGNED_URL'
      : 'LEGACY_BLOB';
  const tag = options.diagLabel || PAYMENT_PROOF_DIAG;
  console.info(tag, 'abrindo comprovante', { ...diagMeta(payment), metodo });

  if (source.origin === ATTACHMENT_ORIGIN.R2) return loadR2Attachment(payment, options);
  if (source.origin === ATTACHMENT_ORIGIN.SUPABASE) return loadPrivatePaymentProof(payment, options);

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
