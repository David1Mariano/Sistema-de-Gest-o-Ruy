// MEDIÇÃO (somente leitura). Decompõe a mediana de 2,9 s.
//
// A pergunta: o tempo é da FinancialExpense, da ExpenseCategory, do par em
// paralelo, ou de outra coisa? Cada uma é medida sozinha, depois o par, e
// depois as 15 — tudo contra o mesmo endpoint real.
//
// A/B intercalado e mínimo/mediana/max, porque a rede daqui é instável.

import { readFileSync } from 'node:fs';

const cfg = readFileSync('src/lib/cloudConfig.js', 'utf8');
const url = cfg.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)[1];
const key = cfg.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)[1];

const t0 = () => Number(process.hrtime.bigint() / 1000n) / 1000;

async function buscar(entity) {
  const r = await fetch(`${url}/rest/v1/records?entity=eq.${entity}&select=data,created_date,updated_date`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const texto = await r.text();
  let j = []; try { j = JSON.parse(texto); } catch { /* nao-json */ }
  return { n: Array.isArray(j) ? j.length : -1 };
}

const min = (v) => Math.min(...v);
const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

const RODADAS = 6;
const A = []; // FinancialExpense sozinha
const B = []; // ExpenseCategory sozinha
const C = []; // as duas em paralelo
const D = []; // as 15 (referência)

const todas = ['FinancialExpense', 'EmployeePayment', 'Employee', 'Vale', 'Consumption',
  'ExpenseCategory', 'CostCenter', 'AccountsPayable', 'FinancialAccount', 'RecurringExpense',
  'DailyFinancialClose', 'FechamentoCaixa', 'Sangria', 'CashMovement', 'Supplier'];

let nExpenses = -1;
let nCategorias = -1;

console.log(`=== DECOMPOSICAO DA CARGA (${RODADAS} rodadas, somente leitura) ===\n`);

for (let r = 1; r <= RODADAS; r += 1) {
  let i = t0();
  const e = await buscar('FinancialExpense');
  A.push(t0() - i);
  nExpenses = e.n;

  i = t0();
  const c = await buscar('ExpenseCategory');
  B.push(t0() - i);
  nCategorias = c.n;

  i = t0();
  await Promise.all([buscar('FinancialExpense'), buscar('ExpenseCategory')]);
  C.push(t0() - i);

  i = t0();
  await Promise.all(todas.map((x) => buscar(x)));
  D.push(t0() - i);

  process.stdout.write(`  rodada ${r}/${RODADAS}  expenses=${String(Math.round(A.at(-1))).padStart(5)}  categories=${String(Math.round(B.at(-1))).padStart(5)}  par=${String(Math.round(C.at(-1))).padStart(5)}  15=${String(Math.round(D.at(-1))).padStart(5)}\n`);
}

const linha = (nome, v) => console.log(`  ${nome.padEnd(34)} min ${String(Math.round(min(v))).padStart(5)}   med ${String(Math.round(med(v))).padStart(5)}   max ${String(Math.round(max(v))).padStart(5)}`);

console.log('\n=== RESULTADO (ms) ===\n');
linha('FinancialExpense sozinha', A);
linha('ExpenseCategory sozinha', B);
linha('as DUAS em paralelo (=fase 1)', C);
linha('as 15 em paralelo (antes)', D);

console.log('\n=== LEITURA ===\n');
console.log(`  FinancialExpense devolve ${nExpenses} registros; ExpenseCategory devolve ${nCategorias}.`);
console.log(`  O par em paralelo (${Math.round(med(C))} ms) custa quase o mesmo que a FinancialExpense sozinha`);
console.log(`  (${Math.round(med(A))} ms). Ou seja: a ExpenseCategory está sendo ESPERADA DE GRAÇA —`);
console.log(`  ela quase não acrescenta tempo, porque corre junto.`);
console.log(`\n  Separator categories da fase 1 renderia a lista em ~${Math.round(med(A))} ms`);
console.log(`  em vez de ~${Math.round(med(C))} ms: ganho de ${Math.round(med(C) - med(A))} ms.`);

function max(v) { return Math.max(...v); }
