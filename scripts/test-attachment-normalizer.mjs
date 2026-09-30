// ===========================================================================
// NORMALIZADOR CENTRAL
// ===========================================================================
//
// São os casos que FAZIAM ANEXO NÃO ABRIR antes: campo não lido pelo viewer,
// MIME ausente, MIME mentiroso, base64 quebrado, URL inválida. Cada teste é um
// sintoma real, não um caso inventado.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENT_KIND, ATTACHMENT_SOURCE, attachmentErrorMessage, attachmentKind,
  exportPdfName, imageToPdfPlan, mimeFromName, normalizeAttachment, sanitizeFileName, sniffMime,
} from '../src/lib/attachmentViewer.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x20, 0x74];
const dataUrl = (mime, bytes) => `data:${mime};base64,${b64(bytes)}`;

test('1. JPEG base64 é imagem, com nome e permissões', () => {
  const a = normalizeAttachment(dataUrl('image/jpeg', JPEG));
  assert.equal(a.kind, ATTACHMENT_KIND.IMAGE);
  assert.equal(a.mime, 'image/jpeg');
  assert.equal(a.sourceType, ATTACHMENT_SOURCE.DATA_URL);
  assert.equal(a.canPreview, true);
  assert.equal(a.canDownload, true);
  assert.equal(a.canPrint, true);
  assert.equal(a.canExportPdf, true, 'imagem pode virar PDF');
});

test('2. PNG base64 é imagem', () => {
  const a = normalizeAttachment(dataUrl('image/png', PNG));
  assert.equal(a.kind, ATTACHMENT_KIND.IMAGE);
  assert.equal(a.mime, 'image/png');
  assert.equal(a.canExportPdf, true);
});

test('3. PDF base64 é PDF e NÃO oferece exportar PDF (já é PDF)', () => {
  const a = normalizeAttachment(dataUrl('application/pdf', PDF));
  assert.equal(a.kind, ATTACHMENT_KIND.PDF);
  assert.equal(a.mime, 'application/pdf');
  assert.equal(a.canPreview, true);
  assert.equal(a.canPrint, true);
  assert.equal(a.canExportPdf, false, 'converter PDF em PDF não faz sentido');
});

test('4. HTTP JPEG por extensão é imagem', () => {
  const a = normalizeAttachment('https://exemplo.com/anexos/comprovante.jpg');
  assert.equal(a.kind, ATTACHMENT_KIND.IMAGE);
  assert.equal(a.sourceType, ATTACHMENT_SOURCE.HTTP_URL);
  assert.equal(a.filename, 'comprovante.jpg');
});

test('5. HTTP PNG por extensão é imagem', () => {
  assert.equal(normalizeAttachment('https://exemplo.com/foto.png').kind, ATTACHMENT_KIND.IMAGE);
});

test('6. HTTP PDF por extensão é PDF', () => {
  const a = normalizeAttachment('https://exemplo.com/nota.pdf?v=2#pagina=3');
  assert.equal(a.kind, ATTACHMENT_KIND.PDF);
  assert.equal(a.mime, 'application/pdf', 'query e fragmento não atrapalham');
});

test('7. MIME ausente mas bytes dizem: PNG e PDF são reconhecidos', () => {
  assert.equal(normalizeAttachment(`data:;base64,${b64(PNG)}`).mime, 'image/png');
  assert.equal(normalizeAttachment(`data:application/octet-stream;base64,${b64(PDF)}`).mime, 'application/pdf');
  assert.equal(normalizeAttachment(`data:;base64,${b64(JPEG)}`).kind, ATTACHMENT_KIND.IMAGE);
});

test('8. MIME inconsistente: os BYTES vencem o cabeçalho', () => {
  // Nota fiscal registrada como JPEG que é, na verdade, um PDF.
  const pdf = normalizeAttachment(`data:image/jpeg;base64,${b64(PDF)}`);
  assert.equal(pdf.kind, ATTACHMENT_KIND.PDF, 'vira PDF, não imagem');
  assert.equal(pdf.mime, 'application/pdf');
  assert.equal(pdf.canExportPdf, false);
  // E o inverso: PDF registrado que é JPEG.
  const img = normalizeAttachment(`data:application/pdf;base64,${b64(JPEG)}`);
  assert.equal(img.kind, ATTACHMENT_KIND.IMAGE);
  assert.equal(img.canExportPdf, true);
});

test('9. string vazia, null e undefined não são anexo', () => {
  for (const value of ['', '   ', null, undefined]) {
    const a = normalizeAttachment(value);
    assert.equal(a.kind, ATTACHMENT_KIND.UNSUPPORTED);
    assert.equal(a.canPreview, false);
    assert.equal(a.reason, 'empty');
  }
});

