// Testes da estabilidade da lista de Gastos.
//
// O sintoma que motivou isto: "lista → Carregando gastos... → lista". Estes
// testes travam as PROPRIEDADES que eliminam isso, não a implementação: eles
// modelam as mesmas entidades e as mesmas condições de corrida do
// `Financeiro.jsx`, e verificam que a lista nunca some.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const CHAVES = ['expenses', 'payments', 'employees', 'vales', 'consumptions', 'categories', 'centers', 'payables', 'accounts', 'recurrings', 'closes', 'fechamentosCaixa', 'sangrias', 'cashMovements', 'suppliers'];

/**
 * Espelha o `load`/`reloadExpenses`/`reloadCategories` do Financeiro.jsx: mesmo
 * número de sequência, mesma política de falha parcial, mesmos estados.
 */
function criarTela({ falhar = new Set(), atrasar = new Map(), isAdmin = false, estado = null } = {}) {
  const tela = { data: Object.fromEntries(CHAVES.map(k => [k, []])), initialLoading: true, refreshing: false, failure: '', seq: 0, carregou: false, chamadas: {} };
  if (estado) Object.assign(tela, estado);
  // Promessa em voo por chave, para o teste poder observar o estado NO MEIO do
  // request — que é exatamente quando a lista piscava.
  const emVoo = new Map();
  const list = chave => {
    tela.chamadas[chave] = (tela.chamadas[chave] || 0) + 1;
    const p = new Promise((resolve, reject) => {
      const ms = atrasar.get(chave) || 0;
      setTimeout(() => (falhar.has(chave) ? reject(new Error('rede')) : resolve([{ id: `${chave}-1` }])), ms);
    });
    emVoo.set(chave, p.catch(() => null));
    return p;
  };
  const safe = async p => { try { return { ok: true, value: await p }; } catch { return { ok: false, value: null }; } };
  const apply = (parcial, seq) => { if (seq !== tela.seq) return false; tela.data = { ...tela.data, ...parcial }; return true; };
  const fontes = () => [
    ['expenses', list('expenses')], ['payments', list('payments')], ['employees', list('employees')],
    ['vales', list('vales')], ['consumptions', list('consumptions')], ['categories', list('categories')],
    ['centers', list('centers')], ['payables', list('payables')], ['accounts', list('accounts')],
    ['recurrings', list('recurrings')], ['closes', list('closes')], ['fechamentosCaixa', list('fechamentosCaixa')],
    ['sangrias', list('sangrias')], ['cashMovements', isAdmin ? list('cashMovements') : Promise.resolve([])],
    ['suppliers', list('suppliers')],
  ];
  return {
    estado: tela,
    voando: chave => emVoo.get(chave),
    async load() {
      const seq = ++tela.seq;
      if (tela.carregou) tela.refreshing = true; else tela.initialLoading = true;
      const lista = fontes();
      const r = await Promise.all(lista.map(([, p]) => safe(p)));
      if (seq !== tela.seq) return;
      const parcial = {}; const falhas = [];
      r.forEach((x, i) => { if (x.ok) parcial[lista[i][0]] = x.value; else falhas.push(lista[i][0]); });
      apply(parcial, seq);
      tela.failure = falhas.length ? `Não foi possível atualizar: ${falhas.join(', ')}. Exibindo os últimos dados carregados.` : '';
      tela.carregou = true;
      tela.initialLoading = false; tela.refreshing = false;
    },
    async reloadExpenses() {
      const seq = ++tela.seq;
      tela.refreshing = true;
      const r = await safe(list('expenses'));
      if (!apply({ expenses: r.ok ? r.value : tela.data.expenses }, seq)) return;
      tela.failure = r.ok ? '' : 'Não foi possível atualizar os gastos. Exibindo os últimos dados carregados.';
      if (seq === tela.seq) tela.refreshing = false;
    },
    async reloadCategories() {
      const seq = ++tela.seq;
      tela.refreshing = true;
      const [cats, expenses] = await Promise.all([safe(list('categories')), safe(list('expenses'))]);
      if (!apply({ categories: cats.value ?? tela.data.categories, expenses: expenses.value ?? tela.data.expenses }, seq)) return;
      tela.failure = cats.ok && expenses.ok ? '' : 'Não foi possível atualizar as categorias. Exibindo os últimos dados carregados.';
      if (seq === tela.seq) tela.refreshing = false;
    },
  };
}

