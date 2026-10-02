// Prefetch do Financeiro.
//
// Objetivo: quando a pessoa clica em "Gastos", os lançamentos já devem estar
// na memória. A consulta em si leva segundos (medido); o que não pode levar
// é o clique.
//
// Decisões:
//  - SÓ memória do aplicativo. Nada em localStorage nem sessionStorage: uma
//    segunda cópia dos dados do sistema no disco do navegador seria uma
//    fonte desatualizada esperando alguém confiar nela.
//  - Só o necessário: as duas fontes da aba Gastos. Nunca as 15.
//  - Deduplicado: um prefetch em andamento é a MESMA promise. Abrir a aba
//    durante o prefetch reaproveita, não dispara uma segunda consulta.
//  - Falha é silenciosa e descartável: erro de prefetch não pode virar erro de
//    navegação.

const TTL_MS = 5 * 60 * 1000; // 5 min. Passado isso, revalida sem perguntar.

const cache = new Map();   // alias -> { dados, em }
const emVoo = new Map();   // alias -> Promise
const revisions = new Map();

const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** O que está guardado, se ainda for fresco. */
export function lerPrefetch(alias, referencia = agora()) {
  const entrada = cache.get(alias);
  if (!entrada) return null;
  if (referencia - entrada.em > TTL_MS) {
    cache.delete(alias);
    return null;
  }
  return entrada.dados;
}

/** Há consulta em andamento para este alias? */
export const prefetchEmVoo = (alias) => emVoo.has(alias);

/** Guarda o resultado. Chamado tanto pelo prefetch quanto pela carga normal. */
export function guardarPrefetch(alias, dados, referencia = agora()) {
  revisions.set(alias, (revisions.get(alias) || 0) + 1);
  cache.set(alias, { dados, em: referencia });
  return dados;
}

export function limparPrefetch() {
  cache.clear();
  emVoo.clear();
}

/**
 * Busca e guarda. Deduplicado por alias: duas chamadas simultâneas recebem a
 * MESMA promise, e portanto a MESMA requisição.
 *
 * @param {string[]} aliases
 * @param {(alias:string)=>Promise<Array>} buscarUm
 * @returns {Promise<{ok:boolean, gotten:string[], erro?:string}>}
 */
export async function prefetch(aliases, buscarUm) {
  // O que já está fresco ou em voo não é buscado de novo.
  const aFazer = aliases.filter((a) => lerPrefetch(a) === null && !emVoo.has(a));
  if (!aFazer.length) return { ok: true, gotten: aliases };

  const resultados = await Promise.allSettled(aFazer.map((a) => buscarDeduplicado(a, buscarUm)));
  const feitos = aFazer.filter((_, i) => resultados[i].status === 'fulfilled');
  const erros = resultados.filter((r) => r.status === 'rejected');
  return {
    ok: erros.length === 0,
    gotten: feitos,
    erro: erros[0]?.reason?.message || String(erros[0]?.reason ?? ''),
  };
}

/**
 * Busca com deduplicação. Se já existe uma em curso para este alias, devolve
 * a MESMA promise — sem segunda requisição.
 *
 * Isto vale para o prefetch E para a leitura da tela. Se valesse só para o
 * prefetch, abrir a aba no meio dele dispararia uma segunda consulta, que é
 * exatamente o que se quer evitar.
 */
export function buscarDeduplicado(alias, buscarUm) {
  return emVoo.get(alias) || iniciar(alias, buscarUm);
}

function iniciar(alias, buscarUm) {
  const revision = revisions.get(alias);
  const p = (async () => {
    try {
      const dados = await buscarUm(alias);
      // A selective refresh may have delivered newer data while this read
      // was in flight. Do not restore its older snapshot in the cache.
      if (revisions.get(alias) === revision) guardarPrefetch(alias, dados);
      return dados;
    } finally {
      emVoo.delete(alias);
    }
  })();
  emVoo.set(alias, p);
  // A promise guardada rejeita quando a busca falha. Deixá-la rejeitada sem
  // consumo derrubaria um unhandledRejection; quem precisar do erro usa a
  // promise que recebeu, e a próxima leitura tenta de novo.
  p.catch(() => {});
  return p;
}

/**
 * Stale-while-revalidate para a carga normal.
 *
 * Se há dado guardado, devolve na hora e dispara a revalidação por baixo. A
 * tela NUNCA fica em vazio -> spinner -> dado: ela mostra o que tem e troca
 * quando o novo chega.
 *
 * Se NÃO há dado guardado mas já existe uma busca em curso, espera aquela em
 * vez de disparar outra.
 *
 * @returns {Promise<{dados:Array, doCache:boolean}>}
 */
export async function lerComRevalidacao(alias, buscarUm) {
  const guardado = lerPrefetch(alias);
  if (guardado === null) {
    const dados = await buscarDeduplicado(alias, buscarUm);
    return { dados, doCache: false };
  }
  // Revalida sem esperar. `buscarDeduplicado` garante que, se já houver uma em
  // curso, ela seja reaproveitada em vez de duplicada.
  const revalidacao = buscarDeduplicado(alias, buscarUm);
  return { dados: guardado, doCache: true, revalidacao };
}

// --- Marcas de desempenho (só em DEV) ---------------------------------------
// O objetivo é conseguir medir no DevTools:
//   financeiro:gastos:start  -> financeiro:gastos:data-ready
//                            -> financeiro:gastos:render-ready
const podeMarcar = () => typeof performance !== 'undefined' && typeof performance.mark === 'function';

export function marcar(nome) {
  if (!podeMarcar() || !import.meta.env?.DEV) return;
  try { performance.mark(nome); } catch { /* ambiente sem Performance API */ }
}

export function medir(nome, inicio, fim) {
  if (!podeMarcar() || !import.meta.env?.DEV) return;
  try {
    performance.measure(nome, inicio, fim);
  } catch { /* uma marca pode faltar; a medicao e acessoria */ }
}
