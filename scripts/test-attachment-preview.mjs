import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  FIT, FIT_LABELS, MAX_PRINT_PAGES, PRINT_PAGE, TALL_IMAGE_RATIO,
  attachmentKind, autoFitMode, buildImagePrintHtml, clampZoom, createPreviewSession,
  downloadName, exportPdfName, extensionForType, fitScale, formatBytes, formatPixels,
  imageStyle, isTallImage, printLayout, printPageCount, sanitizeFileName, zoomFromPinch,
  zoomFromWheel, zoomLabel, zoomStep,
} from '../src/lib/attachmentViewer.js';

// Lê um arquivo do projeto por caminho RELATIVO à raiz do repositório.
const read = (relative) => readFile(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

test('zoom é limitado a 25%-400% e sobrevive a valores inválidos', () => {
  assert.equal(clampZoom(0.1), 0.25);
  assert.equal(clampZoom(99), 4);
  assert.equal(clampZoom(1), 1);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(undefined), 1);
  assert.equal(clampZoom('2'), 2);
});

test('botões +/- andam em passos de 25% sem deriva de ponto flutuante', () => {
  assert.equal(zoomStep(1, 1), 1.25);
  assert.equal(zoomStep(1, -1), 0.75);
  assert.equal(zoomStep(4, 1), 4);
  assert.equal(zoomStep(4, -1), 3.75);
  assert.equal(zoomStep(0.25, -1), 0.25, 'no piso o - não sai do lugar');
  // Fora da grade (roda/pinça) o botão sobe para o próximo ponto da grade.
  assert.equal(zoomStep(0.1, 1), 0.5, '0.1 vira 0.25 (piso) e sobe um passo');
  assert.equal(zoomStep(0.35, 1), 0.5);
  assert.equal(zoomStep(0.35, -1), 0.25);
  assert.equal(zoomStep(1.13, 1), 1.25);
  assert.equal(zoomStep(1.13, -1), 1);
  let zoom = 0.25;
  for (let i = 0; i < 50; i += 1) zoom = zoomStep(zoom, 1);
  assert.equal(zoom, 4, 'subir 50 passos deve parar no teto');
  assert.deepEqual([zoomLabel(0.25), zoomLabel(1), zoomLabel(4)], ['25%', '100%', '400%']);
});

test('Ctrl+roda aumenta/diminue e para nos limites', () => {
  const maior = zoomFromWheel(-100, 1);
  const menor = zoomFromWheel(100, 1);
  assert.ok(maior > 1 && maior <= 4);
  assert.ok(menor < 1 && menor >= 0.25);
  assert.equal(zoomFromWheel(0, 1.5), 1.5, 'roda sem movimento não muda o zoom');
  assert.equal(zoomFromWheel(-100, 4), 4, 'já no teto permanece no teto');
  assert.equal(zoomFromWheel(1e9, 0.25), 0.25, 'já no piso permanece no piso');
});

test('pinça escala pelo quanto os dedos se afastaram', () => {
  assert.equal(zoomFromPinch(100, 200, 1), 2);
  assert.equal(zoomFromPinch(200, 100, 2), 1);
  assert.equal(zoomFromPinch(0, 100, 1.5), 1.5, 'distância zero é descartada');
  assert.equal(zoomFromPinch(100, 100000, 1), 4, 'pinça gigante para no teto');
});

// -------------------------------------------------------------- tipo/ajuste ---

test('detecta o tipo do arquivo a partir do mime (inclusive com charset)', () => {
  assert.equal(attachmentKind('application/pdf'), 'pdf');
  assert.equal(attachmentKind('image/png'), 'image');
  assert.equal(attachmentKind('IMAGE/WEBP'), 'image');
  assert.equal(attachmentKind('text/plain; charset=utf-8'), 'other');
  assert.equal(attachmentKind(undefined), 'other');
});

test('bobina abre ajustada pela largura, imagem comum pela tela', () => {
  assert.equal(autoFitMode({ width: 800, height: 800 * TALL_IMAGE_RATIO }), FIT.WIDTH);
  assert.equal(autoFitMode({ width: 800, height: 10000 }), FIT.WIDTH);
  assert.equal(autoFitMode({ width: 800, height: 600 }), FIT.CONTAIN);
  assert.equal(autoFitMode({ width: 800, height: 0 }), FIT.CONTAIN);
  assert.equal(autoFitMode(undefined), FIT.CONTAIN);
  assert.equal(isTallImage({ width: 300, height: 4000 }), true);
  assert.equal(isTallImage({ width: 300, height: 400 }), false);
  assert.ok(FIT_LABELS[FIT.WIDTH] && FIT_LABELS[FIT.CONTAIN] && FIT_LABELS[FIT.ACTUAL]);
});

