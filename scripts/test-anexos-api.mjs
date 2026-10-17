// Testes da API local de anexos do ADM-RUY (Agente 4).
//
// Cobrem: autenticação + limite de tentativas, validação de tipo/conteúdo/
// tamanho, autorização por usuário e por registro, URL assinada com TTL,
// CORS, uploads interrompidos, reinício do servidor, integridade por hash e
// operação sem Supabase. Tudo em diretórios temporários — nenhum dado real é
// lido ou alterado.

import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createProductionServer } from './production/server.mjs';
import { createAnexosApi } from './production/anexosApi.mjs';
import { createAuthStore } from './production/anexosAuth.mjs';
import { anexosPaths, ANEXOS_MAX_BYTES, createAnexosStore } from './production/anexos.mjs';
import { activate, inspectBuild, atomicJson } from './production/store.mjs';

// ---------------------------------------------------------------- fixtures

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ruy-anexos-api-'));
  t.after(async () => {
    const resolved = path.resolve(home);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ruy-anexos-api-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  // Release mínima para o servidor estático responder em paralelo à API.
  const site = path.join(home, 'releases', 'v1', 'site');
  await fs.mkdir(path.join(site, 'assets'), { recursive: true });
  await fs.writeFile(path.join(site, 'index.html'), '<html>anexos<script src="/releases/v1/assets/app.js"></script></html>');
  await fs.writeFile(path.join(site, 'assets', 'app.js'), "console.log('anexos')");
  await atomicJson(path.join(home, 'releases', 'v1', 'manifest.json'), await inspectBuild(site, 'v1'));
  await activate(home, 'v1');
  return home;
}

async function startServer(t, home) {
  const server = createProductionServer({ home });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

// Bytes válidos para cada tipo (magic bytes + marcador estrutural final).
const pngBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('IHDR-idat-bloco-de-exemplo'),
  Buffer.from('IEND'),
  Buffer.from([0, 0, 0, 0]),
]);
const jpegBytes = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF-exemplo'),
  Buffer.from([0xff, 0xd9]),
]);
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\nstartxref\n0\n%%EOF\n');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function bootstrap(base, overrides = {}) {
  return fetch(`${base}/api/anexos/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ruy.local', password: 'Segura123!', name: 'Admin', ...overrides }),
  });
}

async function login(base, email, password) {
  return fetch(`${base}/api/anexos/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function getToken(base, email = 'admin@ruy.local', password = 'Segura123!') {
  let res = await login(base, email, password);
  if (res.status === 401) {
    // Primeira execução neste diretório temporário: provisiona o admin.
    await bootstrap(base, { email, password });
    res = await login(base, email, password);
  }
  assert.equal(res.status, 200, `login de ${email} deve funcionar`);
  return (await res.json()).access_token;
}

async function upload(base, token, {
  bytes, mime = 'image/png', name = 'comprovante.png',
  entity = 'FinancialExpense', recordId = 'rec_1', field = 'proof_url', extraHeaders = {},
} = {}) {
  return fetch(`${base}/api/anexos`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': mime,
      'X-File-Name': encodeURIComponent(name),
      'X-Record-Entity': entity,
      'X-Record-Id': recordId,
      'X-Attachment-Field': field,
      ...extraHeaders,
    },
    body: bytes,
  });
}

// ---------------------------------------------------------------- testes

test('API anexos: ping, bootstrap só em loopback, login e limite de tentativas', async (t) => {
  const base = await startServer(t, await fixture(t));

  const ping = await fetch(`${base}/api/anexos/ping`);
  assert.equal(ping.status, 200);
  assert.equal((await ping.json()).service, 'anexos-locais');

  // Sem contas: login falha sem dizer se o e-mail existe.
  const semConta = await login(base, 'admin@ruy.local', 'Segura123!');
  assert.equal(semConta.status, 401);

  // Bootstrap cria o primeiro admin; repetir é recusado.
  assert.equal((await bootstrap(base)).status, 201);
  assert.equal((await bootstrap(base)).status, 409);

  const ok = await login(base, 'admin@ruy.local', 'Segura123!');
  assert.equal(ok.status, 200);
  const session = await ok.json();
  assert.match(session.access_token, /^v1\./);
  assert.equal(session.user.role, 'admin');
  assert.ok(!JSON.stringify(session).includes('password_hash'), 'hash da senha nunca sai na API');

  // 5 falhas para o MESMO e-mail em 15 min → bloqueio 429 (janela deslizante).
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const wrong = await login(base, 'bloqueio@ruy.local', 'senha-errada');
    assert.equal(wrong.status, 401, `tentativa ${attempt} deve dar 401`);
  }
  const locked = await login(base, 'bloqueio@ruy.local', 'senha-errada');
  assert.equal(locked.status, 429, '6ª tentativa na janela deve ser bloqueada');
  assert.ok(Number(locked.headers.get('retry-after')) >= 1);
  // Até a senha correta é recusada enquanto durar o bloqueio.
  assert.equal((await login(base, 'bloqueio@ruy.local', 'Segura123!')).status, 429);

  // Outro e-mail não é afetado pelo bloqueio de terceiros.
  assert.equal((await login(base, 'admin@ruy.local', 'Segura123!')).status, 200);

  // O site estático continua respondindo normalmente na mesma porta.
  const site = await fetch(base + '/');
  assert.equal(site.status, 200);
  assert.match(await site.text(), /<html>anexos/);
});

