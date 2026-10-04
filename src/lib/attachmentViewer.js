// Núcleo do visualizador de anexos (comprovantes, documentos e notas fiscais).
//
// Toda a lógica "difícil" (zoom, ajuste, nome de download, impressão limpa e
// ciclo de vida da Object URL) mora aqui, sem React e sem DOM, para poder ser
// exercitada pelos testes de `scripts/`. O único consumidor é
// `src/components/rh/AttachmentPreview.jsx`, que é o visualizador usado por
// Gastos Diários, Contas a Pagar, Vales, Ficha do Colaborador e Pagamentos.
// É assim que continua existindo UM ÚNICO visualizador no sistema.
//
// Nada aqui grava ou altera. O arquivo continua vindo por
// `loadPaymentProof` (base64 legado, caminho assinado do Supabase ou URL
// assinada do R2) exatamente como sempre veio.

export const ZOOM_MIN = 0.25; // 25%
export const ZOOM_MAX = 4; // 400%
export const ZOOM_STEP = 0.25; // passos dos botões +/-
export const ZOOM_WHEEL_FACTOR = 1.1; // Ctrl/Cmd + roda do mouse
export const TALL_IMAGE_RATIO = 2; // altura >= 2x a largura => bobina/vertical

// Modos de ajuste. `actual` é o tamanho real (100% = 1 px do arquivo por
// 1 px da tela); `width` preenche a largura disponível; `contain` cabe inteiro.
export const FIT = { WIDTH: 'width', CONTAIN: 'contain', ACTUAL: 'actual' };
export const FIT_LABELS = { [FIT.WIDTH]: 'Largura', [FIT.CONTAIN]: 'Tela', [FIT.ACTUAL]: '100%' };

// Página A4 retrato com margem de 10mm convertida em px CSS (96dpi):
// 190mm x 277mm -> 718px x 1047px. É a área útil usada ao fatiar a bobina.
export const PRINT_PAGE = { contentWidthPx: 718, contentHeightPx: 1047 };
export const MAX_PRINT_PAGES = 60;

const round3 = (value) => Math.round(value * 1000) / 1000;
const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function attachmentKind(mimeType) {
  const type = String(mimeType || '').toLowerCase().split(';')[0].trim();
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  return 'other';
}

// ===========================================================================
// NORMALIZADOR CENTRAL
// ===========================================================================
//
// Um único lugar decide o que é um anexo: de onde vem, que tipo tem e o que dá
// para fazer com ele. Antes desta função cada tela decidia MIME na mão, e
// alguns pontos nem tentavam (o `Compras` abria a nota fiscal com
// `<a href target="_blank">`, o que simplesmente não funciona com a data URL
// base64 gravada dentro do registro). Nenhuma tela interpreta anexo sozinha.
//
// Regra de ouro: o DECLARADO nunca vence o CONTEÚDO. Nota fiscal registrada
// como `image/jpeg` que na verdade é PDF é detectada pelos bytes, porque é
// assim que os arquivos antigos se comportam. O tipo declarado só vale quando
// os bytes não dizem nada.

export const ATTACHMENT_KIND = { IMAGE: 'image', PDF: 'pdf', UNSUPPORTED: 'unsupported' };
export const ATTACHMENT_SOURCE = { DATA_URL: 'data-url', HTTP_URL: 'http-url', BLOB_URL: 'blob-url', FILE: 'file', NONE: 'none' };

const DATA_URL_RE = /^data:([^;,]*)((?:;[^,]*)*),([\s\S]*)$/i;

// Assinaturas dos primeiros bytes: é o que separa JPEG de PNG de WEBP de PDF
// quando o registro mente (ou não traz MIME nenhum).
const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length >= 8 && b.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' },
  { mime: 'application/pdf', test: (b) => b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === '%PDF-' },
  { mime: 'image/webp', test: (b) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
  { mime: 'image/gif', test: (b) => b.length >= 6 && String.fromCharCode(...b.slice(0, 6)).startsWith('GIF8') },
];