test('escala base de cada ajuste usa a área visível medida', () => {
  const natural = { width: 800, height: 10000 };
  const viewport = { width: 900, height: 700 };
  assert.equal(fitScale({ mode: FIT.ACTUAL, natural, viewport }), 1);
  assert.equal(fitScale({ mode: FIT.WIDTH, natural, viewport }), 900 / 800);
  assert.equal(fitScale({ mode: FIT.CONTAIN, natural, viewport }), 700 / 10000);
  // "Tela" de um A4 escaneado precisa de menos de 25%: aqui não é clampado,
  // o clamp de 25%-400% é do zoom que o usuário aplica em cima do ajuste.
  assert.ok(fitScale({ mode: FIT.CONTAIN, natural, viewport }) < 0.25);
  assert.equal(fitScale({ mode: FIT.WIDTH, natural, viewport: { width: 0, height: 0 } }), 1);
});

test('estilo da imagem é em px reais e obedece ajuste + zoom', () => {
  const natural = { width: 800, height: 10000 };
  const viewport = { width: 900, height: 700 };
  const largura = imageStyle({ mode: FIT.WIDTH, zoom: 1, natural, viewport });
  assert.equal(largura.width, '900px', 'ajuste Largura preenche a área visível');
  assert.equal(largura.maxWidth, 'none', 'nunca é encolhido para caber inteiro');
  assert.equal(imageStyle({ mode: FIT.WIDTH, zoom: 2, natural, viewport }).width, '1800px');
  assert.equal(imageStyle({ mode: FIT.ACTUAL, zoom: 1, natural, viewport }).width, '800px');
  assert.equal(imageStyle({ mode: FIT.ACTUAL, zoom: 4, natural, viewport }).height, '40000px');
  assert.equal(imageStyle({ mode: FIT.WIDTH, zoom: 1, natural, viewport }).height, '11250px');
  assert.equal(imageStyle({ zoom: 1 }).objectFit, 'contain', 'antes de medir, comportamento neutro');
});

test('formata dimensões e tamanho para a barra do visualizador', () => {
  assert.equal(formatPixels({ width: 1080, height: 10000 }), '1.080 × 10.000 px');
  assert.equal(formatPixels({ width: 0, height: 10 }), '');
  assert.deepEqual(
    [formatBytes(0), formatBytes(900), formatBytes(2048), formatBytes(3 * 1024 * 1024)],
    ['', '900 B', '2 KB', '3.0 MB'],
  );
});

// ------------------------------------------------------- nome do download -----

test('nome de download nunca vira caminho nem carrega Data URL', () => {
  assert.equal(sanitizeFileName('../../etc/passwd', 'image/png'), 'passwd.png');
  assert.equal(sanitizeFileName('C:\\Users\\a\\comprovante.jpg', 'image/jpeg'), 'comprovante.jpg');
  assert.equal(sanitizeFileName('data:image/png;base64,iVBORw0KGgo=', 'image/png'), 'comprovante.png');
  assert.equal(sanitizeFileName('   ', 'application/pdf'), 'comprovante.pdf');
  assert.equal(sanitizeFileName('comprovante\u0000 final.png', 'image/png'), 'comprovante final.png');
  assert.equal(sanitizeFileName('ok.txt', 'image/png'), 'ok.png', 'extensão segue o tipo real');
  assert.equal(sanitizeFileName('ok', 'application/octet-stream'), 'ok');
  assert.equal(sanitizeFileName('x'.repeat(200), 'image/png').length, 84);
  assert.equal(extensionForType('IMAGE/JPEG; charset=x'), 'jpg');
});

test('nome do download vem do registro, com a extensão do tipo carregado', () => {
  assert.equal(downloadName({ id: 'a1', file_name: 'Comprovante Pix.PDF' }, 'application/pdf'), 'Comprovante Pix.pdf');
  assert.equal(downloadName({ id: 'a1' }, 'image/webp'), 'comprovante-a1.webp');
  assert.equal(downloadName({}, ''), 'comprovante');
});

// ------------------------------------------------------------- impressão ------

