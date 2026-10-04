// ===========================================================================
// AUDITORIA DE REFERENCIAS DE ARQUIVO — SOMENTE LEITURA.
//
// Nao escreve nada: um unico GET em /rest/v1/records. Imprime nome de
// entidade, nome de campo, tamanho e caminho. Nenhum byte de arquivo, nenhuma
// credencial e nenhum trecho de base64 aparece no relatorio.
//
//   node scripts/audit-arquivos-referencias.mjs
//   node scripts/audit-arquivos-referencias.mjs --r2-list=chaves-r2.txt
//
// A URL/chave vem do MESMO lugar que o app usa (`src/lib/cloudConfig.js`), ou
// do ambiente. A chave e sempre a PUBLICA (`sb_publishable_`); a service_role
// nao e usada nem aceita aqui.
//
// --r2-list recebe a saida de `rclone lsf r2:ruy-gestao-arquivos` (uma chave
// por linha) e cruza com as referencias do banco, separando:
//   - referencia sem objeto no R2  (arquito quebrado)
//   - objeto no R2 sem referencia (orfao)
import { readFile } from 'node:fs/promises';
import { cloudConfig } from '../src/lib/cloudConfig.js';

const CAMPOS = ['proof_url', 'document_url', 'invoice_url', 'photo_url', 'file_url', 'storage_path'];
const PREFIXO_R2 = 'anexos/';