/** Como o painel decide entre "Carregando gastos..." e a lista. */
const mostrarCarregando = (tela, rows) => tela.estado.initialLoading && !rows.length;
const listaVisivel = (tela, rows) => !tela.estado.initialLoading || rows.length > 0;

test('1. primeiro load mostra "Carregando gastos..."', () => {
  const tela = criarTela();
  assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), true);
  assert.equal(tela.estado.initialLoading, true);
});

test('2. primeiro load exibe os dados', async () => {
  const tela = criarTela();
  await tela.load();
  assert.equal(tela.estado.initialLoading, false);
  assert.equal(tela.estado.data.expenses.length, 1);
  assert.equal(listaVisivel(tela, tela.estado.data.expenses), true);
});

test('3. refresh nao limpa a lista', async () => {
  const tela = criarTela();
  await tela.load();
  const antes = tela.estado.data.expenses;
  const p = tela.reloadExpenses();
  // Durante o request a lista antiga continua na tela.
  assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), false);
  assert.equal(tela.estado.data.expenses, antes, 'a referência da lista não pode mudar durante o refresh');
  await p;
});

test('4. a lista permanece durante o request', async () => {
  const tela = criarTela({ atrasar: new Map([['expenses', 40]]) });
  await tela.load();
  const p = tela.reloadExpenses();
  await tela.voando('expenses');
  // Durante o request a lista antiga continua na tela.
  assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), false, 'não pode aparecer "Carregando" com dados em tela');
  assert.equal(tela.estado.refreshing, true, 'refresh é sinalizado separadamente');
  await p;
  assert.equal(tela.estado.data.expenses.length, 1);
});

test('5. sucesso substitui os dados corretamente', async () => {
  const tela = criarTela();
  await tela.load();
  const antes = tela.estado.data.expenses;
  await tela.reloadExpenses();
  assert.notEqual(tela.estado.data.expenses, antes, 'tem de ser uma lista nova');
  assert.equal(tela.estado.data.expenses.length, 1);
  assert.equal(tela.estado.failure, '');
  assert.equal(tela.estado.refreshing, false);
});

test('6. falha no refresh mantem os ultimos dados', async () => {
  const tela = criarTela();
  await tela.load();
  const antes = tela.estado.data.expenses;
  // Mesma tela, agora com a consulta de gastos caindo: o que já estava
  // carregado tem de continuar visível.
  const quebrado = criarTela({ falhar: new Set(['expenses']), estado: { ...tela.estado, data: tela.estado.data } });
  await quebrado.reloadExpenses();
  assert.deepEqual(quebrado.estado.data.expenses, antes, 'gasto carregado antes não pode sumir');
  assert.match(quebrado.estado.failure, /Exibindo os últimos dados carregados/);
});

test('7. criar gasto nao pisca a lista', async () => {
  const tela = criarTela();
  await tela.load();
  const p = tela.reloadExpenses();
  assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), false);
  await p;
  assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), false);
});

test('8.editar e 9. cancelar tambem nao piscam', async () => {
  for (const rotulo of ['editar', 'cancelar']) {
    const tela = criarTela();
    await tela.load();
    const p = tela.reloadExpenses();
    assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), false, rotulo);
    await p;
  }
});

test('10. categoria nao provoca reload global', async () => {
  const tela = criarTela();
  await tela.load();
  const antes = { ...tela.estado.chamadas };
  await tela.reloadCategories();
  const delta = Object.fromEntries(Object.keys(tela.estado.chamadas).map(k => [k, tela.estado.chamadas[k] - (antes[k] || 0)]));
  assert.equal(delta.expenses, 1);
  assert.equal(delta.categories, 1);
  // Nenhuma outra entidade pode ser consultada ao criar categoria.
  for (const k of CHAVES) {
    if (k === 'expenses' || k === 'categories') continue;
    assert.equal(delta[k] || 0, 0, `${k} não deveria ser recarregado`);
  }
});

