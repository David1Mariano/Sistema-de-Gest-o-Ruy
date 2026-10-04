// ===========================================================================
// CONTRATO ÚNICO DE REFERÊNCIA DE ARQUIVO.
//
// Este é o ÚNICO lugar do sistema que decide o formato de um caminho de
// anexo e de onde o arquivo vem. Backend (`server/storage/*`), frontend
// (`src/lib/paymentProof.js`) e testes importam ESTE arquivo — não existem
// cinco formatos de caminho convivendo (o problema real do Base44 era
// justamente isso: `proof_url`, `file_url`, `invoice_url` e `storage_path`
// eram quatro linguagens diferentes).
//
// Nada aqui grava, altera ou apaga: isto é só a descrição do contrato.
// PLACEHOLDER_CONTRATO

//
// ---------------------------------------------------------------------------
// O MODELO ATUAL (auditado, não inventado)
// ---------------------------------------------------------------------------
// O sistema grava anexos em UMA tabela genérica `records`, com o payload em
// `data` jsonb. Não existe coluna `storage_path`: `storage_path` é uma CHAVE
// dentro do jsonb, gravada pelo `uploadPaymentProof` junto de `file_name`,
// `mime_type` e `file_size`. O caminho real hoje é:
//
//     storage_path = EmployeePayment/<id-do-registro>/<uuid>.<ext>
//
// e o bucket Supabase é `anexos`, ou seja o objeto fica em
// `anexos/EmployeePayment/<id>/<uuid>.pdf`.
//
// A cópia para o R2 preservou exatamente esse caminho, sob o prefixo
// `anexos/`. A regra de tradução é uma linha, não uma tabela:
//
//     chave R2 = R2_PREFIX + storage_path      ("anexos/" + storage_path)
//
// ---------------------------------------------------------------------------
// POR QUE EXISTE UM `provider`, E POR QUE O PADRÃO NÃO É R2
// ---------------------------------------------------------------------------
// `storage_provider` NÃO existe hoje em nenhum registro. Adicioná-lo seria
// migration, e migration está fora desta etapa. Então a leitura infere:
//
//   storage_provider === 'r2'  -> R2
//   storage_path sem provider  -> Supabase (legado), como sempre
//   'data:...'                  -> base64 legado dentro do registro
//   'http(s)://...'             -> URL (legado do Base44 / Blob URL)
//
// Assim a transição é segura por padrão: quem não foi marcado continua
// indo ao Supabase, e o R2 só entra por marcação explícita.
// Bucket legado do Supabase Storage. Confirmado no código
// (`paymentProof.js`) e na documentação do projeto (`docs/`).
export const STORAGE_BUCKET_LEGACY = 'anexos';

// Bucket de destino no Cloudflare R2. Não é lido do ambiente: é parte do
// contrato de dados, igual ao bucket legado. O backend compara a sua
// configuração com esta constante e avisa quando elas divergem.
export const STORAGE_BUCKET_R2 = 'ruy-gestao-arquivos';

// Prefixo dentro do bucket R2 que espelha o bucket legado do Supabase.
// É o que faz a cópia já feita (prefixo preservado) continuar válida.
export const STORAGE_R2_PREFIX = 'anexos/';

// Provedores de armazenamento de anexo.
export const STORAGE_PROVIDER = Object.freeze({
  R2: 'r2',
  SUPABASE: 'supabase',
});

// De onde o conteúdo do anexo realmente vem, para quem abre o arquivo.
export const ATTACHMENT_ORIGIN = Object.freeze({
  R2: 'r2',
  SUPABASE: 'supabase',
  DATA_URL: 'data-url',
  HTTP_URL: 'http-url',
  BLOB_URL: 'blob-url',
  NONE: 'none',
});
// Prefixos de pasta já existentes no Supabase Storage. Cada prefixo é o
// NOME DA ENTIDADE, e o registro dono do arquivo mora no meio do caminho.
// Um prefixo desconhecido é RECUSADO: um `storage_path` apontando para
// qualquer outra pasta não deve ser assinado nem baixado.
export const ATTACHMENT_PREFIXES = Object.freeze([
  'EmployeePayment',
  'FinancialExpense',
  'AccountsPayable',
  'Vale',
  'Purchase',
  'EmployeeDocument',
]);

// Campos que guardam anexo no modelo atual. `storage_path` é o único
// caminho de bucket; os outros podem conter data URL (base64 legado),
// URL http(s) antiga ou Blob URL do navegador.
export const ATTACHMENT_FIELDS = Object.freeze([
  'storage_path',
  'proof_url',
  'document_url',
  'invoice_url',
  'photo_url',
  'file_url',
]);

const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
});

// Tipos aceitos em anexo — o mesmo conjunto do bucket legado.
export const ATTACHMENT_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
]);

// Limite do bucket legado (15.728.640 bytes), preservado no R2.
export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

// TTL curto da URL assinada. O arquivo é trazido como Blob e mostrado
// localmente; a URL nunca é gravada no registro.
export const ATTACHMENT_SIGNED_TTL_SECONDS = 300;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
/**
 * Valida um `storage_path` contra o contrato `Prefixo/{id}/{arquivo}`.
 * Não aceita barra invertida, `..`, `.`, segmento vazio nem extensão fora
 * da lista — é a mesma regra que já protegia o bucket privado e é o que
 * impede um caminho de virar travessia de diretório no R2.
 *
 * @returns {string} o caminho validado
 */
