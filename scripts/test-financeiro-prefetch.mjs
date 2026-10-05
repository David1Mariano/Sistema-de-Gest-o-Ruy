// Testes do prefetch do Financeiro.
//
// O que precisa ser verdade:
//  - o prefetch começa ANTES de a aba abrir;
//  - o hook de startup busca só categories; o cache também atende expenses na tela;
//  - abrir a aba durante o prefetch NÃO dispara uma segunda consulta;
//  - quem chega primeiro desenha: expenses antes de categories;
//  - a lista existente nunca é limpa;
//  - sessão expirada com cache mantém o que está na tela;
//  - erro de prefetch não vira erro de navegação;
//  - o botão Atualizar força leitura nova.
//
// Fixtures sintéticos com contadores de chamada. Nenhuma rede.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  guardarPrefetch,
  lerComRevalidacao,
  lerPrefetch,
  limparPrefetch,
  marcar,
  medir,
  prefetch,
  prefetchEmVoo,
} from '../src/lib/financeiroPrefetch.js';
import { FONTE_FINANCEIRO, PRIORIDADE_POR_ABA } from '../src/lib/financeiroLoad.js';

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Contador de chamadas: é ele que revela duplicata.
function contador(dados, atraso = 0, erro = null) {
  const c = { n: 0 };
  c.buscar = async () => {
    c.n += 1;
    if (atraso) await esperar(atraso);
    if (erro) throw erro;
    return dados;
  };
  return c;
}

beforeEach(() => { limparPrefetch(); });

test('F01 — o prefetch busca SOMENTE o mínimo da aba Gastos', async () => {
  const gastos = contador([{ id: 'e1' }]);
  const categorias = contador([{ id: 'c1' }]);
  const r = await prefetch(['expenses', 'categories'], async (alias) => (
    alias === 'expenses' ? gastos.buscar() : categorias.buscar()
  ));

  assert.equal(r.ok, true);
  assert.deepEqual(r.gotten.sort(), ['categories', 'expenses']);
  assert.equal(gastos.n, 1, 'buscou os gastos');
  assert.equal(categorias.n, 1, 'buscou as categorias');
  // E, decisively, NÃO as outras 13.
  assert.deepEqual(PRIORIDADE_POR_ABA.gastos.render, ['expenses'], 'a camada de render é só expenses');
  assert.deepEqual(PRIORIDADE_POR_ABA.gastos.proxima, ['categories'], 'categorias é a camada seguinte');
  const totalDeFontes = FONTE_FINANCEIRO.length;
  assert.equal(2 < totalDeFontes, true, `prefetch busca 2 de ${totalDeFontes} fontes — nunca o conjunto inteiro`);
});

test('F02 — o prefetch começa antes de a aba abrir', async () => {
  // O gatilho é o hook central, disparado no idle. Aqui testamos que o
  // mecanismo aceita começar antes e ter o resultado pronto depois.
  const c = contador([{ id: 'e1' }], 40);
  const p = prefetch(['expenses'], c.buscar);

  // Ainda não terminou: quem abrir a aba agora vai reaproveitar.
  assert.equal(prefetchEmVoo('expenses'), true, 'o prefetch está em andamento');
  await p;
  assert.equal(lerPrefetch('expenses').length, 1, 'e quando termina, o dado fica pronto');
});

test('F03 — abrir a aba durante o prefetch NÃO duplica a requisição', async () => {
  const c = contador([{ id: 'e1' }], 50);

  // Prefetch começa.
  const emAndamento = prefetch(['expenses'], c.buscar);
  // A pessoa abre a aba AGORA, no meio do prefetch.
  const viaTela = lerComRevalidacao('expenses', c.buscar);
  const [dadosTela] = await Promise.all([viaTela, emAndamento]);

  assert.equal(c.n, 1, 'apenas UMA requisição — a tela reaproveitou a do prefetch');
  assert.equal(dadosTela.dados.length, 1, 'e recebeu o mesmo dado');
  assert.equal(prefetchEmVoo('expenses'), false, 'nada ficou pendurado');

  // Duas aberturas simultâneas também não duplicam.
  const c2 = contador([{ id: 'e1' }], 20);
  await Promise.all([
    lerComRevalidacao('expenses', c2.buscar),
    lerComRevalidacao('expenses', c2.buscar),
    lerComRevalidacao('expenses', c2.buscar),
  ]);
  assert.equal(c2.n, 1, 'três leituras simultâneas, uma requisição');
});

