// ===========================================================================
// SUÍTE DO ARMAZENAMENTO DE ARQUIVOS (R2 + legado).
//
// Rede bloqueada globalmente: qualquer `fetch` real aqui é FALHA por
// construção, não ruído. O cliente R2 recebe `request` injetável e o
// cliente do frontend recebe `fetchImpl` injetável.
//
// Nenhum teste escreve em banco, em bucket ou em arquivo real: tudo roda
// em memória, com bytes sintéticos gerados aqui.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  ATTACHMENT_ORIGIN,
  ATTACHMENT_PREFIXES,
  STORAGE_BUCKET_R2,
  STORAGE_BUCKET_LEGACY,
  STORAGE_PROVIDER,
  STORAGE_R2_PREFIX,
  attachmentReference,
  r2ObjectKey,
  resolveAttachmentSource,
  storagePathPrefix,
  validateStoragePath,
} from '../src/lib/storage/attachmentPath.js';
import { createR2Client } from '../server/storage/r2Client.mjs';
import { createStorageService } from '../server/storage/storageService.mjs';
import { createStorageHandler } from '../server/storage/storageHandler.mjs';
import { storageAPIConfigFromEnvironment, missingStorageConfig } from '../server/storage/storageApi.mjs';
import { createAttachmentStorageClient } from '../src/lib/storage/attachmentClient.js';
import {
  buildPaymentProofPath,
  loadPaymentProof,
  uploadPaymentProof,
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_PREFIX,
  PAYMENT_PROOF_SIGNED_TTL_SECONDS,
} from '../src/lib/paymentProof.js';

// Rede real bloqueada: qualquer `fetch` não previsto por um teste é FALHA por
// construção, não ruído.
const fetchReal = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls += 1; throw new Error('NETWORK_DISABLED_IN_STORAGE_TESTS'); };
test.after(() => assert.equal(networkCalls, 0, 'nenhuma chamada de rede real durante os testes'));

// O carregador de comprovante registra diagnóstico em `console` (é assim
// que o operador investiga anexo que não abre). Nos testes isso só suja a
// saída: o log é silenciado e restaurado no fim.
const consoleReal = { info: console.info, error: console.error, warn: console.warn };
console.info = () => {};
console.error = () => {};
console.warn = () => {};
test.after(() => Object.assign(console, consoleReal));

/**
 * `fetch` de mentira que devolve bytes sintéticos para uma URL e bloqueia
 * qualquer outra. Sem servidor local: nada de socket, nada de keep-alive,
 * nada de teste que dependa da rede do sistema — o arquivo chega ao
 * visualizador exatamente como chegaria em produção.
 */
function fetchServindo(url, mime, bytes, registro = []) {
  const anterior = globalThis.fetch;
  globalThis.fetch = async (alvo, init) => {
    registro.push({ url: String(alvo), init });
    if (!String(alvo).startsWith(url)) throw new Error('rede bloqueada no teste');
    return new Response(bytes, { status: 200, headers: { 'content-type': mime } });
  };
  return () => { globalThis.fetch = anterior; };
}

const abs = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = (rel) => readFile(abs(rel), 'utf8');