test('API anexos: upload validado, caminho opaco e autorização por usuário', async (t) => {
  const home = await fixture(t);
  const base = await startServer(t, home);
  const admin = await getToken(base);

  // Sem token → 401; origem estranha → 403.
  assert.equal((await upload(base, null, { bytes: pngBytes })).status, 401);
  const cross = await upload(base, admin, {
    bytes: pngBytes,
    extraHeaders: { Origin: 'https://malicioso.example' },
  });
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.get('access-control-allow-origin'), null);

  const created = await upload(base, admin, { bytes: pngBytes, name: 'Nota fiscal.png' });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.attachment_id, /^anx_[0-9a-f]{32}$/);
  assert.equal(body.available, true);
  assert.equal(body.sha256, sha256(pngBytes));
  assert.equal(body.bytes, pngBytes.length);
  assert.equal(body.entity, 'FinancialExpense');
  assert.equal(body.record_id, 'rec_1');

  // Identificador interno: arquivo no disco SEM o nome original no caminho.
  const paths = anexosPaths(home);
  const shard = body.attachment_id.slice(5, 7);
  const onDisk = path.join(paths.files, shard, body.attachment_id);
  assert.deepEqual(await fs.readFile(onDisk), pngBytes);
  const metaOnDisk = await fs.readFile(path.join(paths.meta, `${body.attachment_id}.json`), 'utf8');
  assert.ok(metaOnDisk.includes('Nota fiscal'), 'nome original fica só nos metadados');

  // Segundo usuário: sem acesso ao anexo de terceiros.
  await createAuthStore({ home }).createUser({ email: 'outra@ruy.local', password: 'OutraSenha123', role: 'user' });
  const outra = await getToken(base, 'outra@ruy.local', 'OutraSenha123');
  const metaUrl = `${base}/api/anexos/${body.attachment_id}`;
  assert.equal((await fetch(metaUrl, { headers: { Authorization: `Bearer ${outra}` } })).status, 403);
  assert.equal((await fetch(metaUrl, { headers: { Authorization: `Bearer ${outra}` }, method: 'DELETE' })).status, 403);
  assert.equal((await fetch(metaUrl)).status, 401);
  assert.equal((await fetch(metaUrl, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);

  // Dono (admin) pode excluir; depois disso o anexo some de verdade.
  const del = await fetch(metaUrl, { headers: { Authorization: `Bearer ${admin}` }, method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await fetch(metaUrl, { headers: { Authorization: `Bearer ${admin}` } })).status, 404);
  await assert.rejects(fs.readFile(onDisk));
});

