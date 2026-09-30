// MEDIÇÃO (somente leitura). Caracteriza o custo conforme o número de
// requisições simultâneas, que é o que define quanto tempo o loader completo
// leva a segurar a aba Gastos.

import { readFileSync } from 'node:fs';

const cfg = readFileSync('src/lib/cloudConfig.js', 'utf8');
const url = cfg.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)[1];
const key = cfg.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)[1];

const FONTES = [
  ['expenses', 'FinancialExpense'], ['payments', 'EmployeePayment'],
  ['employees', 'Employee'], ['vales', 'Vale'], ['consumptions', 'Consumption'],
  ['categories', 'ExpenseCategory'], ['centers', 'CostCenter'],
  ['payables', 'AccountsPayable'], ['accounts', 'FinancialAccount'],
  ['recurrings', 'RecurringExpense'], ['closes', 'DailyFinancialClose'],
  ['fechamentosCaixa', 'FechamentoCaixa'], ['sangrias', 'Sangria'],
  ['cashMovements', 'CashMovement'], ['suppliers', 'Supplier'],
];

const t0 = () => Number(process.hrtime.bigint() / 1000n) / 1000;

async function uma(entity) {
  const r = await fetch(`${url}/rest/v1/records?entity=eq.${entity}&select=data,created_date,updated_date`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const j = await r.json();
  return { n: Array.isArray(j) ? j.length : -1 };
}

async function lote(n) {
  const ini = t0();
  const res = await Promise.all(FONTES.slice(0, n).map(([, e]) => uma(e)));
  return { ms: t0() - ini, n: res };
}

console.log('=== CUSTO x NUMERO DE REQUISIÇÕES SIMULTÂNEIS ===\n');
console.log('  fontes   tempo    custo por fonte');
const pontos = [1, 2, 4, 6, 8, 12, 15];
let anterior = null;
for (const n of pontos) {
  const { ms } = await lote(n);
  const porFonte = ms / n;
  const delta = anterior ? `  (+${Math.round(ms - anterior)} ms)` : '';
  console.log(`  ${String(n).padStart(2)}      ${String(Math.round(ms)).padStart(5)} ms   ${porFonte.toFixed(0).padStart(4)} ms${delta}`);
  anterior = ms;
  await new Promise((r) => { setTimeout(r, 400); });
}

console.log('\n=== CONCLUSÃO ===');
const um = await lote(1);
const quinze = await lote(15);
console.log(`  1 fonte  = ${Math.round(um.ms)} ms`);
console.log(`  15 fontes = ${Math.round(quinze.ms)} ms`);
console.log(`  as 14 extras custam ${Math.round(quinze.ms - um.ms)} ms de espera para a aba Gastos`);
console.log(`  a aba Gastos nao precisa de nada além da 1ª.`);