test('10. URL inválida e protocolo não permitido são recusados', () => {
  assert.equal(normalizeAttachment('nao-e-uma-url').reason, 'invalid-url');
  assert.equal(normalizeAttachment('ftp://exemplo.com/a.pdf').reason, 'protocol-not-allowed');

test('o registro é lido por QUALQUER campo de anexo do sistema', () => {
  // Este era o bug real: a nota fiscal da compra vive em invoice_url, o
  // documento da conta a pagar em document_url e a foto em photo_url — campos
  // que o viewer antigo ignorava e por isso o botão nem aparecia.
  const doc = dataUrl('application/pdf', PDF);
  assert.equal(normalizeAttachment({ id: 'c1', invoice_url: doc }).kind, ATTACHMENT_KIND.PDF);
  assert.equal(normalizeAttachment({ id: 'p1', document_url: doc }).kind, ATTACHMENT_KIND.PDF);
  assert.equal(normalizeAttachment({ id: 'e1', photo_url: dataUrl('image/jpeg', JPEG) }).kind, ATTACHMENT_KIND.IMAGE);
  assert.equal(normalizeAttachment({ id: 'g1', proof_url: doc }).kind, ATTACHMENT_KIND.PDF);
  // Storage tem prioridade: não é URL pública, é caminho do bucket.
  assert.equal(normalizeAttachment({ id: 'x', storage_path: 'Purchase/c1/abc.pdf', file_name: 'nf.pdf' }).sourceType, ATTACHMENT_SOURCE.FILE);
  // Campo pedido explicitamente ganha do campo legado.
  assert.equal(normalizeAttachment({ id: 'g2', proof_url: '', invoice_url: doc }, { field: 'invoice_url' }).kind, ATTACHMENT_KIND.PDF);
});

test('assinatura por bytes: PNG, JPEG, PDF, WEBP e lixo', () => {
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(JPEG), 'image/jpeg');
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp');
  assert.equal(sniffMime([1, 2, 3, 4, 5, 6, 7, 8]), '');
});

test('nome de arquivo útil, sem vazar dado sensível nem caminho', () => {
  assert.equal(sanitizeFileName('comprovante-gasto-123.jpg', 'image/jpeg'), 'comprovante-gasto-123.jpg');
  assert.equal(sanitizeFileName('C:\\Users\\joao\\minha foto.png', 'image/png'), 'minha foto.png');
  // Data URL NUNCA vira nome (o base64 inteiro não pode virar arquivo).
  assert.ok(!sanitizeFileName(dataUrl('image/jpeg', JPEG), 'image/jpeg').includes('base64'));
  // O PDF gerado a partir da imagem troca só a extensão.
  assert.equal(exportPdfName('comprovante-gasto-123.jpg'), 'comprovante-gasto-123.pdf');
  assert.equal(exportPdfName(''), 'anexo.pdf');
  assert.equal(mimeFromName('foto.JPEG'), 'image/jpeg');
});

test('imagem -> PDF: A4, sem deformar, e bobina vira várias páginas', () => {
  const curta = imageToPdfPlan({ width: 800, height: 600 });
  assert.equal(curta.pages, 1);
  assert.equal(curta.page.width, 210, 'A4 retrato');
  assert.equal(curta.page.height, 297);
  // Proporção preservada: 800x600 é 4:3, então a altura é 3/4 da largura.
  assert.ok(Math.abs(curta.drawHeightMm / curta.drawWidthMm - 600 / 800) < 0.001, 'não deforma');
  const bobina = imageToPdfPlan({ width: 800, height: 4000 });
  assert.ok(bobina.pages > 1, 'bobina alta precisa de várias páginas');
  assert.ok(bobina.drawWidthMm <= bobina.contentWidthMm, 'nunca estoura a largura útil');
  // Limite de páginas protege de bobina absurda encolhendo a largura.
  const absurda = imageToPdfPlan({ width: 800, height: 4000000 });
  assert.ok(absurda.pages <= 60);
  assert.ok(absurda.drawWidthMm < bobina.drawWidthMm, 'encolhe para caber no limite');
});

test('o erro é sempre amigável, nunca tela branca', () => {
  for (const reason of ['empty', 'empty-payload', 'not-base64', 'unknown-type', 'invalid-url', 'protocol-not-allowed', 'unsupported-type', 'inexistente']) {
    assert.match(attachmentErrorMessage({ reason }), /Não foi possível visualizar este anexo/);
  }
  assert.equal(attachmentKind('application/pdf'), 'pdf');
  assert.equal(attachmentKind('image/webp'), 'image');
  assert.equal(attachmentKind('application/zip'), 'other');
});

  assert.equal(normalizeAttachment('javascript:alert(1)').reason, 'protocol-not-allowed');
});

test('11. base64 inválido ou incompleto é recusado com motivo', () => {
  assert.equal(normalizeAttachment('data:image/jpeg;base64,').reason, 'empty-payload');
  assert.equal(normalizeAttachment('data:image/jpeg,nao-base64').reason, 'not-base64');
  const quebrado = normalizeAttachment('data:image/jpeg;base64,@@@@nao-e-base64@@@@');
  assert.notEqual(quebrado.canPreview, true, 'base64 inválido não vira preview');
});

test('12. formato não suportado é recusado sem quebrar', () => {
  const a = normalizeAttachment('https://exemplo.com/planilha.xlsx');
  assert.equal(a.kind, ATTACHMENT_KIND.UNSUPPORTED);
  assert.equal(a.canPreview, false);
  assert.equal(a.reason, 'unsupported-type');
  assert.match(attachmentErrorMessage(a), /Não foi possível visualizar este anexo/);
});