const EXTENSION_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  pdf: 'application/pdf',
};

export function mimeFromName(name) {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || '').split(/[\\/]/).pop() || '');
  return match ? (EXTENSION_MIME[match[1].toLowerCase()] || '') : '';
}

// Query string e fragmento saem antes: a extensão é a última dica quando não há bytes.
const mimeFromPath = (path) => mimeFromName(String(path || '').split(/[?#]/)[0]);

// Assinatura em memória (Uint8Array/ArrayBuffer) sem virar string: o cabeçalho
// de um JPEG tem bytes que não são texto imprimível.
export function sniffMime(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length < 4) return '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes);
  for (const { mime, test } of SIGNATURES) {
    try { if (test(view)) return mime; } catch { /* assinatura incompatível: segue */ }
  }
  return '';
}

/**
 * Interpreta qualquer anexo do sistema e responde o que ele é e o que dá para
 * fazer com ele. Aceita data URL base64, URL http(s), Blob URL, storage_path,
 * Blob, File e o próprio registro ({ proof_url, storage_path, file_name,
 * mime_type }). NUNCA lança: quem chama decide a mensagem.
 *
 * @returns {{kind, mime, sourceType, url, filename, dataUrl, bytes,
 *            canPreview, canDownload, canPrint, canExportPdf, reason}}
 */
export function normalizeAttachment(input = {}, options = {}) {
  const declared = String(options.mime || '').toLowerCase().split(';')[0].trim();
  const out = {
    kind: ATTACHMENT_KIND.UNSUPPORTED, mime: '', sourceType: ATTACHMENT_SOURCE.NONE,
    url: '', filename: '', dataUrl: '', bytes: null,
    canPreview: false, canDownload: false, canPrint: false, canExportPdf: false, reason: '',
  };

  // 1. Desembrulha o registro: Storage tem prioridade (fonte assinada, dado
  //    novo); sem ele, o campo legado pedido explicitamente.
  let raw = input;
  if (input && typeof input === 'object' && !(typeof Blob !== 'undefined' && input instanceof Blob)) {
    const record = input;
    // `field` pode ser o PRÓPRIO `storage_path`: nesse caso o registro já é a
    // fonte (não há campo legado para ler) e basta o caminho do bucket.
    // Quando o campo pedido não existe no registro, caímos no `proof_url`:
    // é assim que `expenseAttachmentRecord`/`payableAttachmentRecord` entregam
    // o anexo (eles JÁ remapearam invoice_url/document_url para proof_url).
    // Sem esta queda, o botão do comprovante da nota fiscal não apareceria.
    const pedido = options.field && options.field !== 'storage_path' ? record[options.field] : undefined;
    const legacy = options.field === 'storage_path'
      ? undefined
      : (pedido || record.proof_url || record.document_url || record.invoice_url || record.photo_url || record.file_url);
    raw = record.storage_path ? { storagePath: record.storage_path, name: record.file_name } : legacy;
    out.filename = sanitizeFileName(record.file_name || '', declared || 'application/octet-stream');
  }

  if (raw === null || raw === undefined || raw === '' || (typeof raw === 'string' && !raw.trim())) {
    out.reason = 'empty';
    return out;
  }

  // 2. Blob/File: já é binário, o tipo vem do próprio objeto.
  if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    out.sourceType = (typeof File !== 'undefined' && raw instanceof File) ? ATTACHMENT_SOURCE.FILE : ATTACHMENT_SOURCE.BLOB_URL;
    out.bytes = raw.size;
    out.mime = raw.type || declared;
    out.filename = sanitizeFileName(raw.name || out.filename, out.mime);
    return finishAttachment(out, declared, out.mime);
  }

  // 3. storage_path do bucket privado: não é URL pública, o preview assina.
  if (typeof raw === 'object' && raw !== null) {
    out.sourceType = ATTACHMENT_SOURCE.FILE;
    out.url = raw.storagePath || options.storagePath || '';
    out.filename = sanitizeFileName(raw.name || out.filename, declared);
    out.mime = declared || mimeFromPath(out.url);
    return finishAttachment(out, declared, out.mime);
  }

  if (typeof raw !== 'string') { out.reason = 'unsupported-source'; return out; }
  const value = raw.trim();

  // 4. Data URL — o formato legado que mora DENTRO do registro.
  const match = DATA_URL_RE.exec(value);
  if (match) {
    const headerMime = (match[1] || '').toLowerCase().trim();
    const payload = match[3] || '';
    out.sourceType = ATTACHMENT_SOURCE.DATA_URL;
    out.dataUrl = value;
    out.url = value;
    if (!payload) { out.reason = 'empty-payload'; return out; }
    if (!/;base64/i.test(match[2] || '')) { out.reason = 'not-base64'; return out; }
    // Alfabeto base64 estrito ANTES de qualquer sniff: um payload com caractere
    // fora do alfabeto (@, ?, espaços que não são quebra de linha) é lixo de
    // registro, e `atob` o aceitaria parcialmente em vez de recusar.
    if (!/^[A-Za-z0-9+/\r\n\t ]+={0,2}$/.test(payload)) { out.reason = 'invalid-base64'; return out; }
    // Bytes reais do payload decidem o tipo quando o cabeçalho mente ou some.
    const sniffed = sniffBase64(payload);
    const headerKind = attachmentKind(headerMime);
    // Cabeçalho inútil (`application/octet-stream`, vazio, `text/plain`) cede pro sniff.
    const headerUseful = Boolean(headerMime) && headerKind !== 'other';
    out.mime = sniffed || (headerUseful ? headerMime : mimeFromName(out.filename) || headerMime);
    if (!out.mime || attachmentKind(out.mime) === 'other') { out.reason = 'unknown-type'; return out; }
    out.bytes = base64ByteLength(payload);
    const corrected = Boolean(sniffed) && headerUseful && headerKind !== attachmentKind(out.mime);
    return finishAttachment(out, out.mime, out.mime, corrected);
  }

  // 5. Blob URL: temporária por definição. Se já foi revogada, o fetch adiante
  //    falha com mensagem clara — nunca com tela branca.
  if (/^blob:/i.test(value)) {
    out.sourceType = ATTACHMENT_SOURCE.BLOB_URL;
    out.url = value;
    out.mime = declared || mimeFromName(out.filename);
    out.filename = sanitizeFileName(out.filename, out.mime);
    return finishAttachment(out, declared, out.mime);
  }

  // 6. storage_path solto (sem registro): prefixo/tipo/arquivo.
  if (/^[\w-]+\/.+\/[^/]+$/.test(value)) {
    out.sourceType = ATTACHMENT_SOURCE.FILE;
    out.url = value;
    out.mime = declared || mimeFromPath(value);
    out.filename = sanitizeFileName(out.filename || value.split('/').pop(), out.mime);
    return finishAttachment(out, declared, out.mime);
  }

  // 7. URL absoluta: última fonte, porque é a única que exige rede.
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) { out.reason = 'protocol-not-allowed'; return out; }
    out.sourceType = ATTACHMENT_SOURCE.HTTP_URL;
    out.url = parsed.href;
    out.mime = declared || mimeFromPath(value);
    // O nome do arquivo só é sanitizado depois do MIME: é dele que sai a
    // extensão, e sanitizar antes entregaria "comprovante" sem extensão.
    out.filename = sanitizeFileName(out.filename || parsed.pathname.split('/').pop(), out.mime);
    out.mime = out.mime || mimeFromName(out.filename);
    return finishAttachment(out, declared, out.mime);
  } catch {
    out.reason = 'invalid-url';
    return out;
  }
}

