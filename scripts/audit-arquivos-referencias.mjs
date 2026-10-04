// ===========================================================================
// AUDITORIA DE REFERENCIAS DE ARQUIVO — SOMENTE LEITURA.
//
// Nao escreve nada: apenas GET em /rest/v1/records. Imprime nome de entidade,
// nome de campo, tamanho e caminho. Nenhum byte de arquivo, nenhuma credencial
// e nenhum trecho de base64 aparece no relatorio.
//
//   node scripts/audit-arquivos-referencias.mjs
//
// Le a URL/chave do ambiente. As chaves PUBLICAS do frontend podem ser usadas
// (sao `sb_publishable_`, nao `service_role`). A chave do Supabase NAO vai para
// o bundle: este script roda em Node, nao no navegador.
//
// Variaveis: SUPABASE_URL (ou VITE_SUPABASE_URL) e SUPABASE_ANON_KEY
// (ou VITE_SUPABASE_ANON_KEY).
import { readFile } from 'node:fs/promises';

const CAMPOS = ['proof_url', 'document_url', 'invoice_url', 'photo_url', 'file_url', 'storage_path'];

async function env() {
  const out = { ...process.env };
  try {
    const txt = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
    for (const linha of txt.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (m && out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* sem .env.local: so variaveis de ambiente */ }
  return out;
}

const e = await env();
const url = (e.SUPABASE_URL || e.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = e.SUPABASE_ANON_KEY || e.VITE_SUPABASE_ANON_KEY || '';
if (!url || !key) { console.error('Faltam SUPABASE_URL/SUPABASE_ANON_KEY. Nada foi consultado.'); process.exit(1); }

const headers = { apikey: key, Authorization: `Bearer ${key}`, accept: 'application/json' };
const r = await fetch(`${url}/rest/v1/records?select=entity,data`, { headers });
if (!r.ok) { console.error('HTTP', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
const rows = await r.json();

const resumo = {};
const storagePaths = [];
const base64PorCampo = {};
const httpUrls = new Set();

for (const row of rows) {
  const d = row.data || {};
  resumo[row.entity] = (resumo[row.entity] || 0) + 1;
  for (const campo of CAMPOS) {
    const valor = d[campo];
    if (typeof valor !== 'string' || !valor) continue;
    if (valor.startsWith('data:')) {
      const k = `${row.entity}.${campo}`;
      base64PorCampo[k] = (base64PorCampo[k] || 0) + 1;
    } else if (/^https?:\/\//i.test(valor)) {
      httpUrls.add(`${row.entity}.${campo}`);
    } else if (campo === 'storage_path') {
      storagePaths.push({ entity: row.entity, id: d.id, path: valor, mime: d.mime_type || '', file: d.file_name || '', size: d.file_size ?? null });
    }
  }
}

console.log('=== REGISTROS POR ENTIDADE ===');
for (const [e, n] of Object.entries(resumo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${e}`);

console.log('\n=== storage_path (caminhos de bucket) ===');
console.log(`  total: ${storagePaths.length}`);
for (const s of storagePaths) console.log(`  ${s.entity.padEnd(18)} ${s.id} :: ${s.path} :: ${s.mime} :: ${s.file} :: ${s.size}`);

console.log('\n=== BASE64 LEGADO (data:) POR ENTIDADE.CAMPO ===');
console.log(`  total: ${Object.values(base64PorCampo).reduce((a, b) => a + b, 0)}`);
for (const [k, n] of Object.entries(base64PorCampo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

console.log('\n=== URL http(s) ===');
console.log(`  total: ${httpUrls.size}`);
for (const u of httpUrls) console.log(`  ${u}`);
