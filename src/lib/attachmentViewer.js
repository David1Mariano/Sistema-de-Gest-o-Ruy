// Núcleo do visualizador de anexos (comprovantes, documentos e notas fiscais).
//
// Toda a lógica "difícil" (zoom, ajuste, nome de download, impressão limpa e
// ciclo de vida da Object URL) mora aqui, sem React e sem DOM, para poder ser
// exercitada pelos testes de `scripts/`. O único consumidor é
// `src/components/rh/AttachmentPreview.jsx`, que é o visualizador usado por
// Gastos Diários, Contas a Pagar, Vales, Ficha do Colaborador e Pagamentos.
// É assim que continua existindo UM ÚNICO visualizador no sistema.
//
// Nada aqui grava ou altera armazenamento: o arquivo continua vindo por
// `loadPaymentProof` (Data URL legado ou storage_path assinado) exatamente
// como sempre veio.

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


