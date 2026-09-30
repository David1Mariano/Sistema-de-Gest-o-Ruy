// MEDIÇÃO (somente leitura). A/B intercalado contra a rede real.
//
// A primeira versão mediu sequencialmente e o resultado foi ruido: a mesma
// chamada chegou a medir 400 ms e 2615 ms em rodadas diferentes. Aqui as
// rodadas de A e B sao intercaladas (ABABAB...), e o numero reportado e o
// MINIMO, que e a medida estavel de capacidade de rede. A mediana e a maxima
// sao mostradas para deixar o ruido visivel em vez de disfarca-lo.

import { readFileSync } from 'node:fs';
import { separarPorPrioridade, PRIORIDADE_POR_ABA, FONTE_FINANCEIRO } from '../src/lib/financeiroLoad.js';

const cfg = readFileSync('src/lib/cloudConfig.js', 'utf8');
const url = cfg.match(/VITE_SUPABASE_URL\s*\|\|\s*'([^']+)'/)[1];
const key = cfg.match(/VITE_SUPABASE_ANON_KEY\s*\|\|\s*'([^']+)'/)[1];

const t0 = () => Number(process.hrtime.bigint() / 1000n) / 1000;

const buscar = (entity) => async () => {
  const r = await fetch(`${url}/rest/v1/records?entity=eq.${entity}&select=data,created_date,updated_date`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const j = await r.json();
  return Array.isArray(j) ? j.map((x) => x.data) : [];
};

const fontes = () => FONTE_FINANCEIRO.map(({ alias, entity }) => ({ alias, entity, entidade: { list: buscar(entity) } }));
const min = (v) => Math.min(...v);
const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const max = (v) => Math.max(...v);

const RODADAS = 6;
const A = [];   // 15 em paralelo (antes)
const B = [];   // so a fase 1 (depois)

console.log(`=== A/B INTERCALADO, ${RODADAS} RODADAS (somente leitura) ===\n`);

for (let r = 1; r <= RODADAS; r += 1) {
  // A: as 15 de uma vez — o que a aba esperava antes.
  let i = t0();
  await Promise.all(fontes().map((f) => f.entidade.list()));
  A.push(t0() - i);

  // B: so o que a aba Gastos precisa desenhar.
  const { prioridade } = separarPorPrioridade(fontes(), 'gastos');
  i = t0();
  await Promise.all(prioridade.map((f) => f.entidade.list()));
  B.push(t0() - i);

  process.stdout.write(`  rodada ${r}/${RODADAS}  A=${String(Math.round(A.at(-1))).padStart(5)}ms  B=${String(Math.round(B.at(-1))).padStart(5)}ms\n`);
}

const fmt = (v) => `min ${String(Math.round(min(v))).padStart(5)}  med ${String(Math.round(med(v))).padStart(5)}  max ${String(Math.round(max(v))).padStart(5)}`;

console.log('\n=== RESULTADO (ms) ===\n');
console.log(`  ANTES  15 entidades em paralelo : ${fmt(A)}`);
console.log(`  DEPOIS fase 1 da aba Gastos    : ${fmt(B)}`);
console.log('');
console.log(`  primeira pintura: ${Math.round(med(A) - med(B))} ms mais rapida na mediana`);
console.log(`                    ${Math.round(min(A) - min(B))} ms mais rapida no melhor caso`);
console.log(`  ganho no melhor caso: ${(min(A) / min(B)).toFixed(1)}x`);
console.log(`\n  A fase 2 (13 entidades) roda depois, em segundo plano, sem travar a lista.`);

console.log('\n=== POR QUE A DIFERENCA E ESTRUTURAL, NAO SORTE ===');
console.log(`  A aba Gastos renderiza ${FONTE_FINANCEIRO.length} coleções; a lista de gastos usa 1 delas.`);
console.log(`  Antes ela pagava o tempo da mais lenta das 15. Agora paga o tempo das ${PRIORIDADE_POR_ABA.gastos.length} que ela usa:`);
console.log(`  ${PRIORIDADE_POR_ABA.gastos.join(', ')}`);
