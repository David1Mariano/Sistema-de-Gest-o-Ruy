// READ-ONLY. Tabela OBRIGATÓRIA: os 23 FinancialExpense reais, passando pelo
// MESMO pipeline da tela (resolveExpensePeriod + filterExpenses), com os
// MESMOS estados iniciais do DailyExpensesPanel.
//
// Nada é escrito, criado, alterado ou excluído. É só leitura + cálculo.

import { readFileSync } from 'node:fs';
import { filterExpenses, resolveExpensePeriod, dailyExpenseIndicators } from '../src/lib/dailyExpenses.js';

const cfg = readFileSync('src/lib/cloudConfig.js', 'utf8');
const url = cfg.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)[1];
const key = cfg.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)[1];

// Mesma consulta que fetchEntityRows() faz (cloudDb.js:58).
const r = await fetch(`${url}/rest/v1/records?entity=eq.FinancialExpense&select=data,created_date,updated_date`, {
  method: 'GET',
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const rows = (await r.json()).map((x) => x.data);

const linha = (etapa, n) => console.log(`  ${etapa.padEnd(46)} ${String(n).padStart(3)}`);

console.log('=== TABELA: DO BANCO ATÉ A TELA ===\n');
linha('FinancialExpense no banco', rows.length);
linha('fetchEntityRows() -> state expenses', rows.length);
linha('load() -> parcial.expenses', rows.length);

// Estado inicial REAL do DailyExpensesPanel (linhas 196-206).
const inicial = {
  search: '', preset: 'mes', customStart: '', customEnd: '',
  categoryId: '', paymentMethod: '', beneficiary: '', status: '', proof: '',
  view: 'painel',
};

const periodo = resolveExpensePeriod(inicial.preset, { start: inicial.customStart, end: inicial.customEnd });
console.log(`\n  periodo inicial (preset='${inicial.preset}') = ${periodo.start} .. ${periodo.end}`);

const periodoRows = filterExpenses(rows, { start: periodo.start, end: periodo.end });
linha('após período (mes)', periodoRows.length);

const comCategoria = filterExpenses(rows, { start: periodo.start, end: periodo.end, categoryId: '' });
linha('após categoria (vazio = sem filtro)', comCategoria.length);

const comBusca = filterExpenses(rows, {
  start: periodo.start, end: periodo.end, categoryId: '', search: '',
});
linha('após busca (vazia = sem filtro)', comBusca.length);

const visible = filterExpenses(rows, {
  ...inicial, start: periodo.start, end: periodo.end, includeCancelled: false,
});
linha('visible (o que a tabela do painel recebe)', visible.length);

linha('renderizado (mesma lista, linha por linha)', visible.length);

console.log('\n=== CADA PRESET ===');
for (const preset of ['hoje', 'semana', 'mes', 'todos']) {
  const p = resolveExpensePeriod(preset, { start: '', end: '' });
  const n = filterExpenses(rows, { start: p.start, end: p.end }).length;
  console.log(`  ${preset.padEnd(10)} ${String(p.start || '(sem inicio)').padEnd(12)} .. ${String(p.end || '(sem fim)').padEnd(12)} -> ${n} de 23`);
}

const pCustom = resolveExpensePeriod('personalizado', { start: '', end: '' });
console.log(`  ${'personalizado'.padEnd(10)} ${String(pCustom.start || '(vazio)').padEnd(12)} .. ${String(pCustom.end || '(vazio)').padEnd(12)} -> ${filterExpenses(rows, { start: pCustom.start, end: pCustom.end }).length} de 23`);

console.log('\n=== FILTRO DE CATEGORIA (22 de 23 nao tem categoria) ===');
for (const cat of ['', 'id_mun11d9k_65rrrno7', 'categoria-inexistente']) {
  const n = filterExpenses(rows, { start: periodo.start, end: periodo.end, categoryId: cat }).length;
  console.log(`  categoryId=${(cat || '(vazio)').padEnd(24)} -> ${n} de 23`);
}

console.log('\n=== INDICADORES (dailyExpenseIndicators, sobre rows) ===');
const ind = dailyExpenseIndicators(rows);
console.log(`  todayTotal=${ind.todayTotal}  todayCount=${ind.todayCount}`);
console.log(`  monthTotal=${ind.monthTotal}  monthCount=${ind.monthCount}`);
console.log(`  totalCount=${ind.totalCount}    totalSum=${ind.totalSum}`);
console.log('  (hojeCount=0 e todayTotal=0 sao ESPERADOS: nenhum gasto em 29/09)');

console.log('\n=== TIMEZONE: o filtro quebra data? ===');
for (const d of ['2026-09-21', '2026-09-22']) {
  const dentro = filterExpenses(rows, { start: periodo.start, end: periodo.end }).some((x) => x.date === d);
  console.log(`  ${d}: continua no período = ${dentro}`);
}
console.log('  (inRange compara string; nenhum Date é criado, então não há virada de dia)');