// Arquivos SINTÉTICOS (mesmos fixtures das suítes já existentes do projeto).
const fixtures = await read('scripts/test-payment-proof.mjs');
const jpeg = Buffer.from(fixtures.match(/const jpeg = Buffer\.from\('([^']+)'/)[1], 'base64');
const makePdf = new Function(`${fixtures.match(/function makePdf\(\) \{[\s\S]*?\n\}/)[0]}; return makePdf();`);
const pdf = makePdf();
const dataUrl = (mime, bytes) => `data:${mime};base64,${bytes.toString('base64')}`;
const arquivo = (type, bytes, name) => new File([bytes], name, { type });

const R2_ENV = {
  endpoint: 'https://conta-de-teste.r2.cloudflarestorage.com',
  accessKeyId: 'AKIAEXEMPLO',
  secretAccessKey: 'segredo-de-teste',
  bucket: STORAGE_BUCKET_R2,
};

/** Cliente R2 com `request` falso: registra chamadas, devolve o que foi pedido. */
function r2DeTeste({ responde } = {}) {
  const chamadas = [];
  const request = async (url, init = {}) => {
    chamadas.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (responde) return responde(url, init, chamadas.length);
    if ((init.method || 'GET') === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': '10' } });
    if ((init.method || 'GET') === 'GET') return new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response(null, { status: 200 });
  };
  return { chamadas, client: createR2Client({ ...R2_ENV, request, now: () => new Date('2026-10-04T12:00:00Z') }) };
}
// ===========================================================================
// 1. O CONTRATO DE REFERÊNCIA — um formato só, para os dois provedores
// ===========================================================================

test('1. o caminho é o mesmo nos dois provedores e mapeia 1:1 no R2', () => {
  // Caminho real gravado hoje pelo sistema (bucket `anexos`).
  const path = 'EmployeePayment/pay_123/2f1a9d0c-6f1e-4a2b-9c3d-8e7f6a5b4c3d.jpg';
  assert.equal(validateStoragePath(path, PAYMENT_PROOF_PREFIX), path);
  assert.equal(storagePathPrefix(path), 'EmployeePayment');
  // A chave do objeto no R2 é o MESMO caminho com o prefixo do bucket.
  assert.equal(r2ObjectKey(path), `${STORAGE_R2_PREFIX}${path}`);
  assert.equal(r2ObjectKey(path), `anexos/${path}`);
  // O bucket legado não ganha prefixo: o bucket JÁ era o prefixo.
  assert.equal(PAYMENT_PROOF_BUCKET, 'anexos');
  assert.equal(STORAGE_BUCKET_LEGACY, 'anexos');
});

test('2. todo prefixo do sistema é aceito; caminho fora do contrato é recusado', () => {
  for (const prefixo of ATTACHMENT_PREFIXES) {
    const path = `${prefixo}/id-1/arquivo.pdf`;
    assert.equal(validateStoragePath(path, prefixo), path);
    assert.equal(storagePathPrefix(path), prefixo);
  }
  const invalidos = [
    'EmployeePayment/so-um-nivel.pdf',            // falta o id
    'EmployeePayment/a/b/c.pdf',                  // nível a mais
    'EmployeePayment/../outro/a.pdf',             // travessia
    'EmployeePayment/id/a.exe',                   // extensão proibida
    'Vale/id/a.pdf',                              // prefixo de outra entidade
    'PastaSecreta/id/a.pdf',                      // prefixo desconhecido
    '', null, undefined, 42,
  ];
  for (const ruim of invalidos) assert.throws(() => validateStoragePath(ruim, 'EmployeePayment'), /inválido/i, `deveria recusar ${JSON.stringify(ruim)}`);
  assert.equal(storagePathPrefix('PastaSecreta/id/a.pdf'), '', 'prefixo desconhecido não vira provedor');
});

test('3. upload novo gera exatamente o mesmo formato de caminho legado', () => {
  const path = buildPaymentProofPath('pay_123', arquivo('image/jpeg', jpeg, 'comprovante.jpg'));
  assert.match(path, /^EmployeePayment\/pay_123\/[0-9a-f-]{36}\.jpg$/);
  // E o caminho no R2 fica onde a cópia dos 33 arquivos já deixou.
  assert.match(r2ObjectKey(path), /^anexos\/EmployeePayment\/pay_123\/[0-9a-f-]{36}\.jpg$/);
  assert.throws(() => buildPaymentProofPath('pay/123', arquivo('image/jpeg', jpeg, 'a.jpg')), /ID definitivo/);
  // O mesmo contrato vale para as outras entidades: muda o prefixo, nunca a forma.
  assert.match(buildPaymentProofPath('vale_9', arquivo('application/pdf', pdf, 'a.pdf'), 'Vale'), /^Vale\/vale_9\/[0-9a-f-]{36}\.pdf$/);
});
// ===========================================================================
// 2. RESOLUÇÃO DA LEITURA — R2, legado Supabase e base64 convivem
// ===========================================================================

test('4. resolve arquivo R2, legado Supabase e base64 legado', () => {
  // A) arquivo novo no R2
  const r2 = resolveAttachmentSource({ id: 'p1', storage_path: 'EmployeePayment/p1/a.pdf', storage_provider: 'r2' });
  assert.equal(r2.origin, ATTACHMENT_ORIGIN.R2);
  assert.equal(r2.provider, STORAGE_PROVIDER.R2);
  assert.equal(r2.path, 'EmployeePayment/p1/a.pdf');

  // B) arquivo legado no Supabase: SEM `storage_provider` (é o caso real
  //    dos 33 arquivos) => Supabase, nunca R2.
  const legado = resolveAttachmentSource({ id: 'p2', storage_path: 'EmployeePayment/p2/b.pdf' });
  assert.equal(legado.origin, ATTACHMENT_ORIGIN.SUPABASE);
  assert.equal(legado.provider, STORAGE_PROVIDER.SUPABASE);

  // C) base64 legado dentro do registro
  const b64 = resolveAttachmentSource({ id: 'g1', proof_url: dataUrl('application/pdf', pdf) }, { field: 'proof_url' });
  assert.equal(b64.origin, ATTACHMENT_ORIGIN.DATA_URL);
  // Também nos campos que o visualizador legado ignorava.
  assert.equal(resolveAttachmentSource({ id: 'c1', invoice_url: dataUrl('image/jpeg', jpeg) }, { field: 'invoice_url' }).origin, ATTACHMENT_ORIGIN.DATA_URL);
  assert.equal(resolveAttachmentSource({ id: 'e1', photo_url: dataUrl('image/jpeg', jpeg) }, { field: 'photo_url' }).origin, ATTACHMENT_ORIGIN.DATA_URL);
  assert.equal(resolveAttachmentSource({ id: 'v1', document_url: dataUrl('application/pdf', pdf) }, { field: 'document_url' }).origin, ATTACHMENT_ORIGIN.DATA_URL);

  // Nada de referência: `none`, sem exceção e sem provider inventado.
  const vazio = resolveAttachmentSource({ id: 'x' }, { field: 'proof_url' });
  assert.equal(vazio.origin, ATTACHMENT_ORIGIN.NONE);
  assert.equal(vazio.provider, null);
});

test('5. storage_path tem precedência sobre o base64 legado, em qualquer provedor', () => {
  const base64Legado = dataUrl('application/pdf', pdf);
  assert.equal(resolveAttachmentSource({ storage_path: 'Vale/v1/a.jpg', storage_provider: 'r2', proof_url: base64Legado }).origin, ATTACHMENT_ORIGIN.R2);
  assert.equal(resolveAttachmentSource({ storage_path: 'Vale/v1/a.jpg', proof_url: base64Legado }).origin, ATTACHMENT_ORIGIN.SUPABASE);
});

test('6. resolve arquivo R2: signed URL do backend -> bytes -> Blob válido', async () => {
  const registradas = [];
  const restaurar = fetchServindo('https://r2.exemplo/assinada', 'application/pdf', pdf, registradas);
  try {
    const pedido = [];
    const blob = await loadPaymentProof(
      { id: 'r2_1', storage_path: 'EmployeePayment/r2_1/uuid.pdf', storage_provider: 'r2', mime_type: 'application/pdf' },
      { storageApiClient: { signedUrl: async (path, opts) => { pedido.push({ path, opts }); return 'https://r2.exemplo/assinada'; } } },
    );
    assert.equal(pedido[0].path, 'EmployeePayment/r2_1/uuid.pdf');
    assert.equal(blob.type, 'application/pdf');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), pdf, 'os mesmos bytes chegam ao visualizador');
    // A URL assinada é buscada SEM cookies e SEM cache: comprovante é
    // documento pessoal e a URL morre em minutos.
    assert.equal(registradas[0].url, 'https://r2.exemplo/assinada');
    assert.equal(registradas[0].init.credentials, 'omit');
    assert.equal(registradas[0].init.cache, 'no-store');
  } finally { restaurar(); }
});
// ===========================================================================
// 3. COMPATIBILIDADE — o que NÃO pode quebrar
// ===========================================================================