const url = cloudConfig.url.replace(/\/+$/, '');
const key = cloudConfig.key;
if (!url || !key) { console.error('Sem configuracao do Supabase. Nada foi consultado.'); process.exit(1); }
if (!/^sb_publishable_/.test(key)) {
  console.error('A chave precisa ser a publica (sb_publishable_). Nada foi consultado.');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' };
const r = await fetch(`${url}/rest/v1/records?select=entity,data`, { headers });
if (!r.ok) { console.error('HTTP', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
const rows = await r.json();

const classify = (v) => {
  if (typeof v !== 'string' || !v) return null;
  if (/^data:/i.test(v)) return 'base64';
  if (/^blob:/i.test(v)) return 'blob';
  if (/^https?:\/\//i.test(v)) return 'http';
  return 'caminho';
};
const resumo = {};
const porCampo = {};
const porOrigem = { base64: 0, http: 0, blob: 0, caminho: 0 };
const porProvider = {};
const storagePaths = [];
const registrosComAlgumAnexo = new Set();
const comOsDois = [];

for (const row of rows) {
  const d = row.data || {};
  resumo[row.entity] = (resumo[row.entity] || 0) + 1;
  const storage = classify(d.storage_path);
  const legado = ['proof_url', 'document_url', 'invoice_url', 'photo_url', 'file_url']
    .map((campo) => classify(d[campo])).find((tipo) => tipo && tipo !== 'caminho');
  // storage_path tem PRECEDENCIA na leitura; o legado vira resto morto.
  if (storage && legado) comOsDois.push(`${row.entity}:${d.id} -> ${d.storage_path}`);

  for (const campo of CAMPOS) {
    const valor = d[campo];
    const tipo = classify(valor);
    if (!tipo) continue;
    registrosComAlgumAnexo.add(`${row.entity}:${d.id}`);
    const k = `${row.entity}.${campo}`;
    porCampo[k] = porCampo[k] || {};
    porCampo[k][tipo] = (porCampo[k][tipo] || 0) + 1;
    porOrigem[tipo] += 1;
    if (campo === 'storage_path') {
      const provider = d.storage_provider || '(ausente = supabase)';
      porProvider[provider] = (porProvider[provider] || 0) + 1;
      storagePaths.push({ entity: row.entity, id: d.id, path: valor, mime: d.mime_type || '', file: d.file_name || '', size: d.file_size ?? null, provider });
    }
  }
}

console.log('=== TOTAL DE REGISTROS ===');
console.log(`  ${rows.length}`);
console.log(`  registros com algum campo de anexo preenchido: ${registrosComAlgumAnexo.size}`);
console.log(`  entidades: ${Object.keys(resumo).length}`);

console.log('\n=== POR ENTIDADE (total de registros) ===');
for (const [e, n] of Object.entries(resumo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${e}`);

console.log('\n=== POR ENTIDADE.CAMPO (e tipo) ===');
for (const k of Object.keys(porCampo).sort()) {
  const tipos = Object.entries(porCampo[k]).map(([t, n]) => `${t}=${n}`).join(' ');
  console.log(`  ${k.padEnd(38)} ${tipos}`);
}

console.log('\n=== TOTAIS POR TIPO DE REFERENCIA ===');
console.log(`  base64 (data:...)   ${porOrigem.base64}`);
console.log(`  http(s)             ${porOrigem.http}`);
console.log(`  blob:               ${porOrigem.blob}`);
console.log(`  caminho de bucket   ${porOrigem.caminho}`);

console.log('\n=== storage_path POR PROVIDER ===');
for (const [p, n] of Object.entries(porProvider)) console.log(`  ${String(n).padStart(5)}  ${p}`);
console.log(`  total storage_path: ${storagePaths.length}`);
const distintos = new Set(storagePaths.map((s) => s.path));
const mimes = {};
for (const s of storagePaths) mimes[s.mime || '(vazio)'] = (mimes[s.mime || '(vazio)'] || 0) + 1;
console.log(`  caminhos distintos: ${distintos.size}`);
console.log(`  por MIME: ${Object.entries(mimes).map(([m, n]) => `${m}=${n}`).join(' ')}`);
console.log(`\n=== REGISTROS COM storage_path E LEGADO (storage_path vence) ===`);
console.log(`  ${comOsDois.length}`);
for (const linha of comOsDois) console.log(`      ${linha}`);

console.log('\n=== storage_path DETALHADO ===');
for (const s of storagePaths) {
  console.log(`  ${s.entity.padEnd(16)} ${String(s.id).padEnd(26)} ${s.path}`);
  console.log(`      mime=${s.mime || '(vazio)'} file=${s.file || '(vazio)'} size=${s.size ?? '(vazio)'} provider=${s.provider}`);
}

const arg = process.argv.find((a) => a.startsWith('--r2-list='));
const argPaths = process.argv.find((a) => a.startsWith('--write-paths='));
if (argPaths) {
  const destino = argPaths.slice('--write-paths='.length);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(destino, storagePaths.map((s) => `${PREFIXO_R2}${s.path}`).join('\n') + '\n', 'utf8');
  console.log(`\n=== CHAVES REFERENCIADAS ESCRITAS ===\n  ${destino} (${storagePaths.length} linhas)`);
}

if (arg) {
  const arquivo = arg.slice('--r2-list='.length);
  const chaves = (await readFile(arquivo, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const conjunto = new Set(chaves);
  const referenciados = new Set(storagePaths.map((s) => `${PREFIXO_R2}${s.path}`));
  const semObjeto = [...referenciados].filter((k) => !conjunto.has(k));
  const orfaos = chaves.filter((k) => !referenciados.has(k));
  console.log(`\n=== CRUZAMENTO COM O R2 (${arquivo}) ===`);
  console.log(`  objetos no R2                     ${chaves.length}`);
  console.log(`  referencias com objeto no R2      ${referenciados.size - semObjeto.length}`);
  console.log(`  referencia SEM objeto no R2       ${semObjeto.length}`);
  for (const k of semObjeto) console.log(`      FALTA: ${k}`);
  console.log(`  objeto SEM referencia (orfao)     ${orfaos.length}`);
  for (const k of orfaos) console.log(`      ORFAO: ${k}`);
} else {
  console.log('\n(Informe --r2-list=<arquivo com `rclone lsf r2:ruy-gestao-arquivos` para o cruzamento.)');
}
