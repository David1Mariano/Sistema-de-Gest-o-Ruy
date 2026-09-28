import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import {
  buildPaymentProofPath,
  loadPaymentProof,
  uploadPaymentProof,
  validatePaymentProofFile,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_SIGNED_TTL_SECONDS,
} from '../src/lib/paymentProof.js';

// Imagem JPEG branca de 1 pixel, gerada para teste; nenhum dado de usuário.
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==', 'base64');

function makePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\nendstream',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += 'xref\n0 5\n0000000000 65535 f \n';
  text += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
const pdf = makePdf();
const dataUrl = (mime, data) => `data:${mime};base64,${data.toString('base64')}`;

for (const [mime, bytes] of [['image/jpeg', jpeg], ['application/pdf', pdf]]) {
  test(`${mime}: base64 -> Blob -> URL acessível; mesmos bytes e MIME`, async () => {
    const payment = JSON.parse(JSON.stringify({ proof_url: dataUrl(mime, bytes) }));
    const blob = await loadPaymentProof(payment);
    assert.equal(blob.type, mime);
    const url = URL.createObjectURL(blob);
    try {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), mime);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    } finally { URL.revokeObjectURL(url); }
    await assert.rejects(fetch(url));
    // Reconstrução a partir do registro, nunca persistir uma Blob URL.
    assert.deepEqual(Buffer.from(await (await loadPaymentProof(payment)).arrayBuffer()), bytes);
  });
}

test('base64 inválido, MIME proibido e conteúdo falso geram erros', async () => {
  await assert.rejects(loadPaymentProof({ proof_url: 'data:image/jpeg;base64,!!!!' }), /base64/);
  await assert.rejects(loadPaymentProof({ proof_url: dataUrl('text/html', Buffer.from('<html>')) }), /não permitido/);
  await assert.rejects(loadPaymentProof({ proof_url: dataUrl('application/pdf', Buffer.from('not a PDF')) }), /não corresponde/);
  await assert.rejects(loadPaymentProof({ proof_url: 'javascript:alert(1)' }), /Protocolo/);
});

test('arquivo vazio ou formato não permitido não é aceito', () => {
  assert.throws(() => validatePaymentProofFile(new Blob([], { type: 'image/jpeg' })), /vazio/);
  assert.throws(() => validatePaymentProofFile(new Blob(['x'], { type: 'text/html' })), /JPG/);
});

test('novos uploads: limite de 15 MB, extensões e nomes com acentos', () => {
  assert.throws(() => validatePaymentProofFile(new File(['MZ'], 'programa.exe', { type: 'application/octet-stream' })), /JPG/);
  assert.throws(() => validatePaymentProofFile(new File([jpeg], 'programa.exe', { type: 'image/jpeg' })), /extensão/);
  assert.throws(() => validatePaymentProofFile(new File([new Uint8Array(PAYMENT_PROOF_MAX_BYTES + 1)], 'grande.pdf', { type: 'application/pdf' })), /15 MB/);
  assert.doesNotThrow(() => validatePaymentProofFile(new File([new Uint8Array(PAYMENT_PROOF_MAX_BYTES)], 'limite.pdf', { type: 'application/pdf' })));
  for (const [type, extension] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['application/pdf', 'pdf']]) {
    assert.doesNotThrow(() => validatePaymentProofFile(new File(['fixture'], `Comprovante João (teste).${extension}`, { type })));
  }
});

test('Storage sem autenticação e Blob URL revogada mostram erro', async () => {
  await assert.rejects(loadPaymentProof({ storage_path: 'EmployeePayment/teste/teste.pdf', proof_url: dataUrl('application/pdf', pdf) }), /Supabase Auth/);
  const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
  URL.revokeObjectURL(url);
  await assert.rejects(loadPaymentProof({ proof_url: url }), /não está mais disponível/);
});