test('7. resolve legado Supabase: continua indo ao bucket `anexos`, sem tocar no R2', async () => {
  const restaurar = fetchServindo('https://supabase.exemplo/assinada', 'image/jpeg', jpeg);
  try {
    let assinado = null;
    const blob = await loadPaymentProof(
      { id: 'legado', storage_path: 'EmployeePayment/legado/uuid.jpg', mime_type: 'image/jpeg' },
      {
        accessToken: async () => 'jwt-de-teste',
        storageClient: { createSignedUrl: async (path, ttl) => { assinado = { path, ttl }; return { data: { signedUrl: 'https://supabase.exemplo/assinada' }, error: null }; } },
      },
    );
    assert.equal(assinado.path, 'EmployeePayment/legado/uuid.jpg');
    assert.equal(assinado.ttl, PAYMENT_PROOF_SIGNED_TTL_SECONDS);
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), jpeg);
  } finally { restaurar(); }
});

test('8. resolve base64: PDF e imagem legados viram Blob sem rede e sem R2', async () => {
  for (const [mime, bytes] of [['application/pdf', pdf], ['image/jpeg', jpeg]]) {
    const blob = await loadPaymentProof({ id: 'b64', proof_url: dataUrl(mime, bytes) });
    assert.equal(blob.type, mime);
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  }
  // base64 corrompido continua sendo recusado com a mensagem de sempre.
  await assert.rejects(loadPaymentProof({ proof_url: 'data:application/pdf;base64,!!!!' }), /base64/);
  await assert.rejects(loadPaymentProof({ proof_url: dataUrl('application/pdf', Buffer.from('nao e pdf')) }), /não corresponde/);
});

