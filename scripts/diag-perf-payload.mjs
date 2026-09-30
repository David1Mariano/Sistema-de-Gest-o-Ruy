// MEDIÇÃO (somente leitura). Descobre por que FinancialExpense devolve 6 MB.
//
// 107 registros = 6 MB ≈ 58 KB por registro. Isso não é "muitos registros",
// é um campo grande demais dentro de cada um. Mede o tamanho por campo.

import { readFileSync } from 'node:fs';

const cfg = readFileSync('src/lib/cloudConfig.js', 'utf8');
const url = cfg.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)[1];
const key = cfg.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)[1];

const r = await fetch(`${url}/rest/v1/records?entity=eq.FinancialExpense&select=data`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const texto = await r.text();
const registros = JSON.parse(texto);
const dados = registros.map((x) => x.data);

console.log(`registros: ${dados.length}`);
console.log(`payload : ${(texto.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`média   : ${Math.round(texto.length / dados.length / 1024)} KB por registro\n`);

// Tamanho acumulado por campo.
const porCampo = {};
for (const g of dados) {
  for (const [k, v] of Object.entries(g)) {
    porCampo[k] = (porCampo[k] || 0) + String(v ?? '').length;
  }
}
console.log('=== TAMANHO POR CAMPO (KB, todos os registros somados) ===');
const ordenado = Object.entries(porCampo).sort((a, b) => b[1] - a[1]);
for (const [campo, bytes] of ordenado.slice(0, 8)) {
  console.log(`  ${campo.padEnd(20)} ${String(Math.round(bytes / 1024)).padStart(7)} KB`);
}

const total = Object.values(porCampo).reduce((a, b) => a + b, 0);
console.log(`  ${'(resto)'.padEnd(20)} ${String(Math.round((total - ordenado.slice(0, 8).reduce((a, [, b]) => a + b, 0)) / 1024)).padStart(7)} KB`);

// Os campos gigantes são base64?
console.log('\n=== OS CAMPOS GRANDES SÃO BASE64 (imagem embutida)? ===');
for (const [campo, bytes] of ordenado.slice(0, 3)) {
  const exemplo = dados.find((g) => String(g[campo] ?? '').length > 1000)?.[campo];
  const s = String(exemplo ?? '');
  const ehDataUrl = s.startsWith('data:image') || s.startsWith('data:application/pdf');
  const prefixo = s.slice(0, Math.min(40, s.length));
  console.log(`  ${campo.padEnd(20)} ${ehDataUrl ? 'SIM, data: URL embutida' : 'nao'}`);
  console.log(`      prefixo: ${prefixo}...`);
  console.log(`      registros com esse campo grande: ${dados.filter((g) => String(g[campo] ?? '').length > 1000).length}/${dados.length}`);
}

// Quanto fica se a lista puxar SÓ o que a tabela precisa desenhar.
const NECESSARIOS = ['id', 'date', 'description', 'amount', 'status', 'category_id', 'category_name',
  'payment_method', 'beneficiary_type', 'beneficiary_name', 'classification', 'cost_center_name',
  'responsible_user', 'has_proof', 'origin_type', 'origin_id'];
const enxuto = dados.map((g) => {
  const o = {};
  for (const k of NECESSARIOS) if (k in g) o[k] = g[k];
  return o;
});
console.log('\n=== QUANTO CUSTARIA SÓ COM OS CAMPOS QUE A TABELA USA ===');
console.log(`  hoje (select=*):        ${Math.round(texto.length / 1024)} KB`);
console.log(`  sem os campos base64:    ${Math.round(JSON.stringify(enxuto).length / 1024)} KB`);
console.log(`  >> ~${Math.round(texto.length / JSON.stringify(enxuto).length)}x menor`);