test('upload privado usa ID definitivo, JWT e não sobrescreve', async () => {
  const file = new File([jpeg], 'Comprovante João.jpg', { type: 'image/jpeg' });
  const path = buildPaymentProofPath('pay_123', file);
  assert.match(path, /^EmployeePayment\/pay_123\/[0-9a-f-]{36}\.jpg$/);
  let uploadCall;
  const result = await uploadPaymentProof({
    recordId: 'pay_123',
    file,
    accessToken: async () => 'real-jwt',
    storageClient: {
      list: async (folder) => ({ data: [{ name: 'pay_123' }], error: null, folder }),
      upload: async (uploadPath, body, options) => {
        uploadCall = { uploadPath, body, options };
        return { data: { path: uploadPath }, error: null };
      },
    },
  });
  assert.match(result.storage_path, /^EmployeePayment\/pay_123\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(result.file_name, file.name);
  assert.equal(result.mime_type, file.type);
  assert.equal(result.file_size, file.size);
  assert.equal(uploadCall.options.upsert, false);
  assert.equal(uploadCall.options.contentType, file.type);
});

test('HTTP real: PDF, JPEG, 403, 404 e resposta HTML', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/pdf') { res.setHeader('Content-Type', 'application/pdf'); res.end(pdf); }
    else if (req.url === '/jpg') { res.setHeader('Content-Type', 'image/jpeg'); res.end(jpeg); }
    else if (req.url === '/html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>login</html>'); }
    else { res.statusCode = req.url === '/forbidden' ? 403 : 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await loadPaymentProof({ proof_url: `${base}/pdf` })).type, 'application/pdf');
    assert.equal((await loadPaymentProof({ proof_url: `${base}/jpg` })).type, 'image/jpeg');
    await assert.rejects(loadPaymentProof({ proof_url: `${base}/missing` }), /HTTP 404/);
    await assert.rejects(loadPaymentProof({ proof_url: `${base}/forbidden` }), /HTTP 403/);
    await assert.rejects(loadPaymentProof({ proof_url: `${base}/html` }), /JPG/);
  } finally { await new Promise((resolve) => server.close(resolve)); }

// ---------------------------------------------------------------------------
// Vale (fluxo Colaboradores > Ficha > Vales > Ver comprovante)
// ---------------------------------------------------------------------------
const VALE_DIAG = '[vale-comprovante]';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('Vale: JPG, PNG e PDF em base64 viram Blob via LEGACY_BLOB', async () => {
  for (const [mime, bytes] of [['image/jpeg', jpeg], ['image/png', png], ['application/pdf', pdf]]) {
    const blob = await loadPaymentProof(
      { id: 'vale_legacy', proof_url: dataUrl(mime, bytes) },
      { prefix: 'Vale', diagLabel: VALE_DIAG }
    );
    assert.equal(blob.type, mime);
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  }
});

test('Vale sem comprovante falha com mensagem clara', async () => {
  await assert.rejects(loadPaymentProof({ id: 'vale_vazio' }, { prefix: 'Vale' }), /sem comprovante/i);
  await assert.rejects(loadPaymentProof({ id: 'vale_branco', proof_url: '' }, { prefix: 'Vale' }), /sem comprovante/i);
  await assert.rejects(loadPaymentProof({ id: 'vale_nulo', proof_url: null }, { prefix: 'Vale' }), /sem comprovante/i);
});

test('Vale com storage_path gera signed URL e retorna o arquivo', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.end(pdf);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let seen = null;
    const blob = await loadPaymentProof(
      { id: 'vale_stor', storage_path: 'Vale/vale_stor/uuid.pdf', mime_type: 'application/pdf' },
      {
        prefix: 'Vale',
        diagLabel: VALE_DIAG,
        accessToken: async () => 'jwt',
        storageClient: {
          createSignedUrl: async (p, ttl) => { seen = { p, ttl }; return { data: { signedUrl: `${base}/signed` }, error: null }; },
        },
      }
    );
    assert.equal(seen.p, 'Vale/vale_stor/uuid.pdf');
    assert.equal(seen.ttl, PAYMENT_PROOF_SIGNED_TTL_SECONDS);
    assert.equal(blob.type, 'application/pdf');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), pdf);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Vale: storage_path de outro prefixo é rejeitado; sem sessão dá erro de auth', async () => {
  await assert.rejects(
    loadPaymentProof({ id: 'vale_bad', storage_path: 'EmployeePayment/x/y.pdf' }, { prefix: 'Vale', accessToken: async () => 'jwt' }),
    /Caminho de comprovante inválido/
  );
  await assert.rejects(
    loadPaymentProof({ id: 'vale_noauth', storage_path: 'Vale/vale_noauth/y.pdf' }, { prefix: 'Vale' }),
    /Supabase Auth/
  );
});

test('Vale: storage_path tem precedência sobre proof_url legado', async () => {
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'image/jpeg'); res.end(jpeg); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const blob = await loadPaymentProof(
      {
        id: 'vale_ambos',
        storage_path: 'Vale/vale_ambos/uuid.jpg',
        proof_url: dataUrl('application/pdf', pdf),
        mime_type: 'image/jpeg',
      },
      {
        prefix: 'Vale',
        diagLabel: VALE_DIAG,
        accessToken: async () => 'jwt',
        storageClient: { createSignedUrl: async () => ({ data: { signedUrl: `${base}/signed` }, error: null }) },
      }
    );
    // Veio do Storage (JPEG), não do base64 legado (PDF).
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), jpeg);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

});
