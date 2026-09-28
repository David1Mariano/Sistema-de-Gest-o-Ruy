import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadPaymentProof, PAYMENT_PROOF_SIGNED_TTL_SECONDS } from '../src/lib/paymentProof.js';
import { payableAttachmentRecord, validatePayableAttachmentFile, PAYABLE_ATTACHMENT_DIAG } from '../src/lib/payableAttachment.js';

// Reutiliza os arquivos sintéticos da suíte já existente (nenhum dado real).
const fixtures = await readFile(new URL('./test-payment-proof.mjs', import.meta.url), 'utf8');
const jpeg = Buffer.from(fixtures.match(/const jpeg = Buffer.from\('([^']+)'/)[1], 'base64');
const png = Buffer.from(fixtures.match(/const png = Buffer.from\(\s*'([^']+)'/)[1], 'base64');
const makePdf = new Function(`${fixtures.match(/function makePdf\(\) \{[\s\S]*?\n\}/)[0]}; return makePdf();`);
const pdf = makePdf();
const options = { prefix: 'AccountsPayable', diagLabel: PAYABLE_ATTACHMENT_DIAG };
const dataUrl = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;

for (const [format, type, bytes] of [['JPG', 'image/jpeg', jpeg], ['PNG', 'image/png', png], ['PDF', 'application/pdf', pdf]]) {
  test(`AccountsPayable ${format}: documento e comprovante persistidos -> Blob -> URL acessível e revogada`, async () => {
    for (const field of ['document_url', 'proof_url']) {
      // Simula serialização do registro e releitura após salvar/editar/recarregar.
      const saved = JSON.parse(JSON.stringify({ id: 'ap_1', [field]: dataUrl(type, bytes) }));
      const record = payableAttachmentRecord(saved, field);
      const blob = await loadPaymentProof(record, options);
      assert.equal(blob.type, type);
      const url = URL.createObjectURL(blob);
      try {
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      } finally { URL.revokeObjectURL(url); }
      await assert.rejects(fetch(url));
      assert.equal(saved[field], dataUrl(type, bytes));
    }
  });
}

test('AccountsPayable sem anexo não disponibiliza botão; campos não confirmados não são inferidos', () => {
  for (const field of ['document_url', 'proof_url', 'storage_path']) {
    assert.equal(payableAttachmentRecord({ id: 'empty' }, field), null);
    assert.equal(payableAttachmentRecord({ [field]: '' }, field), null);
  }
  assert.equal(payableAttachmentRecord({ invoice_url: 'unknown' }, 'invoice_url'), null);
});

test('AccountsPayable storage_path: assina caminho e baixa PDF; legacy + Storage permanecem acessíveis separadamente', async () => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/pdf'); res.end(pdf); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const legacy of [false, true]) {
      const source = Object.freeze({
        id: 'ap_1', storage_path: 'AccountsPayable/ap_1/receipt.pdf',
        ...(legacy ? { document_url: dataUrl('image/png', png), proof_url: dataUrl('image/jpeg', jpeg) } : {}),
      });
      let signed = 0;
      const blob = await loadPaymentProof(payableAttachmentRecord(source, 'storage_path'), {
        ...options,
        accessToken: async () => 'test-session',
        storageClient: { createSignedUrl: async (path, ttl) => {
          signed++;
          assert.equal(path, source.storage_path);
          assert.equal(ttl, PAYMENT_PROOF_SIGNED_TTL_SECONDS);
          return { data: { signedUrl: `http://127.0.0.1:${server.address().port}/signed` }, error: null };
        } },
      });
      assert.equal(signed, 1);
      assert.equal(blob.type, 'application/pdf');
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()), pdf);
      if (legacy) {
        assert.equal((await loadPaymentProof(payableAttachmentRecord(source, 'document_url'), options)).type, 'image/png');
        assert.equal((await loadPaymentProof(payableAttachmentRecord(source, 'proof_url'), options)).type, 'image/jpeg');
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('AccountsPayable rejeita executável, extensão disfarçada, MIME arbitrário e arquivo vazio', async () => {
  for (const file of [
    new File(['MZ'], 'bad.exe', { type: 'application/octet-stream' }),
    new File(['MZ'], 'bad.exe', { type: 'image/jpeg' }),
    new File(['MZ'], 'bad.jpg', { type: 'image/jpeg' }),
    new File(['html'], 'bad.jpg', { type: 'text/html' }),
    new File([], 'empty.pdf', { type: 'application/pdf' }),
  ]) await assert.rejects(validatePayableAttachmentFile(file));
  for (const [name, type, bytes] of [['a.JPG', 'image/jpeg', jpeg], ['a.jpeg', 'image/jpeg', jpeg], ['a.png', 'image/png', png], ['a.webp', 'image/webp', Buffer.from('RIFFxxxxWEBP')], ['a.pdf', 'application/pdf', pdf]]) {
    await assert.doesNotReject(validatePayableAttachmentFile(new File([bytes], name, { type })));
  }
});

test('AccountsPayable recusa Storage fora do prefixo e conteúdo corrompido', async () => {
  await assert.rejects(loadPaymentProof({ storage_path: 'Vale/other/a.pdf' }, options), /Caminho/);
  await assert.rejects(loadPaymentProof({ proof_url: dataUrl('application/pdf', Buffer.from('bad')) }, options), /corrompido/);
});

test('Botões reais do adaptador: documento, comprovante, Storage e ausência; input restrito', async () => {
  const { createServer: createViteServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { fileURLToPath } = await import('node:url');
  // Somente transformação SSR em memória: não abre porta nem reinicia o Vite 5173.
  const vite = await createViteServer({
    configFile: false, plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  });
  try {
    // utils.js calcula isIframe ao importar; o restante continua em ambiente SSR.
    const previousWindow = globalThis.window;
    try {
      globalThis.window = { self: null, top: null };
      await vite.ssrLoadModule('/src/lib/utils.js');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
    const { PayableAttachment, PayableAttachmentUpload } = await vite.ssrLoadModule('/src/components/financeiro/PayableAttachment.jsx');
    for (const field of ['document_url', 'proof_url', 'storage_path']) {
      const record = { id: 'ap_1', [field]: field === 'storage_path' ? 'AccountsPayable/ap_1/a.pdf' : dataUrl('application/pdf', pdf) };
      const html = renderToStaticMarkup(createElement(PayableAttachment, { record, field, label: field }));
      assert.match(html, /<button/);
      assert.ok(html.includes(field));
      assert.doesNotMatch(html, /href=|data:application/);
      assert.equal(renderToStaticMarkup(createElement(PayableAttachment, { record: {}, field })), '');
    }
    const html = renderToStaticMarkup(createElement(PayableAttachmentUpload, {
      label: 'Documento', record: {}, field: 'document_url', refEl: { current: null }, onFile: () => {},
    }));
    assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf,\.jpg,\.jpeg,\.png,\.webp,\.pdf"/);
  } finally { await vite.close(); }
});
