// ===========================================================================
// SERVIÇO CENTRAL DE ARQUIVOS.
//
// Este é o `storageService` do enunciado: UM lugar, no BACKEND, com
// upload / download / getSignedUrl / delete / exists. Nenhum componente
// React fala com R2 ou S3 diretamente — o frontend só conhece o cliente
// HTTP (`src/lib/storage/attachmentClient.js`), que não tem credencial.
//
// O QUE ESTE SERVIÇO NÃO FAZ, por desenho:
//   - não apaga nada por conta própria (item 14): `delete` exige pedido
//     explícito E `allowDelete` ligado no host;
//   - não formata caminho: usa `attachmentPath.js`, o contrato único;
//   - não inventa provedor: quem grava decide, e o registro carrega
//     `storage_provider`;
//   - não devolve credencial, endpoint ou chave em nenhuma resposta.
// ===========================================================================
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PREFIXES,
  ATTACHMENT_SIGNED_TTL_SECONDS,
  ATTACHMENT_TYPES,
  STORAGE_BUCKET_R2,
  STORAGE_PROVIDER,
  STORAGE_R2_PREFIX,
  attachmentReference,
  r2ObjectKey,
  storagePathPrefix,
  validateStoragePath,
} from '../../src/lib/storage/attachmentPath.js';

const ERRORS = Object.freeze({
  NOT_CONFIGURED: 'STORAGE_NOT_CONFIGURED',
  INVALID_PATH: 'STORAGE_INVALID_PATH',
  INVALID_FILE: 'STORAGE_INVALID_FILE',
  DELETE_DISABLED: 'STORAGE_DELETE_DISABLED',
  NOT_FOUND: 'STORAGE_NOT_FOUND',
});

export const STORAGE_ERRORS = ERRORS;

function falhar(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// O caminho é validado DUAS vezes: forma do contrato e prefixo conhecido.
// Sem o segundo passo um `storage_path` válido para `Purchase` seria
// assinado quando o chamador pediu `Vale`.
function caminhoDoServico(path, prefix) {
  const prefixo = prefix || storagePathPrefix(path);
  if (!prefixo || !ATTACHMENT_PREFIXES.includes(prefixo)) {
    throw falhar(ERRORS.INVALID_PATH, 'Caminho de anexo inválido.');
  }
  // `validateStoragePath` lança erro simples (mensagem em português); aqui ele
  // vira erro com código, para o handler responder 400 e não 502. Um caminho
  // recusado é um pedido ruim, não uma falha de infraestrutura.
  try {
    return validateStoragePath(path, prefixo);
  } catch {
    throw falhar(ERRORS.INVALID_PATH, 'Caminho de anexo inválido.');
  }
}

const randomUuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const EXTENSAO_POR_MIME = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
});
/**
 * Monta o serviço. `client` é o `createR2Client(...)`; sem cliente o
 * serviço existe mas TODA operação falha com `STORAGE_NOT_CONFIGURED` —
 * o que deixa o frontend funcional (comprovantes legados continuam) em vez
 * de derrubar a tela.
 *
 * @param {object} o
 * @param {object|null} o.client
 * @param {boolean} [o.allowDelete=false] exclusão real desligada por padrão
 * @param {string} [o.r2Prefix]         padrão STORAGE_R2_PREFIX
 */
export function createStorageService({ client, allowDelete = false, r2Prefix = STORAGE_R2_PREFIX } = {}) {
  const exigido = () => {
    if (!client) throw falhar(ERRORS.NOT_CONFIGURED, 'Armazenamento R2 não configurado no backend.');
    return client;
  };

  /** Constrói o `storage_path` do MESMO formato usado pelo Supabase. */
  function buildPath(prefix, recordId, contentType) {
    if (!ATTACHMENT_PREFIXES.includes(prefix)) throw falhar(ERRORS.INVALID_PATH, 'Prefixo de anexo desconhecido.');
    if (typeof recordId !== 'string' || !recordId.trim() || /[\\/]/.test(recordId)) {
      throw falhar(ERRORS.INVALID_PATH, 'Registro sem ID definitivo para o anexo.');
    }
    const extensao = EXTENSAO_POR_MIME[contentType];
    if (!extensao) throw falhar(ERRORS.INVALID_FILE, 'Tipo de arquivo não permitido.');
    return `${prefix}/${recordId}/${randomUuid()}.${extensao}`;
  }

  return Object.freeze({
    get configured() { return Boolean(client); },
    get allowDelete() { return allowDelete === true; },
    provider: STORAGE_PROVIDER.R2,
    bucket: STORAGE_BUCKET_R2,

    /** Guarda o arquivo e devolve o que deve ser gravado no registro. */
    async upload({ prefix, recordId, body, contentType, fileName }) {
      exigido();
      if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
        throw falhar(ERRORS.INVALID_FILE, 'Arquivo ausente no upload.');
      }
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (!bytes.length) throw falhar(ERRORS.INVALID_FILE, 'O arquivo está vazio.');
      if (!ATTACHMENT_TYPES.includes(contentType)) throw falhar(ERRORS.INVALID_FILE, 'Tipo de arquivo não permitido.');
      if (bytes.length > ATTACHMENT_MAX_BYTES) throw falhar(ERRORS.INVALID_FILE, 'O arquivo excede o limite de 15 MB.');

      const path = buildPath(prefix, recordId, contentType);
      const key = r2ObjectKey(path, r2Prefix);
      await client.putObject(key, bytes, { contentType });
      // Confirma a gravação com HEAD (sem baixar o corpo): um PUT aceito sem
      // objeto legível produziria registro apontando para nada.
      const head = await client.headObject(key);
      if (!head.exists) throw falhar(ERRORS.NOT_FOUND, 'O objeto não foi confirmado no R2.');
      return attachmentReference({
        path,
        provider: STORAGE_PROVIDER.R2,
        fileName,
        mimeType: contentType,
        fileSize: bytes.length,
      });
    },

    /** Lê o arquivo inteiro (usado pelo proxy do backend). */
    async download({ path, prefix }) {
      exigido();
      const validado = caminhoDoServico(path, prefix);
      const object = await client.getObject(r2ObjectKey(validado, r2Prefix));
      return { path: validado, body: object.body, size: object.size, contentType: object.contentType };
    },

    /** URL temporária. É isto que o navegador usa; nada é persistido. */
    async getSignedUrl({ path, prefix, expiresIn = ATTACHMENT_SIGNED_TTL_SECONDS, responseContentDisposition }) {
      exigido();
      const validado = caminhoDoServico(path, prefix);
      const { url, expiresIn: ttl } = await client.createPresignedUrl(r2ObjectKey(validado, r2Prefix), {
        expiresIn, responseContentDisposition,
      });
      return { url, expiresIn: ttl, path: validado };
    },

    /** Existe sem baixar o arquivo. */
    async exists({ path, prefix }) {
      exigido();
      const validado = caminhoDoServico(path, prefix);
      return client.headObject(r2ObjectKey(validado, r2Prefix));
    },

    /**
     * Exclusão. RECUSA por padrão (`allowDelete` falso) e não é chamada por
     * nenhum fluxo do sistema: existe para uma limpeza futura, feita à mão e
     * auditada, depois que o vínculo do registro for verificado.
     */
    async delete({ path, prefix }) {
      if (allowDelete !== true) throw falhar(ERRORS.DELETE_DISABLED, 'Exclusão de anexo desabilitada.');
      exigido();
      const validado = caminhoDoServico(path, prefix);
      return client.deleteObject(r2ObjectKey(validado, r2Prefix));
    },
  });
}