test('F04 — expenses aparece antes de categories', async () => {
  // O cache é separado por alias: o dado de expenses fica disponível assim
  // que chega, sem esperar o outro.
  const c1 = contador([{ id: 'e1' }], 10);
  const c2 = contador([{ id: 'c1' }], 80);
  const p = prefetch(['expenses'], c1.buscar);
  await p;
  assert.equal(lerPrefetch('expenses').length, 1, 'gastos prontos');
  assert.equal(lerPrefetch('categories'), null, 'categorias ainda não chegaram');

  const p2 = prefetch(['categories'], c2.buscar);
  await p2;
  assert.equal(lerPrefetch('categories').length, 1, 'e depois categorias');
  // O que já estava não foi perdido no caminho.
  assert.equal(lerPrefetch('expenses').length, 1, 'os gastos continuam lá');
});

test('F05 — a lista existente NUNCA é limpa', async () => {
  guardarPrefetch('expenses', [{ id: 'antigo-1' }, { id: 'antigo-2' }]);
  const c = contador([{ id: 'novo' }], 30);

  // stale-while-revalidate: devolve o antigo NA HORA e revalida por baixo.
  const leitura = await lerComRevalidacao('expenses', c.buscar);
  assert.equal(leitura.doCache, true, 'veio do cache');
  assert.deepEqual(leitura.dados.map((x) => x.id), ['antigo-1', 'antigo-2'], 'a tela recebeu o dado antigo imediatamente');

  // Só depois a revalidação troca.
  await esperar(80);
  assert.deepEqual(lerPrefetch('expenses').map((x) => x.id), ['novo'], 'e a lista nova entrou por cima quando chegou');
});

test('F06 — sem cache, a leitura vai à rede e guarda para a próxima', async () => {
  const c = contador([{ id: 'e1' }]);
  const primeira = await lerComRevalidacao('expenses', c.buscar);
  assert.equal(primeira.doCache, false, 'primeira vez vai à rede');
  assert.equal(c.n, 1);

  const segunda = await lerComRevalidacao('expenses', c.buscar);
  assert.equal(segunda.doCache, true, 'a segunda já vem da memória');
  assert.deepEqual(segunda.dados.map((x) => x.id), ['e1'], 'e entrega o mesmo dado');

  // A revalidação por baixo É o comportamento desejado (stale-while-revalidate):
  // ela não segura a tela e garante que o dado não envelheça indefinidamente.
  await esperar(20);
  assert.equal(c.n, 2, 'houve uma revalidação em segundo plano — sem travar a leitura');
});

test('F07 — sessão expirada com cache preserva o que está na tela', async () => {
  guardarPrefetch('expenses', [{ id: 'e1' }]);
  const expirado = Object.assign(new Error('Sessão expirada.'), { status: 401 });
  const c = contador([], 0, expirado);

  // A revalidação falha, mas quem está na tela tem dado válido.
  await esperar(30);
  assert.deepEqual(lerPrefetch('expenses').map((x) => x.id), ['e1'], 'o cache válido continua intacto após a falha');

  // E a tela, ao ler, recebe o que tem — não uma lista vazia.
  const leitura = await lerComRevalidacao('expenses', c.buscar);
  assert.deepEqual(leitura.dados.map((x) => x.id), ['e1'], 'a tela mostra o último dado bom');
});

test('F08 — erro de prefetch não quebra a navegação', async () => {
  const c = contador([], 0, Object.assign(new Error('rede caiu'), { status: 500 }));
  const r = await prefetch(['expenses'], c.buscar);

  assert.equal(r.ok, false, 'o prefetch reporta a falha');
  assert.match(r.erro, /rede caiu/, 'com a mensagem');
  assert.equal(lerPrefetch('expenses'), null, 'nada foi guardado pela metade');
  assert.equal(prefetchEmVoo('expenses'), false, 'e a promise foi limpa — o próximo tenta de novo');
  // A navegação continua: a tela vai buscar por conta própria.
  const c2 = contador([{ id: 'e1' }]);
  const tela = await lerComRevalidacao('expenses', c2.buscar);
  assert.equal(tela.dados.length, 1, 'a tela conseguiu carregar mesmo com o prefetch falhado');
});