test('bobina é fatiada em páginas A4 em vez de ser cortada', () => {
  const layout = printLayout({ width: 800, height: 10000 });
  assert.equal(layout.contentWidthPx, PRINT_PAGE.contentWidthPx);
  assert.equal(layout.displayWidthPx, 718, 'usa a largura útil da página');
  assert.equal(layout.displayHeightPx, 8975);
  assert.equal(layout.pages, 9, '8975px / 1047px = 9 páginas');
  assert.equal(printPageCount({ width: 800, height: 10000 }), 9);
});

test('imagem pequena sai em uma página sem ser ampliada', () => {
  const layout = printLayout({ width: 500, height: 400 });
  assert.equal(layout.pages, 1);
  assert.equal(layout.displayWidthPx, 500, 'não estica além do tamanho do arquivo');
  assert.equal(layout.displayHeightPx, 400);
  assert.equal(printLayout({}).pages, 1, 'sem dimensões ainda assim imprime algo');
});

test('bobina absurda é limitada a 60 páginas encolhendo a largura', () => {
  const layout = printLayout({ width: 1000, height: 1_000_000 });
  assert.equal(layout.pages, MAX_PRINT_PAGES);
  assert.ok(layout.displayWidthPx < 718, 'encolhe para caber no limite');
  assert.ok(Math.ceil(layout.displayHeightPx / PRINT_PAGE.contentHeightPx) <= MAX_PRINT_PAGES);
});