test('9. sem provedor marcado, storage_path NUNCA é procurado no R2', async () => {
  // A prova é explícita: o Supabase é chamado e o cliente de R2 não.
  const restaurar = fetchServindo('https://supabase.exemplo/assinada', 'application/pdf', pdf);
  let r2Chamadas = 0;
  try {
    const blob = await loadPaymentProof(
      { id: 'so_supabase', storage_path: 'EmployeePayment/so_supabase/a.pdf' },
      {
        accessToken: async () => 'jwt-de-teste',
        storageClient: { createSignedUrl: async () => ({ data: { signedUrl: 'https://supabase.exemplo/assinada' }, error: null }) },
        storageApiClient: { signedUrl: async () => { r2Chamadas += 1; throw new Error('o R2 não pode ser chamado aqui'); } },
      },
    );
    assert.equal(r2Chamadas, 0, 'o R2 não pode ser tocado sem marcação explícita');
    assert.equal(blob.type, 'application/pdf');
  } finally { restaurar(); }
});
// ===========================================================================
// 4. ASSINATURA E ERRO — o que a tela vê quando o R2 falha
// ===========================================================================

test('10. signed URL: TTL curto, assinatura determinística e sem segredo na URL', async () => {
  const { client, chamadas } = r2DeTeste();
  const { url, expiresIn } = await client.createPresignedUrl('anexos/EmployeePayment/p1/a.pdf', { expiresIn: 300 });
  assert.equal(expiresIn, 300);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://conta-de-teste.r2.cloudflarestorage.com');
  assert.equal(parsed.pathname, `/${STORAGE_BUCKET_R2}/anexos/EmployeePayment/p1/a.pdf`);
  assert.equal(parsed.searchParams.get('X-Amz-Expires'), '300');
  assert.match(parsed.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.equal(parsed.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(chamadas.length, 0, 'assinar URL não é chamada de rede');

  // Mesma entrada => mesma assinatura (a data é injetada, não o relógio).
  const outra = await client.createPresignedUrl('anexos/EmployeePayment/p1/a.pdf', { expiresIn: 300 });
  assert.equal(outra.url, url);
  // Caminho diferente => assinatura diferente (o caminho está assinado).
  const diferente = await client.createPresignedUrl('anexos/EmployeePayment/p2/a.pdf', { expiresIn: 300 });
  assert.notEqual(diferente.url, url);
  // A access key pode aparecer (é pública por definição); o segredo NÃO.
  assert.ok(!url.includes('segredo-de-teste'), 'a chave secreta nunca aparece na URL');
});

test('11. erro do R2 não quebra a UI: vira mensagem, não crash', async () => {
  for (const [code, esperado] of [['not_configured', /configurado/i], ['unauthorized', /sessão/i], ['forbidden', /sessão/i], ['unavailable', /URL temporária/i]]) {
    await assert.rejects(
      loadPaymentProof(
        { id: 'r2_e', storage_path: 'EmployeePayment/r2_e/a.pdf', storage_provider: 'r2' },
        { storageApiClient: { signedUrl: async () => { const e = new Error('x'); e.code = code; throw e; } } },
      ),
      esperado,
      `código ${code} deve virar mensagem de tela`,
    );
  }
  // Cliente sem endpoint (estado real hoje): falha fechado e nomeado.
  const semEndpoint = createAttachmentStorageClient({ endpoint: '' });
  assert.equal(semEndpoint.configured, false);
  await assert.rejects(semEndpoint.signedUrl('EmployeePayment/p/a.pdf'), (error) => error.code === 'not_configured');
  assert.deepEqual(await semEndpoint.health(), { provider: 'r2', configured: false, ready: false, code: 'not_configured' });
});

test('12. MIME do PDF e da imagem; filename preservado', async () => {
  const { client } = r2DeTeste({
    responde: (url, init) => (init.method === 'PUT'
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 200, headers: { 'content-type': (url.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'), 'content-length': '2' } })),
  });
  const service = createStorageService({ client });

  const pdfRef = await service.upload({ prefix: 'EmployeePayment', recordId: 'p1', body: pdf, contentType: 'application/pdf', fileName: 'Comprovante de pagamento.pdf' });
  assert.equal(pdfRef.storage_path.endsWith('.pdf'), true);
  assert.equal(pdfRef.mime_type, 'application/pdf');
  assert.equal(pdfRef.file_size, pdf.length);
  assert.equal(pdfRef.storage_provider, 'r2');
  assert.equal(pdfRef.storage_bucket, STORAGE_BUCKET_R2);
  // Nome acentuado vai para o registro intacto; o caminho é sempre uuid.
  assert.equal(pdfRef.file_name, 'Comprovante de pagamento.pdf');

  const jpgRef = await service.upload({ prefix: 'Vale', recordId: 'v1', body: jpeg, contentType: 'image/jpeg', fileName: 'comprovante-acentuado.jpg' });
  assert.equal(jpgRef.mime_type, 'image/jpeg');
  assert.equal(jpgRef.storage_path.endsWith('.jpg'), true);
  assert.equal(jpgRef.file_name, 'comprovante-acentuado.jpg');
});

test('13. attachmentReference: mesmo formato de registro nos dois provedores', () => {
  const supabase = attachmentReference({ path: 'EmployeePayment/p/a.pdf', provider: 'supabase', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 });
  const r2 = attachmentReference({ path: 'EmployeePayment/p/a.pdf', provider: 'r2', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 });
  assert.deepEqual(Object.keys(supabase).sort(), Object.keys(r2).sort(), 'mesmos campos, sem formato paralelo');
  assert.equal(supabase.storage_bucket, STORAGE_BUCKET_LEGACY);
  assert.equal(r2.storage_bucket, STORAGE_BUCKET_R2);
  assert.equal(supabase.storage_path, r2.storage_path, 'o caminho é o mesmo; muda quem serve');
});
// ===========================================================================
// 5. BACKEND — handler, autorização e exclusão desligada
// ===========================================================================

const identidadeOk = async () => ({ id: 'user_1', active: true });
const handlerDe = (service, verifyIdentity = identidadeOk) => createStorageHandler({ service, verifyIdentity });

const pedir = (handler, path, init = {}) => handler(new Request(`http://host${path}`, init));

test('14. handler exige identidade: sem token, R2 e Supabase respondem igual', async () => {
  const service = createStorageService({ client: r2DeTeste().client });
  const handler = handlerDe(service, async () => null);
  for (const rota of ['/storage/health', '/storage/signed-url?path=EmployeePayment/p/a.pdf', '/storage/object?path=EmployeePayment/p/a.pdf']) {
    const response = await pedir(handler, rota);
    assert.equal(response.status, 401, rota);
    assert.equal((await response.json()).error, 'unauthorized');
  }
});

test('15. upload pelo backend grava no R2 e devolve só o que vai no registro', async () => {
  const { client, chamadas } = r2DeTeste();
  const handler = handlerDe(createStorageService({ client }));
  const response = await pedir(handler, '/storage/upload?prefix=EmployeePayment&recordId=p9&contentType=application/pdf&fileName=a.pdf', {
    method: 'POST', body: pdf,
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ['file_name', 'file_size', 'mime_type', 'storage_bucket', 'storage_path', 'storage_provider']);
  assert.equal(payload.storage_provider, 'r2');
  assert.match(payload.storage_path, /^EmployeePayment\/p9\/[0-9a-f-]{36}\.pdf$/);

  // A gravação foi para a chave com prefixo `anexos/` — o mesmo lugar da cópia.
  const put = chamadas.find((c) => c.method === 'PUT');
  assert.ok(put, 'o PUT realmente aconteceu');
  assert.match(put.url, new RegExp(`/${STORAGE_BUCKET_R2}/anexos/EmployeePayment/p9/[0-9a-f-]{36}\\.pdf`));
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=/);
  assert.ok(!JSON.stringify(payload).includes('segredo-de-teste'), 'a resposta não carrega segredo');
});

test('16. exclusão real está desligada por padrão e não é chamada por fluxo nenhum', async () => {
  const { client, chamadas } = r2DeTeste();
  const handler = handlerDe(createStorageService({ client }));
  const response = await pedir(handler, '/storage/delete?path=EmployeePayment/p/a.pdf', { method: 'POST' });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'delete_disabled');
  assert.equal(chamadas.filter((c) => c.method === 'DELETE').length, 0, 'nenhum DELETE saiu para o R2');

  // Nem no serviço: `delete` recusa antes de chegar ao cliente.
  await assert.rejects(createStorageService({ client }).delete({ path: 'EmployeePayment/p/a.pdf' }), /desabilitada/);
  // E o método existe para uma limpeza futura, explicitamente habilitada.
  const liberado = createStorageService({ client, allowDelete: true });
  const removido = await liberado.delete({ path: 'EmployeePayment/p/a.pdf' });
  assert.equal(removido.deleted, true);
  assert.equal(chamadas.filter((c) => c.method === 'DELETE').length, 1);
});

test('17. caminho fora do contrato é recusado no backend (400), não baixado', async () => {
  const { client, chamadas } = r2DeTeste();
  const handler = handlerDe(createStorageService({ client }));
  for (const ruim of ['OutroBucket/p/a.pdf', 'EmployeePayment/../a.pdf', 'EmployeePayment/p/a.exe', 'EmployeePayment/a/b/c.pdf']) {
    const response = await pedir(handler, `/storage/signed-url?path=${encodeURIComponent(ruim)}`);
    assert.equal(response.status, 400, ruim);
    assert.equal((await response.json()).error, 'invalid_path');
  }
  assert.equal(chamadas.length, 0, 'nenhuma requisição saiu para o R2');
});

test('18. sem credencial o backend responde 503 honesto em vez de subir quebrado', async () => {
  const handler = handlerDe(createStorageService({ client: null }));
  const health = await pedir(handler, '/storage/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    provider: 'r2', bucket: STORAGE_BUCKET_R2, configured: false, delete_enabled: false,
    write_provider: 'supabase', max_bytes: 15 * 1024 * 1024,
  });
  const leitura = await pedir(handler, '/storage/signed-url?path=EmployeePayment/p/a.pdf');
  assert.equal(leitura.status, 503);
  assert.equal((await leitura.json()).error, 'not_configured');
});
test('18b. o proxy do arquivo devolve o MIME e o nome corretos', async () => {
  const bytes = pdf;
  const { client } = r2DeTeste({ responde: () => new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } }) });
  const handler = handlerDe(createStorageService({ client }));
  const response = await pedir(handler, '/storage/object?path=EmployeePayment/p1/comprovante%20de%20mar%C3%A7o.pdf');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.equal(response.headers.get('content-disposition'), 'inline; filename="comprovante_de_mar_o.pdf"');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('18c. configuração: o endpoint deriva do account id e o check não imprime segredo', async () => {
  const completo = storageAPIConfigFromEnvironment({
    R2_ACCOUNT_ID: 'conta-de-teste', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'segredo',
    SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_ANON_KEY: 'anon',
  });
  assert.equal(completo.endpoint, 'https://conta-de-teste.r2.cloudflarestorage.com');
  assert.equal(completo.bucket, STORAGE_BUCKET_R2);
  assert.equal(completo.r2Prefix, STORAGE_R2_PREFIX);
  assert.equal(completo.allowDelete, false, 'exclusão desligada por padrão');
  assert.deepEqual(missingStorageConfig(completo), []);

  const incompleto = storageAPIConfigFromEnvironment({});
  assert.ok(missingStorageConfig(incompleto).includes('R2_ACCESS_KEY_ID'));
  assert.ok(missingStorageConfig(incompleto).includes('R2_SECRET_ACCESS_KEY'));

  // O script de check nunca mostra valor: só o texto da lista de nomes.
  const check = await read('scripts/check-storage-config.mjs');
  assert.match(check, /NUNCA é impresso/);
  for (const nome of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    const linha = check.split('\n').find((l) => l.includes(nome) && l.includes('console.log'));
    assert.ok(!linha || !linha.includes('valor}') || linha.includes('valor ?'), `${nome} não pode ser impresso por valor`);
  }
});
// ===========================================================================
// 6. SEGURANÇA DE CREDENCIAIS — o invariante que não pode quebrar
// ===========================================================================

test('19. nenhuma credencial do R2 chega ao frontend', async () => {
  const frontend = [
    'src/lib/paymentProof.js', 'src/lib/storage/attachmentPath.js', 'src/lib/storage/attachmentClient.js',
    'src/lib/attachmentViewer.js', 'src/components/rh/AttachmentPreview.jsx', 'src/components/financeiro/PayableAttachment.jsx',
    'src/components/financeiro/ExpenseAttachment.jsx', 'src/api/base44Client.js',
  ].map(read);
  const codigo = (await Promise.all(frontend)).join('\n');
  const linhasDeCodigo = codigo.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  // 1. Nenhum nome de variável de credencial em `src/` — nem em comentário.
  for (const nome of ['R2_SECRET_ACCESS_KEY', 'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_BUCKET']) {
    assert.ok(!codigo.includes(nome), `${nome} não pode aparecer no frontend`);
  }
  // 2. Nada de `VITE_` para credencial de armazenamento.
  assert.ok(!/VITE_R2_/.test(codigo), 'VITE_R2_* colocaria segredo no bundle');
  // 3. Nenhum SDK de S3/AWS no frontend.
  assert.ok(!/@aws-sdk|aws-sdk|S3Client|PutObjectCommand|getSignedUrl\s*\(/.test(linhasDeCodigo), 'o frontend não fala S3');
  assert.ok(!/cloudflarestorage\.com/.test(codigo), 'o endpoint do R2 não é conhecido pelo frontend');
  // 4. O que o frontend PODE ter: a URL do backend, e só ela.
  assert.match(linhasDeCodigo, /VITE_STORAGE_API_URL/);
  assert.equal((await read('src/lib/paymentProof.js')).includes('import.meta.env.VITE_R2'), false);
});

test('20. o backend lê credencial do ambiente, nunca de import.meta.env', async () => {
  for (const arquivo of ['server/storage/storageApi.mjs', 'server/storage/r2Client.mjs', 'server/storage/storageService.mjs', 'server/storage/storageHandler.mjs']) {
    const fonte = await read(arquivo);
    assert.ok(!/import\.meta\.env/.test(fonte), `${arquivo} não pode ler import.meta.env`);
  }
  const api = await read('server/storage/storageApi.mjs');
  for (const nome of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT']) {
    assert.match(api, new RegExp(`env\\.${nome}|env\\.R2_ENDPOINT`), `o backend precisa ler ${nome}`);
  }
  // O segredo nunca é devolvido por nenhuma rota.
  const handler = await read('server/storage/storageHandler.mjs');
  assert.ok(!/secretAccessKey/.test(handler), 'o handler nunca toca na chave secreta');
});

// ===========================================================================
// 7. NÃO REGRESSÃO DO VISUALIZADOR (item 16)
// ===========================================================================

test('21. AttachmentPreview continua funcionando: um visualizador, com zoom/download/PDF/imprimir', async () => {
  const fonte = await read('src/components/rh/AttachmentPreview.jsx');
  for (const acao of ['Baixar original', 'Baixar como PDF', 'Imprimir', 'zoomFromWheel', 'createPreviewSession', 'normalizeAttachment']) {
    assert.match(fonte, new RegExp(acao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `o AttachmentPreview mantém "${acao}"`);
  }
  // Nenhuma chamada a S3/R2 entrou no componente.
  assert.ok(!/\bR2\b|cloudflare|S3Client|putObject|createPresignedUrl/.test(fonte), 'o visualizador não conhece o R2');
  // E ele continua recebendo o arquivo pelo mesmo carregador de sempre.
  assert.match(fonte, /loadPaymentProof\(/);
});

test('22. nenhum componente React importa o cliente de armazenamento ou o backend', async () => {
  const arquivos = ['src/components/rh/AttachmentPreview.jsx', 'src/components/rh/PaymentProof.jsx',
    'src/components/financeiro/PayableAttachment.jsx', 'src/components/financeiro/ExpenseAttachment.jsx'];
  for (const arquivo of arquivos) {
    const fonte = await read(arquivo);
    assert.ok(!/storageApi|storageClient|attachmentClient/.test(fonte), `${arquivo} não deve falar com o backend de arquivos`);
  }
});

// ===========================================================================
// 8. FASE 2 — FEATURE FLAG DE ESCRITA, FAIL CLOSED E ATIVAÇÃO DO R2
// ===========================================================================

const clienteDeTeste = (health, extras = {}) => ({
  writeProvider: async () => (health?.write_provider === 'r2' && health?.configured !== false ? 'r2' : 'supabase'),
  health: async () => ({ provider: 'r2', configured: true, ready: true, ...health }),
  upload: async () => { throw new Error('upload nao deveria ter sido chamado'); },
  ...extras,
});

test('23. feature flag: sem provider explícito, o destino vem do BACKEND', async () => {
  // Backend com a flag em `supabase`: comportamento de antes, byte a byte.
  const gravados = [];
  const legado = await uploadPaymentProof({
    recordId: 'flag_1',
    file: arquivo('image/jpeg', jpeg, 'a.jpg'),
    storageApiClient: clienteDeTeste({ write_provider: 'supabase', configured: true }),
    accessToken: async () => 'jwt',
    storageClient: {
      upload: async (path, f, opts) => { gravados.push({ path, opts }); return { data: { path }, error: null }; },
      list: async () => ({ data: [], error: null }),
    },
  });
  assert.match(legado.storage_path, /^EmployeePayment\/flag_1\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(gravados.length, 1, 'o bucket do Supabase foi usado');
  assert.equal(legado.storage_provider, undefined, 'o caminho legado não ganha campo novo');

  // Backend com a flag em `r2`: o arquivo vai para o R2, com provider marcado.
  const enviado = [];
  const r2 = await uploadPaymentProof({
    recordId: 'flag_2',
    file: arquivo('application/pdf', pdf, 'b.pdf'),
    storageApiClient: clienteDeTeste({ write_provider: 'r2', configured: true }, {
      upload: async (dados) => {
        enviado.push(dados);
        return { storage_path: 'EmployeePayment/flag_2/uuid.pdf', storage_provider: 'r2', storage_bucket: STORAGE_BUCKET_R2, file_name: dados.file.name, mime_type: dados.file.type, file_size: dados.file.size };
      },
    }),
  });
  assert.equal(enviado.length, 1);
  assert.equal(enviado[0].prefix, 'EmployeePayment');
  assert.equal(r2.storage_provider, 'r2');
  assert.equal(r2.storage_bucket, STORAGE_BUCKET_R2);
  assert.equal(r2.mime_type, 'application/pdf');
});

test('24. rollback da flag: voltar para supabase e um comando de ambiente', async () => {
  // Trocar STORAGE_WRITE_PROVIDER é rollback; não existe constante no código.
  const fonte = await read('server/storage/storageApi.mjs');
  assert.match(fonte, /STORAGE_WRITE_PROVIDER/);
  assert.match(fonte, /WRITE_PROVIDERS/, 'o valor é validado contra uma lista');
  // Valor inventado não vira caminho de escrita: cai no lado seguro.
  assert.equal(storageAPIConfigFromEnvironment({ STORAGE_WRITE_PROVIDER: 'banana' }).writeProvider, 'supabase');
  assert.equal(storageAPIConfigFromEnvironment({ STORAGE_WRITE_PROVIDER: 'r2' }).writeProvider, 'r2');
  assert.equal(storageAPIConfigFromEnvironment({}).writeProvider, 'supabase', 'padrão é o comportamento antigo');
});

test('25. fail closed: R2 indisponível NÃO grava base64 e NÃO finge sucesso', async () => {
  for (const code of ['not_configured', 'unauthorized', 'forbidden', 'unavailable']) {
    let supabaseChamou = false;
    await assert.rejects(
      uploadPaymentProof({
        recordId: 'falha_1',
        file: arquivo('image/jpeg', jpeg, 'a.jpg'),
        storageApiClient: clienteDeTeste({ write_provider: 'r2', configured: true }, {
          upload: async () => { const e = new Error('x'); e.code = code; throw e; },
        }),
        // O caminho legado NÃO pode ser acionado como "plano B": se fosse,
        // o comprovante nasceria no bucket errado sem o Operador saber.
        storageClient: { upload: async () => { supabaseChamou = true; return { data: {}, error: null }; } },
      }),
      /Nada foi anexado|não autorizou|não está configurado/i,
      `código ${code} deve virar erro de tela`,
    );
    assert.equal(supabaseChamou, false, `código ${code}: nada foi gravado em outro lugar`);
  }

  // Resposta incompleta do backend (sem provider) também é falha fechada:
  // devolver caminho sem objeto criaria registro apontando para arquivo morto.
  await assert.rejects(
    uploadPaymentProof({
      recordId: 'falha_2',
      file: arquivo('image/jpeg', jpeg, 'a.jpg'),
      storageApiClient: clienteDeTeste({ write_provider: 'r2', configured: true }, {
        upload: async () => ({ storage_path: 'EmployeePayment/falha_2/a.jpg' }),
      }),
    }),
    /Nada foi anexado/,
  );

  // Provider desconhecido é erro, nunca palpite.
  await assert.rejects(
    uploadPaymentProof({
      recordId: 'falha_3',
      file: arquivo('image/jpeg', jpeg, 'a.jpg'),
      provider: 'dropbox',
      storageApiClient: clienteDeTeste({}),
    }),
    /desconhecido/,
  );
});

test('26. o health anuncia a flag, e nunca anuncia r2 sem cliente', async () => {
  const comCliente = handlerDe(createStorageService({ client: r2DeTeste().client }));
  const health = await pedir(comCliente, '/storage/health');
  assert.equal((await health.json()).write_provider, 'supabase', 'padrão continua supabase');

  const semCliente = handlerDe(createStorageService({ client: null }));
  const body = await (await pedir(semCliente, '/storage/health')).json();
  assert.equal(body.configured, false);
  assert.equal(body.write_provider, 'supabase', 'sem R2 configurado, nunca anuncia r2');
});

test('27. só o EmployeePayment usa uploadPaymentProof (nenhum outro fluxo mudou)', async () => {
  // A flag liga exatamente UM fluxo. Se outro fluxo chamar isto, a ativação
  // seria maior do que a aprovada.
  const fontes = (await Promise.all([
    'src/components/rh/PaymentForm.jsx', 'src/components/rh/ValeForm.jsx', 'src/components/rh/DocumentForm.jsx',
    'src/components/rh/EmployeeForm.jsx', 'src/components/financeiro/DailyExpenseForm.jsx',
    'src/pages/Financeiro.jsx', 'src/pages/Compras.jsx',
  ].map(read))).join('\n');
  assert.equal((fontes.match(/uploadPaymentProof\(/g) || []).length, 1,
    'apenas o PaymentForm anexa comprovante via uploadPaymentProof');
  // Os outros fluxos continuam no base64 (não migrar em massa).
  assert.ok((fontes.match(/UploadFile\(/g) || []).length >= 4,
    'os fluxos legados continuam em base64');
});

test('28. o smoke real pula sem credencial e não toca em nada', async () => {
  const fonte = await read('scripts/storage-smoke.mjs');
  assert.match(fonte, /SMOKE R2: PULADO/);
  // O cleanup só aceita o prefixo isolado de teste.
  assert.match(fonte, /PREFIXO_TESTE = `\$\{STORAGE_R2_PREFIX\}_r2_test\/`/);
  assert.match(fonte, /!chaveTeste\.startsWith\(PREFIXO_TESTE\)/);
  assert.match(fonte, /RECUSADO: caminho fora de/);
  // E nenhuma credencial real está no arquivo.
  assert.ok(!/AKIA[A-Z0-9]{8,}/.test(fonte), 'sem access key que pareça real');
});