test('API anexos: tipo, extensão, conteúdo e tamanho são validados', async (t) => {
  const home = await fixture(t);
  const base = await startServer(t, home);
  const token = await getToken(base);

  // Tipo fora da allowlist → 415 (nem chega a gravar).
  assert.equal((await upload(base, token, { bytes: Buffer.from('<html>oi</html>'), mime: 'text/html', name: 'x.html' })).status, 415);
  // Extensão não bate com o MIME declarado → 422.
  assert.equal((await upload(base, token, { bytes: pngBytes, mime: 'image/png', name: 'nota.pdf' })).status, 422);
  // Conteúdo falso: declara PNG mas o arquivo é PDF → 422.
  const falso = await upload(base, token, { bytes: pdfBytes, mime: 'image/png', name: 'fake.png' });
  assert.equal(falso.status, 422);
  assert.equal((await falso.json()).error, 'conteudo_nao_corresponde');
  // JPEG truncado (sem FF D9) → conteúdo incompleto.
  const truncado = jpegBytes.subarray(0, jpegBytes.length - 2);
  assert.equal((await upload(base, token, { bytes: truncado, mime: 'image/jpeg', name: 'x.jpg' })).status, 422);
  // Vazio → 422.
  assert.equal((await upload(base, token, { bytes: Buffer.alloc(0), mime: 'image/png', name: 'vazio.png' })).status, 422);
  // Registro associado inválido → 400.
  assert.equal((await upload(base, token, { bytes: pngBytes, recordId: '../fora' })).status, 400);

  // Content-Length acima do limite: recusado ANTES de ler o corpo (413).
  const over = await new Promise((resolve) => {
    const req = http.request(`${base}/api/anexos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/png',
        'X-File-Name': 'grande.png',
        'X-Record-Entity': 'FinancialExpense',
        'X-Record-Id': 'rec_1',
        'Content-Length': ANEXOS_MAX_BYTES + 1,
        Connection: 'close',
      },
    });
    req.on('response', (res) => { resolve(res.statusCode); res.resume(); res.on('end', () => req.destroy()); });
    req.on('error', () => resolve(null));
    req.end(Buffer.alloc(64));
  });
  assert.equal(over, 413);

  // Sem Content-Length (corpo em chunked) → 411: o servidor exige o tamanho.
  const semTamanho = await new Promise((resolve) => {
    const req = http.request(`${base}/api/anexos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/png',
        'X-File-Name': 'chunked.png',
        'X-Record-Entity': 'FinancialExpense',
        'X-Record-Id': 'rec_1',
        'Transfer-Encoding': 'chunked',
        Connection: 'close',
      },
    });
    req.on('response', (res) => { resolve(res.statusCode); res.resume(); res.on('end', () => req.destroy()); });
    req.on('error', () => resolve(null));
    req.end(pngBytes);
  });
  assert.equal(semTamanho, 411);

  // Nada sobrou na fila de uploads: tmp sem .part mesmo após recusas.
  const paths = anexosPaths(home);
  assert.deepEqual((await fs.readdir(paths.tmp)).filter((n) => n.endsWith('.part')), []);
});

