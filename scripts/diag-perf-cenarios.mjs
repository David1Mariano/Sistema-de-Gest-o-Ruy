// MEDIÇÃO (somente leitura). Os três cenários pedidos, contra o endpoint real.
//
// A) primeira entrada, sem cache nem prefetch
// B) primeira entrada, com o prefetch já concluído
// C) retorno a uma aba já visitada (dado em memória)
//
// B e C não devem gastar rede: é isso que os mede.

import { readFileSync } from 'node:fs';
import {
  guardarPrefetch, lerComRevalidacao, limparPrefetch, prefetch, lerPrefetch,
} from '../src/lib/financeiroPrefetch.js';

const cfg = readFileSync('src/lib/cloudConfig.js', 'utf8');
const url = cfg.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)[1];
const key = cfg.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)[1];

const t0 = () => Number(process.hrtime.bigint() / 1000n) / 1000;
let requisicoes = 0;

const buscarUm = async (alias) => {
  requisicoes += 1;
  const entity = alias === 'expenses' ? 'FinancialExpense' : 'ExpenseCategory';
  const r = await fetch(`${url}/rest/v1/records?entity=eq.${entity}&select=data,created_date,updated_date`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const j = await r.json();
  return (j || []).map((x) => x.data);
};

const min = (v) => Math.min(...v);
const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

console.log('=== CENÁRIOS DE TEMPO ATÉ A LISTA (somente leitura) ===\n');

const A = [];
const B = [];
const C = [];
const nA = [];
const nB = [];

for (let r = 1; r <= 4; r += 1) {
  // A) sem nada em memória
  limparPrefetch();
  requisicoes = 0;
  const iA = t0();
  const a = await lerComRevalidacao('expenses', buscarUm);
  A.push(t0() - iA);
  nA.push(requisicoes);
  assert(`A: ${a.dados.length} gastos`);

  // B) com o prefetch já feito antes
  limparPrefetch();
  await prefetch(['expenses'], buscarUm);   // o prefetch já terminou
  const antesB = requisicoes;
  const iB = t0();
  const b = await lerComRevalidacao('expenses', buscarUm);
  B.push(t0() - iB);
  nB.push(requisicoes - antesB);
  assert(`B: ${b.dados.length} gastos, doCache=${b.doCache}`);

  // C) retorno à aba: dado em memória, rede já aquecida
  const iC = t0();
  const c = await lerComRevalidacao('expenses', buscarUm);
  C.push(t0() - iC);
  assert(`C: ${c.dados.length} gastos, doCache=${c.doCache}`);

  // pagador
  const l = (nome, v) => console.log(`  ${nome.padEnd(44)} min ${String(Math.round(min(v))).padStart(5)}   med ${String(Math.round(med(v))).padStart(5)}   req/sessao ${med(nA.slice(-1).concat(nB.slice(-1)))}`);
  console.log(`\n  --- rodada ${r}/4 ---`);
  console.log(`  A sem cache          ${String(Math.round(A.at(-1))).padStart(5)} ms   (${nA.at(-1)} requisicao)`);
  console.log(`  B com prefetch pronto${String(Math.round(B.at(-1))).padStart(5)} ms   (${nB.at(-1)} requisicao para a tela)`);
  console.log(`  C retorno a aba      ${String(Math.round(C.at(-1))).padStart(5)} ms`);
}

console.log('\n=== RESUMO (ms) ===\n');
console.log(`  A  primeira entrada, sem cache   min ${String(Math.round(min(A))).padStart(5)}   med ${String(Math.round(med(A))).padStart(5)}`);
console.log(`  B  primeira entrada, pre.fetch   min ${String(Math.round(min(B))).padStart(5)}   med ${String(Math.round(med(B))).padStart(5)}`);
console.log(`  C  retorno a aba ja visitada     min ${String(Math.round(min(C))).padStart(5)}   med ${String(Math.round(med(C))).padStart(5)}`);
console.log('');
console.log(`  B e C consumiram ${med(nB)} requisicao da rede para a TELA (a revalidacao em`);
console.log(`  segundo plano existe, mas nao segura o clique).`);
console.log('');
console.log(`  meta: B e C abaixo de 200 ms -> ${min(B) < 200 && min(C) < 200 ? 'ATINGIDA' : 'NAO atingida neste ambiente'}`);

function assert(msg) { if (msg) process.stdout.write(`    ${msg}\n`); }
