// REPRODUÇÃO (read-only) — usa o client REAL do app, não um GET manual.
//
// Importa `createEntityClient` de src/lib/cloudDb.js, que é exatamente o que
// `base44.entities.<X>.list()` usa. Em Node não há sessão do Supabase, então
// `getAccessToken()` falha do mesmo jeito que falha no navegador quando o
// token não está disponível. Cada entity é executada isoladamente e mostra
// status + mensagem — é isso que a tela hoje aggregate e esconde.
//
// O import é DINÂMICO porque o alias `@/` só passa a resolver depois que o
// hook de `diag-alias-hook.mjs` é registrado.

import './diag-alias-hook.mjs';

const { createEntityClient } = await import('../src/lib/cloudDb.js');

// Mesma lista, mesma ordem e mesmos limites de Financeiro.jsx:90-104.
const FONTES = [
  ['expenses', 'FinancialExpense', '-date', 1000],
  ['payments', 'EmployeePayment', '-payment_date', 1000],
  ['employees', 'Employee', 'name', 500],
  ['vales', 'Vale', '-date', 1000],
  ['consumptions', 'Consumption', '-date', 1000],
  ['categories', 'ExpenseCategory', 'name', 300],
  ['centers', 'CostCenter', 'name', 300],
  ['payables', 'AccountsPayable', 'due_date', 1000],
  ['accounts', 'FinancialAccount', 'name', 200],
  ['recurrings', 'RecurringExpense', 'next_due_date', 300],
  ['closes', 'DailyFinancialClose', '-date', 300],
  ['fechamentosCaixa', 'FechamentoCaixa', '-date', 1000],
  ['sangrias', 'Sangria', '-date', 1000],
  ['cashMovements', 'CashMovement', '-date', 1500],
  ['suppliers', 'Supplier', 'name', 500],
];

const safe = async (p) => {
  try { return { ok: true, value: await p }; } catch (e) {
    return { ok: false, status: e?.status ?? null, msg: e?.message ?? String(e) };
  }
};

console.log('=== EXECUTANDO O LOADER REAL DO FINANCEIRO, ENTITY POR ENTITY ===\n');
const p = FONTES.map(([, entity, sort, limit]) =>
  safe(createEntityClient(entity).list(sort, limit)));

const resultados = await Promise.all(p);
const falhas = [];
for (let i = 0; i < FONTES.length; i += 1) {
  const [alias, entity] = FONTES[i];
  const r = resultados[i];
  if (r.ok) console.log(`  ${alias.padEnd(18)} ${entity.padEnd(20)} OK      ${r.value.length} registros`);
  else {
    falhas.push(alias);
    console.log(`  ${alias.padEnd(18)} ${entity.padEnd(20)} ERRO    status=${r.status}  ${r.msg.slice(0, 90)}`);
  }
}

console.log('\n=== O QUE A TELHA MOSTRA HOJE (Financeiro.jsx:114) ===');
console.log(`  Não foi possível atualizar: ${falhas.join(', ')}. Exibindo os últimos dados carregados.`);
console.log(`  -> ${falhas.length}/${FONTES.length} entities falharam.`);
console.log('  -> A mensagemaggregate ALIASES. Ela NÃO diz status, NÃO diz a causa');
console.log('     e NÃO diz que nenhuma requisição chegou ao banco.');

const unicas = [...new Set(resultados.filter((r) => !r.ok).map((r) => r.msg))];
console.log('\n=== CAUSA COMUM (mensagens distintas entre as 15) ===');
unicas.forEach((m) => console.log(`  - ${m.slice(0, 140)}`));
console.log(unicas.length === 1
  ? '\n  => 1 causa para 15 entities: é o cabeçalho compartilhado (getAccessToken), não 15 falhas independentes.'
  : '\n  => mais de uma causa; os detalhes acima separaram.');

// `createEntityClient` liga um `setInterval` de 20s (cloudDb.startPolling) e o
// SDK do Supabase mantém timers próprios. Sem saída explícita o processo nunca
// termina — isso é comportamento normal do módulo, não do diagnóstico.
process.exit(0);