// Bytes do payload base64, tolerando a quebra de linha do histórico.
function sniffBase64(payload) {
  const clean = String(payload).replace(/\s/g, '');
  if (clean.length < 8) return '';
  try {
    const head = clean.slice(0, 16).replace(/=+$/, '');
    const padded = head.padEnd(Math.ceil(head.length / 4) * 4, '=');
    return sniffMime(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
  } catch {
    return '';
  }
}

const base64ByteLength = (payload) => Math.floor((String(payload).replace(/\s/g, '').replace(/=+$/, '').length * 3) / 4);

/** Mensagem amigável quando não dá para visualizar. Nunca deixa modal quebrado. */
export function attachmentErrorMessage(normalized) {
  const reasons = {
    empty: 'Não foi possível visualizar este anexo: o arquivo está vazio.',
    'empty-payload': 'Não foi possível visualizar este anexo: o conteúdo do arquivo veio incompleto.',
    'not-base64': 'Não foi possível visualizar este anexo: o formato do arquivo não é reconhecido.',
    'invalid-base64': 'Não foi possível visualizar este anexo: o conteúdo do arquivo está corrompido.',
    'unknown-type': 'Não foi possível visualizar este anexo: o tipo do arquivo não é reconhecido.',
    'invalid-url': 'Não foi possível visualizar este anexo: o endereço do arquivo é inválido.',
    'protocol-not-allowed': 'Não foi possível visualizar este anexo: este tipo de endereço não é permitido.',
    'unsupported-source': 'Não foi possível visualizar este anexo.',
  };
  return reasons[normalized?.reason] || 'Não foi possível visualizar este anexo.';
}

// --------------------------------------------------- imagem -> PDF (A4) -----
//
// A4 em mm (o jsPDF usa mm por padrão): 210x297, margem 10.
export const A4_MM = { width: 210, height: 297, margin: 10 };

/**
 * Plano de fatiagem da imagem em páginas A4. É a MESMA conta da impressão
 * (`printLayout`), em milímetros: a imagem nunca deforma, nunca é cortada e
 * uma bobina alta sai inteira em várias páginas, encolhendo na largura se
 * passar do limite.
 */
export function imageToPdfPlan({ width, height, page = A4_MM, maxPages = MAX_PRINT_PAGES } = {}) {
  const contentWidth = (page.width - page.margin * 2);
  const contentHeight = (page.height - page.margin * 2);
  const limit = Math.max(1, Number(maxPages) || MAX_PRINT_PAGES);
  const sourceWidth = positiveNumber(width);
  const sourceHeight = positiveNumber(height);
  if (!sourceWidth || !sourceHeight) {
    return { pages: 1, drawWidthMm: contentWidth, drawHeightMm: contentHeight, contentWidthMm: contentWidth, contentHeightMm: contentHeight, page };
  }
  // A largura disponível nunca é excedida; a escala vem da altura, então a
  // proporção do arquivo é preservada (contain, sem distorção).
  let drawWidthMm = contentWidth;
  const pagesFor = (w) => Math.ceil((((w * sourceHeight) / sourceWidth) / contentHeight) - 1e-9);
  let pages = Math.max(1, pagesFor(drawWidthMm));
  if (pages > limit) {
    drawWidthMm = Math.max(1, ((limit * contentHeight) * sourceWidth) / sourceHeight);
    pages = limit;
  }
  return {
    pages,
    drawWidthMm: round3(drawWidthMm),
    drawHeightMm: round3((drawWidthMm * sourceHeight) / sourceWidth),
    contentWidthMm: contentWidth,
    contentHeightMm: contentHeight,
    page,
  };
}

/**
 * Gera o PDF da imagem com jsPDF (já dependência do projeto), paginando em A4
 * sem deformar nem cortar. Recebe os BYTES da imagem, nunca a Object URL, para
 * não depender do DOM e poder ser testado. Devolve os bytes do PDF.
 */
export async function imageToPdfBytes(bytes, { mime, width, height, title = 'Anexo', page = A4_MM } = {}) {
  const { jsPDF } = await import('jspdf');
  const plan = imageToPdfPlan({ width, height, page });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const type = String(mime || 'image/jpeg').toLowerCase() === 'image/png' ? 'PNG' : 'JPEG';
  const data = typeof bytes === 'string' ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < plan.pages; index += 1) {
    if (index > 0) pdf.addPage('a4', 'portrait');
    // Cada página recebe a MESMA imagem deslocada para cima em múltiplos exatos
    // de `contentHeightMm`: é a mesma técnica da impressão limpa, e é o que faz
    // a bobina inteira sair sem deformar nem cortar conteúdo.
    const yMm = page.margin - (index * plan.contentHeightMm);
    pdf.addImage(data, type, page.margin, yMm, plan.drawWidthMm, plan.drawHeightMm, undefined, 'FAST');
  }
  pdf.setProperties({ title: String(title || 'Anexo').slice(0, 120) });
  return new Uint8Array(pdf.output('arraybuffer'));
}

