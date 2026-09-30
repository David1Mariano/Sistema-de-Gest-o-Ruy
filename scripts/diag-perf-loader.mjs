// MEDIÇÃO (somente leitura). Reproduz o que o Financeiro faz hoje e mede o
// tempo real de cada etapa. Nenhuma escrita no banco.
//
// Mede três cenários:
//   A) as 15 em paralelo (o que o código faz hoje)
//   B) só a FinancialExpense sozinha
//   C) as 15 em paralelo, com uma delas atrasada de propósito (pior caso)

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

const buscar = (entity) => async () => {
  const r = await fetch(`${url}/rest/v1/records?entity=eq.${entity}&select=data,created_date,updated_date`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const j = await r.json();
  return (j || []).map((x) => x.data);
};

const t0 = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms com 3 casas

async function cenario(nome, executar) {
  const inicio = t0();
  const linhas = await executar();
  const fim = t0();
  console.log(`\n${nome}`);
  console.log(`  total: ${(fim - inicio).toFixed(0)} ms`);
  for (const l of linhas.sort((a, b) => b.ms - a.ms)) console.log(`    ${String(Math.round(l.ms)).padStart(5)} ms  ${l.nome}${l.n ? ` (${l.n} registros)` : ''}`);
  return fim - inicio;
}

console.log('=== MEDIÇÃO REAL DAS CHAMADAS DO FINANCEIRO ===');

// A) as 15 em paralelo — exatamente o que load() faz hoje
const A = await cenario('A) as 15 em paralelo (HOJE)', async () => {
  const marcas = FONTES.map(([, e]) => ({ nome: e, ini: t0() }));
  await Promise.all(FONTES.map(([, e]) => buscar(e)()));
  const fim = t0();
  return marcas.map((m) => ({ nome: m.nome, ms: fim - m.ini }));
});

// B) só a FinancialExpense
const B = await cenario('B) só FinancialExpense', async () => {
  const ini = t0();
  const dados = await buscar('FinancialExpense')();
  const fim = t0();
  return [{ nome: 'FinancialExpense', ms: fim - ini, n: dados.length }];
});

// C) uma entidade lenta, as outras não
const C = await cenario('C) 15 em paralelo, 1 atrasada 2s (pior caso)', async () => {
  const marcas = FONTES.map(([a, e]) => ({ nome: e, ini: t0() }));
  await Promise.all(FONTES.map(([a, e]) => (a === 'suppliers'
    ? (async () => { await new Promise((r) => { setTimeout(r, 2000); }); return []; })()
    : buscar(e)())));
  const fim = t0();
  return marcas.map((m) => ({ nome: m.nome, ms: fim - m.ini }));
});

console.log('\n=== CONCLUSÃO ===');
console.log(`  parallelo completo (A) .......... ${Math.round(A)} ms`);
console.log(`  so a FinancialExpense (B) ...... ${Math.round(B)} ms`);
console.log(`  pior caso: 1 entidade 2s (C) ... ${Math.round(C)} ms`);
console.log(`  => quem espera o loader completo perde ${Math.round(C - B)} ms so por causa das outras 14.`);
console.log(`\n  ALERTAS: ${A > 1000 ? 'SIM' : 'nao'} — o parallelo ja demora ${Math.round(A)} ms.`);

// D) retry: quanto custa o caminho de sessão expirada (PAUSA_ENTRE_TENTATIVAS_MS)
console.log('\n=== CUSTO DO RETRY DE SESSÃO (o que pode somar os ~5 s) ===');
for (const n of [1, 2]) {
  const inicio = t0();
  await new Promise((r) => { setTimeout(r, 1500); });
  const fim = t0();
  console.log(`  ${n}x pausa de 1,5s + nova carga = ${(fim - inicio).toFixed(0)} ms (so a pausa)`);
}
console.log('  MAX_TENTATIVAS=2 => até 2 pausas = 3000 ms de espera somadas ao tempo de carga.');