export function validateStoragePath(path, prefix) {
  const prefixo = prefix || ATTACHMENT_PREFIXES[0];
  if (!isNonEmptyString(path) || !path.startsWith(`${prefixo}/`)) {
    throw new Error(`Caminho de comprovante inválido. Use o prefixo ${prefixo}/{id}/{arquivo}.`);
  }
  if (path.includes('\\') || path.includes('\0')) {
    throw new Error('Caminho de comprovante inválido.');
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

/** O prefixo (nome da entidade) do caminho, ou '' quando não é caminho nosso. */
export function storagePathPrefix(path) {
  const match = /^([A-Za-z][\w-]*)\/[^/]+\/[^/]+$/.exec(String(path || ''));
  return match && ATTACHMENT_PREFIXES.includes(match[1]) ? match[1] : '';
}

/** Chave do objeto no R2. Regra única, sem exceção: prefixo + storage_path. */
export function r2ObjectKey(storagePath, r2Prefix = STORAGE_R2_PREFIX) {
  const base = String(r2Prefix || '');
  const path = String(storagePath || '');
  const prefixo = base.endsWith('/') ? base.slice(0, -1) : base;
  return prefixo ? `${prefixo}/${path}` : path;
}

/** Caminho no bucket legado do Supabase. É o próprio `storage_path`. */
export function supabaseObjectPath(storagePath) {
  return String(storagePath || '');
}
/**
 * Decide de onde um anexo vem. NUNCA lança e NUNCA lê o arquivo: só
 * classifica a referência que já está no registro.
 *
 * Regra de precedência (uma só, sem exceção):
 *   1. `storage_path` presente  -> caminho de bucket; provedor pelo
 *      `storage_provider` ('r2') ou Supabase (legado) quando ausente;
 *   2. campo legado pedido     -> data URL, Blob URL ou http(s).
 *
 * @param {object|string} record  registro, ou o próprio `storage_path`
 * @param {object} options        { field, prefix }
 * @returns {{origin, provider, path, field, prefix, hasReference}}
 */
export function resolveAttachmentSource(record = {}, options = {}) {
  const none = { origin: ATTACHMENT_ORIGIN.NONE, provider: null, path: '', field: '', prefix: '', hasReference: false };

  // Caminho solto, sem registro: só existe em dado gravado antes do R2,
  // então é Supabase por definição.
  if (typeof record === 'string') {
    const prefixo = storagePathPrefix(record);
    if (!prefixo) return none;
    return { ...none, origin: ATTACHMENT_ORIGIN.SUPABASE, provider: STORAGE_PROVIDER.SUPABASE, path: record, field: 'storage_path', prefix: prefixo, hasReference: true };
  }
  if (!record || typeof record !== 'object') return none;

  if (isNonEmptyString(record.storage_path)) {
    const r2 = record.storage_provider === STORAGE_PROVIDER.R2;
    return {
      ...none,
      origin: r2 ? ATTACHMENT_ORIGIN.R2 : ATTACHMENT_ORIGIN.SUPABASE,
      provider: r2 ? STORAGE_PROVIDER.R2 : STORAGE_PROVIDER.SUPABASE,
      path: record.storage_path,
      field: 'storage_path',
      prefix: storagePathPrefix(record.storage_path),
      hasReference: true,
    };
  }

  const field = options.field;
  const value = isNonEmptyString(field) && ATTACHMENT_FIELDS.includes(field) ? String(record[field] || '').trim() : '';
  if (!value) return none;

  if (/^data:/i.test(value)) return { ...none, origin: ATTACHMENT_ORIGIN.DATA_URL, field, hasReference: true };
  if (/^blob:/i.test(value)) return { ...none, origin: ATTACHMENT_ORIGIN.BLOB_URL, field, hasReference: true };
  if (/^https?:\/\//i.test(value)) return { ...none, origin: ATTACHMENT_ORIGIN.HTTP_URL, field, hasReference: true };

  const prefixo = storagePathPrefix(value);
  if (prefixo) return { ...none, origin: ATTACHMENT_ORIGIN.SUPABASE, provider: STORAGE_PROVIDER.SUPABASE, path: value, field: 'storage_path', prefix: prefixo, hasReference: true };
  return none;
}

/** MIME esperado a partir da extensão do caminho (metadado, nunca do conteúdo). */
export function mimeFromStoragePath(path) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(String(path || '').split(/[?#]/)[0]);
  return match ? (MIME_BY_EXTENSION[match[1].toLowerCase()] || '') : '';
}

/**
 * Objeto gravado no banco depois de um upload bem-sucedido.
 * É o MESMO formato para os dois provedores — muda só o `storage_provider`.
 */
export function attachmentReference({ path, provider, fileName, mimeType, fileSize }) {
  const isR2 = provider === STORAGE_PROVIDER.R2;
  return {
    storage_path: path,
    // Marcado explicitamente: sem este campo a leitura cairia no Supabase e
    // um arquivo novo no R2 seria procurado no lugar errado.
    storage_provider: isR2 ? STORAGE_PROVIDER.R2 : STORAGE_PROVIDER.SUPABASE,
    storage_bucket: isR2 ? STORAGE_BUCKET_R2 : STORAGE_BUCKET_LEGACY,
    file_name: fileName || '',
    mime_type: mimeType || mimeFromStoragePath(path),
    file_size: Number.isFinite(fileSize) ? fileSize : null,
  };
}