/** Nome do PDF gerado a partir da imagem: mesma base, extensão trocada. */
export function exportPdfName(name) {
  const base = String(name || '').replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'anexo';
  return `${base}.pdf`;
}

function finishAttachment(out, declared, sniffed, corrected = false) {
  const mime = (sniffed || declared || '').toLowerCase();
  const kind = attachmentKind(mime);
  out.mime = mime;
  out.kind = kind === 'other' ? ATTACHMENT_KIND.UNSUPPORTED : kind;
  if (out.kind === ATTACHMENT_KIND.UNSUPPORTED) { out.reason = 'unsupported-type'; return out; }
  const hasContent = Boolean(out.url || out.dataUrl) || out.bytes > 0;
  out.canPreview = hasContent;
  out.canDownload = hasContent;
  out.canPrint = hasContent;
  // "Gerar PDF" só faz sentido a partir de imagem: um PDF já é PDF.
  out.canExportPdf = out.kind === ATTACHMENT_KIND.IMAGE && hasContent;
  out.reason = corrected ? 'mime-mismatch-corrected' : (hasContent ? '' : 'empty');
  return out;
}

// ------------------------------------------------------------------- zoom ---

export function clampZoom(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, round3(number)));
}

// Passo dos botões +/-: sempre cai num ponto da grade de 25%, mesmo depois de
// um zoom de roda/pinça que deixou o valor fora da grade (1.13 -> 1.25).
export function zoomStep(current, direction, step = ZOOM_STEP) {
  const base = clampZoom(current);
  const grid = Number(direction) < 0
    ? Math.ceil(base / step - 1e-6) * step - step
    : Math.floor(base / step + 1e-6) * step + step;
  return clampZoom(grid);
}