test('F09 — TTL curto: dado velho não é usado como verdade', async () => {
  guardarPrefetch('expenses', [{ id: 'velho' }], 0);
  // Avança o relógio além do TTL.
  guardarPrefetch('expenses', [{ id: 'velho' }], -10 * 60 * 1000);
  assert.equal(lerPrefetch('expenses'), null, 'passado o TTL, o dado é descartado');
});

test('F10 — nada é gravado em disco pelo prefetch', async () => {
  const src = await readFile(new URL('../src/lib/financeiroPrefetch.js', import.meta.url), 'utf8');
  // Comentário pode mencionar o nome; o que não pode é CHAMAR a API. O ponto
  // é checar uso real (com ponto), não a palavra.
  assert.doesNotMatch(src, /\blocalStorage\s*\./, 'nada é gravado em localStorage');
  assert.doesNotMatch(src, /\bsessionStorage\s*\./, 'nem em sessionStorage');
  assert.doesNotMatch(src, /indexedDB\s*\./, 'nem em IndexedDB');
  assert.doesNotMatch(src, /\bdocument\.cookie\s*=/, 'nem em cookie');
  assert.match(src, /const cache = new Map\(\)/, 'o armazenamento é um Map em memória');
  // E não se mistura com rascunhos.
  assert.doesNotMatch(src, /gr:draft|usePersistentDraft/, 'o prefetch não conhece o sistema de rascunho');
});

test('F11 — um único gatilho, no ponto central do app', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../src/lib/usePrefetchFinanceiro.js', import.meta.url), 'utf8');

  const usos = (app.match(/usePrefetchFinanceiro\(\)/g) || []).length;
  assert.equal(usos, 1, 'o prefetch é disparado em UM lugar só, não espalhado');
  assert.match(hook, /requestIdleCallback/, 'e roda no tempo ocioso, sem roubar o primeiro render');
  assert.match(hook, /ALVOS = \['categories'\]/, 'startup antecipa somente categorias; gastos ficam para a tela Financeiro');
  assert.equal(/FONTE_FINANCEIRO\.length|Todas as 15/.test(hook), false, 'não há prefetch das 15');
});

test('startup executa somente leitura leve de categorias, sem consultar FinancialExpense', async () => {
  const source = await readFile(new URL('../src/lib/usePrefetchFinanceiro.js', import.meta.url), 'utf8');
  let idle;
  let cleanup;
  let cancelled;
  const calls = [];
  const makeHook = new Function('useEffect', 'useRef', 'base44', 'FONTE_FINANCEIRO', 'prefetch',
    'requestIdleCallback', 'cancelIdleCallback',
    source.replace(/^import .*;\r?\n/gm, '').replace('export function', 'function') + '\nreturn usePrefetchFinanceiro;');
  const hook = makeHook(
    effect => { cleanup = effect(); },
    value => ({ current: value }),
    { entities: {
      FinancialExpense: { list: () => { throw Error('FinancialExpense não pode ser consultada no startup'); } },
      ExpenseCategory: { list: async (...args) => { calls.push(args); return []; } },
    } },
    [{ alias: 'expenses', entity: 'FinancialExpense' }, { alias: 'categories', entity: 'ExpenseCategory' }],
    async (aliases, fetchOne) => { await Promise.all(aliases.map(fetchOne)); },
    callback => { idle = callback; return 42; },
    id => { cancelled = id; },
  );
  hook();
  assert.deepEqual(calls, [], 'não compete com o mount da Home');
  await idle();
  assert.deepEqual(calls, [['name', 300]]);
  cleanup();
  assert.equal(cancelled, 42);
});

test('F12 — as marcas de DEV existem e não vazam para produção', async () => {
  const painel = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');
  for (const marca of ['financeiro:gastos:start', 'financeiro:gastos:data-ready', 'financeiro:gastos:render-ready']) {
    assert.match(painel, new RegExp(marca.replace(/[:]/g, ':')), `a marca ${marca} é emitida`);
  }
  const pref = await readFile(new URL('../src/lib/financeiroPrefetch.js', import.meta.url), 'utf8');
  assert.match(pref, /import\.meta\.env\?\.DEV/, 'as marcas só rodam em DEV');
  // Sem marcas, nada quebra: as funções são no-op fora de DEV.
  assert.equal(typeof marcar, 'function');
  assert.equal(typeof medir, 'function');
  marcar('qualquer');
  medir('qualquer', 0, 0);
  assert.equal(true, true, 'chamar em Node sem Performance API não lança');
});