test('API anexos: CORS por allowlist e URL assinada com TTL', async (t) => {
  const home = await fixture(t);
  const base = await startServer(t, home);
  const token = await getToken(base);

  // Preflight da origem de DEV é atendido no host; origem estranha, não.
  const preOk = await fetch(`${base}/api/anexos`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preOk.status, 204);
  assert.equal(preOk.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(preOk.headers.get('access-control-allow-headers') || '', /Authorization/i);
  const preNegado = await fetch(`${base}/api/anexos`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(preNegado.status, 403);

  const created = await (await upload(base, token, { bytes: jpegBytes, mime: 'image/jpeg', name: 'foto.jpg' })).json();

  // URL assinada: TTL curto, só para ESTE anexo, sem exigir header.
  const signed = await fetch(`${base}/api/anexos/${created.attachment_id}/url-assinada`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(signed.status, 200);
  const { url, expires_in } = await signed.json();
  assert.ok(expires_in > 0 && expires_in <= 300);
  const conteudo = await fetch(base + url);
  assert.equal(conteudo.status, 200);
  assert.equal(conteudo.headers.get('content-type'), 'image/jpeg');
  assert.equal(conteudo.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(conteudo.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await conteudo.arrayBuffer()), jpegBytes);

  // Token adulterado ou de OUTRO anexo não abre nada.
  const adulterado = await fetch(`${base}/api/anexos/${created.attachment_id}/conteudo?tk=${encodeURIComponent(`${url.split('tk=')[1]}x`)}`);
  assert.equal(adulterado.status, 401);
  const criado2 = await (await upload(base, token, { bytes: pngBytes, name: 'outro.png', recordId: 'rec_2' })).json();
  const signed2 = await (await fetch(`${base}/api/anexos/${criado2.attachment_id}/url-assinada`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  })).json();
  const trocado = await fetch(`${base}/api/anexos/${created.attachment_id}/conteudo?tk=${encodeURIComponent(signed2.url.split('tk=')[1])}`);
  assert.equal(trocado.status, 401, 'URL assinada de um anexo não vale para outro');

  // TTL: instância com TTL de 100 ms — o mesmo token deixa de valer.
  const api = createAnexosApi({ home, downloadTtlMs: 100 });
  const servidor = http.createServer((req, res) => api(req, res));
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  try {
    const base2 = `http://127.0.0.1:${servidor.address().port}`;
    const token2 = await getToken(base2);
    const s = await (await fetch(`${base2}/api/anexos/${created.attachment_id}/url-assinada`, {
      method: 'POST', headers: { Authorization: `Bearer ${token2}` },
    })).json();
    assert.equal((await fetch(base2 + s.url)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal((await fetch(base2 + s.url)).status, 401, 'URL assinada expirada deve ser recusada');
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
});

test('API anexos: upload interrompido vira pendência e o reinício preserva os anexos', async (t) => {
  const home = await fixture(t);
  let base = await startServer(t, home);
  const token = await getToken(base);
  const created = await (await upload(base, token, { bytes: pngBytes, name: 'persistente.png' })).json();

  // Simula a queda do servidor no meio de dois uploads: `.part` órfãos.
  const paths = anexosPaths(home);
  await fs.writeFile(path.join(paths.tmp, `${randomUUID()}.part`), Buffer.alloc(100));
  await fs.writeFile(path.join(paths.tmp, `${randomUUID()}.part`), Buffer.alloc(50));

  // Reinício: novo servidor no mesmo diretório de produção.
  base = await startServer(t, home);
  assert.equal((await fetch(`${base}/api/anexos/ping`)).status, 200); // dispara a varredura

  const pend = await fetch(`${base}/api/anexos/pendencias`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(pend.status, 200);
  const interrompidos = (await pend.json()).pendencias.filter((p) => p.tipo === 'upload_interrompido');
  assert.equal(interrompidos.length, 2, 'uploads mortos entram na fila de pendências');
  for (const p of interrompidos) {
    assert.equal(p.status, 'pendente');
    assert.ok(p.bytes > 0);
    assert.equal(p.motivo, 'reinicio_do_servidor');
  }
  assert.deepEqual((await fs.readdir(paths.tmp)).filter((n) => n.endsWith('.part')), []);

  // Só admin lê a fila.
  await createAuthStore({ home }).createUser({ email: 'user@ruy.local', password: 'Usuario1234', role: 'user' });
  const userToken = await getToken(base, 'user@ruy.local', 'Usuario1234');
  assert.equal((await fetch(`${base}/api/anexos/pendencias`, { headers: { Authorization: `Bearer ${userToken}` } })).status, 403);

  // O anexo anterior sobrevive ao reinício e é servido com hash conferido.
  const conteudo = await fetch(`${base}/api/anexos/${created.attachment_id}/conteudo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(conteudo.status, 200);
  assert.deepEqual(Buffer.from(await conteudo.arrayBuffer()), pngBytes);

  // Ledger registra uploads e interrupções (append-only).
  const ledger = await fs.readFile(paths.ledger, 'utf8');
  assert.match(ledger, /"op":"upload"/);
  assert.match(ledger, /"op":"upload_interrompido"/);
});

test('API anexos: integridade por hash e operação sem Supabase', async (t) => {
  const home = await fixture(t);
  const base = await startServer(t, home);
  const token = await getToken(base);
  const created = await (await upload(base, token, { bytes: pngBytes, name: 'integro.png' })).json();

  const store = createAnexosStore({ home });
  const relatorio = await store.verifyIntegrity();
  assert.equal(relatorio.attachments, 1);
  assert.deepEqual(relatorio.mismatches, []);
  assert.deepEqual(relatorio.missing, []);

  // Adulteração no disco: detectada e nunca servida.
  const paths = anexosPaths(home);
  const file = path.join(paths.files, created.attachment_id.slice(5, 7), created.attachment_id);
  await fs.appendFile(file, Buffer.from([0x00]));
  const adulterado = await store.verifyIntegrity();
  assert.deepEqual(adulterado.mismatches, [created.attachment_id]);
  const servido = await fetch(`${base}/api/anexos/${created.attachment_id}/conteudo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(servido.status, 500, 'arquivo adulterado não pode ser servido');
  assert.equal((await servido.json()).error, 'integridade_falhou');

  // Nenhum módulo da API importa o Supabase — a rota funciona offline.
  const productionDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'production');
  for (const name of ['anexos.mjs', 'anexosAuth.mjs', 'anexosApi.mjs']) {
    const source = await fs.readFile(path.join(productionDir, name), 'utf8');
    assert.ok(!/from ['"][^'"]*supabase/i.test(source), `${name} não deve importar o SDK do Supabase`);
  }
  assert.equal((await fetch(`${base}/api/anexos/ping`)).status, 200);
});