export function zoomFromWheel(deltaY, current) {
  const delta = Number(deltaY);
  if (!Number.isFinite(delta) || delta === 0) return clampZoom(current);
  const factor = delta < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
  return clampZoom(clampZoom(current) * factor);
}

export function zoomFromPinch(startDistance, currentDistance, startZoom) {
  const from = positiveNumber(startDistance);
  const to = positiveNumber(currentDistance);
  if (!from || !to) return clampZoom(startZoom);
  return clampZoom(clampZoom(startZoom) * (to / from));
}

export function zoomLabel(zoom) {
  return `${Math.round(clampZoom(zoom) * 100)}%`;
}

// -------------------------------------------------------- ajuste (fit) ----

// Comprovante de cartão é uma tira vertical: encaixar inteiro na tela deixa a
// fonte ilegível. Nesses casos o ajuste padrão é pela LARGURA, com rolagem.
export function autoFitMode(size) {
  const width = positiveNumber(size?.width);
  const height = positiveNumber(size?.height);
  if (!width || !height) return FIT.CONTAIN;
  return height / width >= TALL_IMAGE_RATIO ? FIT.WIDTH : FIT.CONTAIN;
}

export function isTallImage(size) {
  const width = positiveNumber(size?.width);
  const height = positiveNumber(size?.height);
  return Boolean(width && height && height / width >= TALL_IMAGE_RATIO);
}

