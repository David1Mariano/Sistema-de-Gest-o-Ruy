// ===========================================================================
// SMOKE TEST REAL DO R2 (Fase 2). Roda SÓ quando há credencial no ambiente.
//
//   node scripts/storage-smoke.mjs
//   node scripts/storage-smoke.mjs --manter        (nao apaga o objeto de teste)
//   node scripts/storage-smoke.mjs --path=EmployeePayment/<id>/<uuid>.jpg
//
// Sem `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` no ambiente ele IMPRIME QUE
// PULOU e termina com 0. Isso é proposital: a CI continua verde numa máquina
// sem credencial e ninguém precisa "inventar" uma chave.
//
// O QUE ESTE SCRIPT FAZ (e nada mais):
//   1. exists() + getSignedUrl() + download() em um objeto JA EXISTENTE
//      (o `storage_path` do EmployeePayment, ou o que vier em --path).
//      NADA é gravado nem alterado.
//   2. upload de um objeto de teste em `anexos/_r2_test/` — prefixo isolado,
//      conteudo sem dado real.
//   3. exists + download + signed URL desse objeto.
//   4. cleanup DO OBJETO DE TESTE, e só dele: a remoção é recusada se o
//      caminho não começar exatamente com `anexos/_r2_test/`.
//
// NUNCA apaga objeto de produção. A exclusão de produção continua desligada.
import { storageAPIConfigFromEnvironment, missingStorageConfig } from '../server/storage/storageApi.mjs';
import { createR2Client } from '../server/storage/r2Client.mjs';
import { STORAGE_BUCKET_R2, STORAGE_R2_PREFIX, r2ObjectKey } from '../src/lib/storage/attachmentPath.js';

const PREFIXO_TESTE = `${STORAGE_R2_PREFIX}_r2_test/`;
const MANTER = process.argv.includes('--manter');
const argPath = process.argv.find((a) => a.startsWith('--path='));

let falhas = 0;
const ok = (msg) => console.log(`  OK    ${msg}`);
const erro = (msg) => { falhas += 1; console.log(`  FALHA ${msg}`); };

const config = storageAPIConfigFromEnvironment();
const faltando = missingStorageConfig(config);

if (faltando.length) {
  console.log('SMOKE R2: PULADO (sem credencial no ambiente).');
  console.log(`  Faltam: ${faltando.join(', ')}`);
  console.log('  Nada foi criado, assinado, lido ou apagado.');
  console.log('  Para rodar: defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY no ambiente do backend.');
  process.exit(0);
}
if (config.bucket !== STORAGE_BUCKET_R2) {
  console.log(`SMOKE R2: PULADO (bucket "${config.bucket}" difere do contrato "${STORAGE_BUCKET_R2}").`);
  process.exit(0);
}

const client = createR2Client({
  endpoint: config.endpoint,
  accessKeyId: config.accessKeyId,
  secretAccessKey: config.secretAccessKey,
  bucket: config.bucket,
  region: config.region,
  request: fetch,
});

console.log(`SMOKE R2 — bucket ${config.bucket}, prefixo ${STORAGE_R2_PREFIX}`);
console.log(`  feature flag STORAGE_WRITE_PROVIDER: ${config.writeProvider}\n`);
// ── 1. OBJETO EXISTENTE (leitura pura, nada é gravado) ───────────────────────
const existente = argPath
  ? argPath.slice('--path='.length)
  : 'EmployeePayment/id_muo3sqxy_kmti6oss/d829dd79-b2e0-4997-9ab3-b583ed93112a.jpg';
const chaveExistente = r2ObjectKey(existente);
console.log(`[1] objeto existente: ${chaveExistente}`);
try {
  const head = await client.headObject(chaveExistente);
  if (head.exists) ok(`exists() = true, ${head.size} bytes, mime ${head.contentType}`);
  else erro('exists() = false (objeto nao esta no R2)');

  const signed = await client.createPresignedUrl(chaveExistente, { expiresIn: 300 });
  const parsed = new URL(signed.url);
  ok(`signed URL gerada (ttl ${signed.expiresIn}s, assinatura ${String(parsed.searchParams.get('X-Amz-Signature')).slice(0, 12)}...)`);
  if (signed.url.includes(config.secretAccessKey)) erro('A CHAVE SECRETA APARECEU NA URL');

  const viaUrl = await fetch(signed.url);
  if (!viaUrl.ok) erro(`download pela signed URL: HTTP ${viaUrl.status}`);
  else {
    const bytes = Buffer.from(await viaUrl.arrayBuffer());
    const mime = (viaUrl.headers.get('content-type') || '').split(';')[0];
    ok(`download pela signed URL: HTTP 200, ${bytes.length} bytes, mime ${mime}`);
    if (head.exists && bytes.length !== head.size) erro(`tamanho divergente: signed=${bytes.length} head=${head.size}`);
  }

  const direto = await client.getObject(chaveExistente);
  ok(`download direto (GET autenticado): ${direto.size} bytes, mime ${direto.contentType}`);
} catch (e) {
  erro(`objeto existente: ${e.code || ''} ${e.message}`);
}

// ── 2. UPLOAD ISOLADO ───────────────────────────────────────────────────────
const chaveTeste = `${PREFIXO_TESTE}r2-healthcheck.txt`;
const conteudo = `smoke r2 ${new Date().toISOString()}\nsem dado real\n`;
console.log(`\n[2] upload isolado: ${chaveTeste}`);
let gravado = false;
try {
  await client.putObject(chaveTeste, Buffer.from(conteudo, 'utf8'), { contentType: 'text/plain' });
  gravado = true;
  ok('PUT aceito');

  const head = await client.headObject(chaveTeste);
  if (!head.exists) erro('exists() = false apos o PUT');
  else ok(`exists() = true, ${head.size} bytes (esperado ${Buffer.byteLength(conteudo)})`);

  const back = await client.getObject(chaveTeste);
  if (back.body.toString('utf8') !== conteudo) erro('download devolveu conteudo diferente do enviado');
  else ok('round trip: download devolve exatamente o que foi enviado');

  const signed = await client.createPresignedUrl(chaveTeste, { expiresIn: 60 });
  const resposta = await fetch(signed.url);
  if (!resposta.ok) erro(`signed URL do objeto de teste: HTTP ${resposta.status}`);
  else ok('signed URL do objeto de teste responde HTTP 200');
} catch (e) {
  erro(`upload de teste: ${e.code || ''} ${e.message}`);
}

// ── 3. CLEANUP DO OBJETO DE TESTE (e SÓ DELE) ────────────────────────────────
console.log(`\n[3] cleanup: ${chaveTeste}`);
if (!gravado) console.log('  nada foi gravado; nada a limpar');
else if (MANTER) console.log('  --manter: objeto de teste preservado');
else {
  // PROVA exigida pelo procedimento: o caminho TEM de estar no prefixo de
  // teste. Sem isto, o script recusa. Não existe "se parece com teste".
  if (!chaveTeste.startsWith(PREFIXO_TESTE)) erro(`RECUSADO: caminho fora de ${PREFIXO_TESTE}`);
  else {
    const resultado = await client.deleteObject(chaveTeste);
    const depois = await client.headObject(chaveTeste);
    if (depois.exists) erro('objeto de teste ainda existe apos o DELETE');
    else ok(`objeto de teste removido (deleted=${resultado.deleted})`);
  }
}

console.log(`\nSMOKE R2: ${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