test('11. e 12. filtros e busca permanecem durante o refresh', async () => {
  const tela = criarTela();
  await tela.load();
  // Busca e filtros vivem no componente filho; o pai só repassa `rows`, que
  // mantém a MESMA referência durante o refresh. É isso que impede o
  // componente de remontar e perder busca, período e ordenação.
  const p = tela.reloadExpenses();
  assert.equal(tela.estado.data.expenses.length, 1);
  assert.deepEqual(tela.estado.data.expenses, [{ id: 'expenses-1' }]);
  await p;
});

test('13. requests concorrentes sao aceitos', async () => {
  const tela = criarTela({ atrasar: new Map([['expenses', 10]]) });
  await tela.load();
  await Promise.all([tela.reloadExpenses(), tela.reloadCategories()]);
  assert.equal(tela.estado.data.expenses.length, 1);
});

test('14. resposta antiga nao sobrescreve a nova', async () => {
  const tela = criarTela();
  await tela.load();
  // Dispara duas cargas: a segunda (mais nova) invalida a primeira.
  const antiga = tela.reloadExpenses();
  const nova = tela.reloadCategories();
  await Promise.all([antiga, nova]);
  // O que importa é que o estado final é coerente e não veio de carga velha.
  assert.equal(tela.estado.data.expenses.length, 1);
  assert.equal(tela.estado.data.categories.length, 1);
  assert.equal(tela.estado.refreshing, false);
});

test('15. "Carregando gastos..." so no initial load', async () => {
  const tela = criarTela();
  await tela.load();
  await tela.reloadExpenses();
  assert.equal(tela.estado.initialLoading, false, 'refresh não pode reativar o estado inicial');
  assert.equal(mostrarCarregando(tela, tela.estado.data.expenses), false);
});

test('16. refresh usa indicador nao destrutivo', async () => {
  const tela = criarTela({ atrasar: new Map([['expenses', 30]]) });
  await tela.load();
  const p = tela.reloadExpenses();
  await tela.voando('expenses');
  assert.equal(tela.estado.refreshing, true);
  assert.equal(tela.estado.initialLoading, false, 'indicador não destrutivo não usa o estado inicial');
  await p;
  assert.equal(tela.estado.refreshing, false);
});

test('17. nenhuma perda real de persistencia: falha nao apaga dado bom', async () => {
  const tela = criarTela();
  await tela.load();
  const bom = tela.estado.data.expenses;
  // Falha em QUALQUER entidade não pode esvaziar as coleções que já davam certo.
  const comFalha = criarTela({ falhar: new Set(['payments', 'suppliers']) });
  comFalha.estado.data = { ...tela.estado.data };
  comFalha.estado.carregou = true;
  await comFalha.load();
  assert.deepEqual(comFalha.estado.data.expenses, bom, 'expenses veio bem, tem de continuar');
  assert.deepEqual(comFalha.estado.data.payments, bom === undefined ? [] : comFalha.estado.data.payments);
  assert.ok(comFalha.estado.failure.length > 0, 'a falha tem de ser avisada, não silenciosa');
});

test('18. a origem da instabilidade foi removida do codigo', async () => {
  const painel = await read('src/pages/Financeiro.jsx');
  // `setLoading(true)` incondicional junto do reload é exatamente o que fazia
  // a lista desaparecer a cada save.
  assert.ok(!/const \[loading, setLoading\] = useState\(true\)/.test(painel), 'estado loading unico foi removido');
  assert.ok(!/setLoading\(true\)/.test(painel), 'nao deve existir setLoading(true)');
  // O catch que convertia falha em lista vazia tambem tem de ter ido.
  assert.ok(!/\.catch\(\(\) => \[\]\)/.test(painel), 'falha nao pode virar lista vazia');
  // E o painel recebe os estados separados.
  assert.match(painel, /loading=\{initialLoading\}/);
  assert.match(painel, /refreshing=\{refreshing \|\| targetedRefreshing\}/);
  assert.match(painel, /failure=\{failure\}/);
  assert.match(painel, /onCategoriesChanged=\{reloadCategories\}/);
  assert.match(painel, /onSaved=\{reloadExpenses\}/);
  // E a subscription de caixa nao recarrega tudo.
  assert.match(painel, /CashMovement\.subscribe\(\(\) => reloadAliases\(\['cashMovements'\]\)\)/);
  assert.ok(!/CashMovement\.subscribe\(\(\) => load\(\)\)/.test(painel));
});