// Escala base de cada modo de ajuste, em escala do arquivo (NÃO é clampada:
// um A4 escaneado a 300dpi precisa de 15% para caber na tela. O clamp de
// 25%-400% vale para o zoom que o usuário aplica EM CIMA do ajuste).
export function fitScale({ mode = FIT.CONTAIN, natural, viewport } = {}) {
  const width = positiveNumber(natural?.width);
  const height = positiveNumber(natural?.height);
  const viewWidth = positiveNumber(viewport?.width);
  const viewHeight = positiveNumber(viewport?.height);
  if (!width || !height || !viewWidth || !viewHeight) return 1;
  if (mode === FIT.ACTUAL) return 1;
  if (mode === FIT.WIDTH) return viewWidth / width;
  return Math.min(viewWidth / width, viewHeight / height);
}

// Estilo determinístico do <img>: px reais derivados só da escala base + zoom
// + tamanho natural. É o que garante que "Largura" continue Largura depois de
// aplicar zoom e que uma bobina nunca seja encolhida para caber inteira.
export function imageStyle({ mode = FIT.CONTAIN, zoom = 1, natural, viewport } = {}) {
  const width = positiveNumber(natural?.width);
  const height = positiveNumber(natural?.height);
  const scale = fitScale({ mode, natural, viewport }) * clampZoom(zoom);
  if (!width || !height) return { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' };
  return {
    width: `${Math.max(1, Math.round(width * scale))}px`,
    height: `${Math.max(1, Math.round(height * scale))}px`,
    maxWidth: 'none',
  };
}

export function formatPixels(size) {
  const width = positiveNumber(size?.width);
  const height = positiveNumber(size?.height);
  if (!width || !height) return '';
  return `${width.toLocaleString('pt-BR')} × ${height.toLocaleString('pt-BR')} px`;
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------- nome do download ---------

const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function extensionForType(mimeType) {
  const type = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return EXTENSION_BY_TYPE[type] || '';
}

// Nome de arquivo sempre inofensivo: Data URL nunca é nome, caminho é jogado
// fora (o nome jamais vira path traversal), caracteres inválidos de sistema
// operacional somem, e a extensão bate com o tipo real do conteúdo baixado.
export function sanitizeFileName(name, mimeType) {
  const raw = String(name ?? '').trim();
  const isDataUrl = /^data:/i.test(raw);
  const base = (isDataUrl ? '' : raw)
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  const withoutExtension = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const safeBase = (withoutExtension || 'comprovante').slice(0, 80);
  const extension = extensionForType(mimeType);
  return extension ? `${safeBase}.${extension}` : safeBase;
}

export function downloadName(record = {}, mimeType) {
  const type = mimeType || record?.mime_type || '';
  const original = record?.file_name || record?.name || '';
  const fallback = `comprovante${record?.id ? `-${record.id}` : ''}`;
  return sanitizeFileName(original || fallback, type);
}

// --------------------------------------------- impressão limpa (bobina) ----

// Um <img> muito alto não quebra de forma confiável entre páginas: alguns
// navegadores simplesmente cortam. A técnica é repetir a imagem em páginas de
// altura fixa (a área útil do A4) deslocando cada cópia — assim a bobina
// inteira sai, uma página embaixo da outra.
export function printLayout({ width, height, page = PRINT_PAGE, maxPages = MAX_PRINT_PAGES } = {}) {
  const contentWidthPx = positiveNumber(page.contentWidthPx) || PRINT_PAGE.contentWidthPx;
  const contentHeightPx = positiveNumber(page.contentHeightPx) || PRINT_PAGE.contentHeightPx;
  const limit = Math.max(1, Number(maxPages) || MAX_PRINT_PAGES);
  const sourceWidth = positiveNumber(width);
  const sourceHeight = positiveNumber(height);
  if (!sourceWidth || !sourceHeight) {
    return { pages: 1, displayWidthPx: contentWidthPx, displayHeightPx: 0, contentWidthPx, contentHeightPx };
  }
  let displayWidthPx = Math.min(contentWidthPx, sourceWidth);
  const pagesFor = (displayWidth) => Math.ceil(((displayWidth * sourceHeight) / sourceWidth) / contentHeightPx - 1e-9);
  let pages = Math.max(1, pagesFor(displayWidthPx));
  if (pages > limit) {
    displayWidthPx = Math.max(1, Math.floor(((limit * contentHeightPx) * sourceWidth) / sourceHeight));
    pages = limit;
  }
  return {
    pages,
    displayWidthPx: Math.max(1, Math.round(displayWidthPx)),
    displayHeightPx: Math.max(1, Math.round((displayWidthPx * sourceHeight) / sourceWidth)),
    contentWidthPx,
    contentHeightPx,
  };
}

export function printPageCount({ width, height, page = PRINT_PAGE, maxPages = MAX_PRINT_PAGES } = {}) {
  return printLayout({ width, height, page, maxPages }).pages;
}

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// HTML da impressão: SÓ o arquivo. Nenhum botão, nenhum menu, nenhum dado do
// sistema. Recebe a Object URL já criada pelo preview — nunca um Data URL.
export function buildImagePrintHtml({ url, title, width, height } = {}) {
  if (typeof url !== 'string' || !url) throw new Error('Sem arquivo para imprimir.');
  if (/^data:/i.test(url.trim())) {
    throw new Error('A impressão usa a URL temporária do arquivo, nunca o Data URL.');
  }
  const layout = printLayout({ width, height });
  const sheets = Array.from({ length: layout.pages }, (_, index) => (
    `  <div class="page"><img src="${escapeHtml(url)}" alt="" style="top:-${index * layout.contentHeightPx}px"></div>`
  )).join('\n');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title || 'Comprovante')}</title>
<style>
@page { size: A4 portrait; margin: 10mm; }
html, body { margin: 0; padding: 0; background: #fff; }
.page {
  width: ${layout.contentWidthPx}px;
  height: ${layout.contentHeightPx}px;
  overflow: hidden;
  position: relative;
  page-break-after: always;
  break-after: page;
}
.page:last-child { page-break-after: auto; break-after: auto; }
.page img { position: absolute; left: 0; width: ${layout.displayWidthPx}px; height: ${layout.displayHeightPx}px; }
</style>
</head>
<body>
${sheets}
</body>
</html>
`;
}

// --------------------------------------------- Object URL sem vazamento ----

function revokeQuietly(revoke, url) {
  try {
    revoke(url);
    return true;
  } catch {
    return false;
  }
}

// Uma sessão por modal aberto: é o único lugar do visualizador que cria Object
// URL. A URL é revogada ao fechar/desmontar, ao trocar de arquivo e também
// quando o download termina com o modal já fechado (nada fica pendurado).
export function createPreviewSession({ createObjectUrl, revokeObjectUrl } = {}) {
  const create = createObjectUrl || ((blob) => globalThis.URL.createObjectURL(blob));
  const revoke = revokeObjectUrl || ((url) => globalThis.URL.revokeObjectURL(url));
  let objectUrl = null;
  let closed = false;

  return {
    get objectUrl() { return objectUrl; },
    get closed() { return closed; },
    adopt(blob) {
      const url = create(blob);
      // O modal fechou enquanto o arquivo era baixado: devolve nulo e revoga.
      if (closed) {
        revokeQuietly(revoke, url);
        return null;
      }
      if (objectUrl) revokeQuietly(revoke, objectUrl);
      objectUrl = url;
      return { url, type: blob?.type || '' };
    },
    close() {
      closed = true;
      if (!objectUrl) return false;
      const revoked = revokeQuietly(revoke, objectUrl);
      objectUrl = null;
      return revoked;
    },
  };
}