test('HTML de impressão só contém o arquivo, uma página por fatia', () => {
  const html = buildImagePrintHtml({
    url: 'blob:https://app.exemplo/1f0e',
    title: 'Comprovante <script>alert(1)</script>',
    width: 800,
    height: 10000,
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /@page \{ size: A4 portrait; margin: 10mm; \}/);
  assert.equal((html.match(/class="page"/g) || []).length, 9);
  assert.match(html, /top:-1047px/, 'segunda página desloca uma área útil');
  assert.match(html, /top:-8376px/, 'última página desloca 8x a área útil');
  assert.ok(!html.includes('<script>'), 'título é escapado, não injetado');
  assert.match(html, /Comprovante &lt;script&gt;/);
  assert.doesNotMatch(html, /button/i, 'sem botões ou menus na impressão');
});

test('impressão se recusa a usar Data URL', () => {
  assert.throws(() => buildImagePrintHtml({ url: 'data:image/png;base64,iVBOR', width: 10, height: 20 }), /Data URL/);
  assert.throws(() => buildImagePrintHtml({ url: '', width: 10, height: 20 }), /Sem arquivo/);
});
// --------------------------------_________________ Object URL sem vazamento ---

function fakeUrls() {
  const created = [];
  const revoked = [];
  let seq = 0;
  return {
    created,
    revoked,
    create: (blob) => {
      seq += 1;
      const url = `blob:fake/${seq}:${blob?.type || ''}`;
      created.push(url);
      return url;
    },
    revoke: (url) => { revoked.push(url); },
  };
}

test('sessão revoga a URL anterior ao trocar de arquivo', () => {
  const urls = fakeUrls();
  const session = createPreviewSession({ createObjectUrl: urls.create, revokeObjectUrl: urls.revoke });
  assert.deepEqual([session.objectUrl, session.closed], [null, false]);
  const primeiro = session.adopt({ type: 'image/png' });
  assert.equal(primeiro.url, 'blob:fake/1:image/png');
  assert.equal(primeiro.type, 'image/png');
  const segundo = session.adopt({ type: 'application/pdf' });
  assert.deepEqual(urls.revoked, ['blob:fake/1:image/png'], 'a URL velha morre na troca');
  assert.equal(session.objectUrl, segundo.url);
  assert.equal(session.close(), true);
  assert.deepEqual(urls.revoked, ['blob:fake/1:image/png', 'blob:fake/2:application/pdf']);
  assert.equal(session.objectUrl, null);
  assert.equal(session.close(), false, 'fechar de novo não revoga nada');
  assert.equal(urls.created.length, 2, 'nenhuma URL criada a mais');
});

test('download que termina depois de fechar o modal revoga na hora', () => {
  const urls = fakeUrls();
  const session = createPreviewSession({ createObjectUrl: urls.create, revokeObjectUrl: urls.revoke });
  assert.equal(session.close(), false);
  assert.equal(session.closed, true);
  assert.equal(session.adopt({ type: 'image/jpeg' }), null, 'não entrega URL para modal fechado');
  assert.deepEqual(urls.revoked, ['blob:fake/1:image/jpeg'], 'a URL recém-criada não fica pendurada');
  assert.equal(session.objectUrl, null);
});

test('falha ao revogar não quebra o visualizador', () => {
  const session = createPreviewSession({
    createObjectUrl: () => 'blob:explode',
    revokeObjectUrl: () => { throw new Error('revoke falhou'); },
  });
  assert.equal(session.adopt({ type: 'image/png' }).url, 'blob:explode');
  assert.equal(session.close(), false, 'exceção do navegador é engolida');
  assert.equal(session.objectUrl, null);
  assert.equal(session.closed, true);
});



// ===========================================================================
// UNIFICAÇÃO DOS ANEXOS: download, "baixar como PDF", nomes e superfícies
// ===========================================================================

test('imagem -> PDF real: bytes válidos, uma página para foto e várias para bobina', async () => {
  const { imageToPdfBytes, imageToPdfPlan } = await import('../src/lib/attachmentViewer.js');
  // JPEG 1x1 mínimo, gerado aqui para não depender de arquivo do disco.
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzND/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==', 'base64');
  const uma = await imageToPdfBytes(new Uint8Array(jpeg), { mime: 'image/jpeg', width: 600, height: 400, title: 'comprovante' });
  assert.ok(uma.length > 400, 'PDF gerado tem conteúdo');
  assert.equal(Buffer.from(uma.slice(0, 5)).toString('latin1'), '%PDF-', 'assinatura de PDF válida');
  assert.equal(imageToPdfPlan({ width: 600, height: 400 }).pages, 1, 'foto deitada cabe em uma página');
  assert.ok(imageToPdfPlan({ width: 600, height: 9000 }).pages > 1, 'bobina vira várias páginas');
});

test('o nome do PDF gerado nunca carrega o base64 nem some com a extensão útil', () => {
  assert.equal(exportPdfName('comprovante-gasto-123.jpg'), 'comprovante-gasto-123.pdf');
  assert.equal(exportPdfName('documento-colaborador.png'), 'documento-colaborador.pdf');
  assert.equal(exportPdfName(''), 'anexo.pdf');
  // O sanitizador continua derrubando o caminho: o nome do PDF sai da base já
  // sanitizada pelo viewer, nunca do nome cru do banco.
  assert.equal(sanitizeFileName('C:\\Users\\joao\\recibo.jpg', 'image/jpeg'), 'recibo.jpg');
  // E um nome de PDF que ainda tivesse extensão é normalizado uma vez só.
  assert.equal(exportPdfName(exportPdfName('comprovante.jpg')), 'comprovante.pdf');
});

test('o viewer renderiza os botões de download e "baixar como PDF" só onde faz sentido', async () => {
  const { createServer: createViteServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { fileURLToPath } = await import('node:url');
  const abs = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
  const vite = await createViteServer({
    configFile: false, plugins: [react()],
    resolve: { alias: { '@': abs('src') } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  });
  try {
    const previousWindow = globalThis.window;
    try { globalThis.window = { self: null, top: null }; await vite.ssrLoadModule(abs('src/lib/utils.js')); }
    finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
    const { default: AttachmentPreview } = await vite.ssrLoadModule(abs('src/components/rh/AttachmentPreview.jsx'));
    const fonte = await read('src/components/rh/AttachmentPreview.jsx');

    // A nota fiscal da compra é o caso que não abria: vivia em `invoice_url` e
    // era aberta com <a target="_blank">, que não funciona com data URL base64.
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const markup = renderToStaticMarkup(createElement(AttachmentPreview, {
      record: { id: 'c1', invoice_url: jpeg }, field: 'invoice_url', label: 'Ver NF',
    }));
    assert.match(markup, /Ver NF/, 'o botão aparece para invoice_url (antes sumia)');
    assert.match(fonte, /Baixar como PDF/, 'existe a ação de exportar imagem para PDF');
    assert.match(fonte, /Baixar original/, 'o download do original é nomeado');
    assert.match(fonte, /theme-static-light-surface/, 'contrato de tema preservado');
    // O botão de exportar PDF fica condicionado à imagem: PDF não gera PDF.
    assert.match(fonte, /isImage \? \(/, 'exportar PDF é exclusivo de imagem');
  } finally {
    await vite.close();
  }
});

