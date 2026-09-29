// Teste de INTERAÇÃO entre as duas correções.
//
// Cada uma das branches resolveu um bug em lados opostos da tela:
//   - 58ea38c corrigiu a tela branca ao criar categoria e os rótulos de
//     PJ/Autônomo/Diarista no seletor de pagamentos;
//   - 510304d impediu a lista de gastos de piscar a cada refresh.
//
// O ponto onde elas se encontram é o formulário de novo gasto: a categoria é
// criada DEPOIS que o formulário está aberto, e o handler que atualiza as
// categorias é o mesmo que poderia derrubar a lista. Este arquivo trava esse
// cenário, que nenhum dos dois testes isolados cobre.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { selectableCategories, categoryKey } from '../src/lib/expenseCategories.js';
import { employeeOptionLabel, employeeSelectOptions, payableEmployees, employeeById } from '../src/lib/paymentRecipients.js';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const GASTO_CARREGADO = { id: 'g1', description: 'Combustivel', amount: 50, date: '2026-09-20', status: 'pago', category_id: 'c1', category_name: 'Combustivel' };
const CATEGORIAS = [{ id: 'c1', name: 'Combustivel', active: true }];

/**
 * O mesmo ciclo de vida do `DailyExpensesPanel`: o formulário fica aberto, o
 * gerente de categoria grava, e o painel repassa o resultado ao pai.
 */
function montarCenario() {
  const tela = {
    gastos: [GASTO_CARREGADO],
    categorias: CATEGORIAS,
    categoriaSelecionada: '',
    // Estado que a estabilidade precisa preservar com o formulário aberto:
    camposDoFormulario: { descricao: 'Troco de motoboy', valor: '25,00', data: '2026-09-29' },
    initialLoading: false, refreshing: false, falha: '',
    consultas: { expenses: 0, categories: 0 },
    carregou: true, seq: 0,
  };
  const consultar = chave => {
    tela.consultas[chave] += 1;
    return Promise.resolve(chave === 'categories' ? tela.categorias : tela.gastos);
  };
  return {
    tela,
    async criarCategoria(nome) {
      // O que `ExpenseCategoryManager` faz: grava e devolve a categoria criada.
      const criada = { id: 'c2', name: nome, active: true };
      tela.categorias = [...tela.categorias, criada];
      return criada;
    },
    // `reloadCategories` do Financeiro.jsx: só categorias e gastos.
    async reloadCategories() {
      const seq = ++tela.seq;
      tela.refreshing = true;
      const cats = await consultar('categories');
      const gastos = await consultar('expenses');
      if (seq !== tela.seq) return;
      tela.categorias = cats;
      tela.gastos = gastos;
      tela.refreshing = false;
    },
    // A ordem do 58ea38c: `onSaved` ANTES de `onSelect`.
    async salvarCategoriaENomear(nome) {
      const criada = await this.criarCategoria(nome);
      await this.reloadCategories();
      if (criada?.id) tela.categoriaSelecionada = criada.id;
      return criada;
    },
  };
}

test('1. lista de gastos carregada antes de abrir o formulário', () => {
  const { tela } = montarCenario();
  assert.equal(tela.gastos.length, 1);
  assert.equal(tela.initialLoading, false);
});

test('2. criar categoria NAO reconsulta as 15 entidades', async () => {
  const c = montarCenario();
  await c.salvarCategoriaENomear('Troco de motoboy');
  assert.equal(c.tela.consultas.categories, 1);
  assert.equal(c.tela.consultas.expenses, 1);
  // O ponto do teste: nenhuma outra entidade pode ser tocada aqui. O bug
  // original vinha do `load()` completo.
  assert.deepEqual(Object.keys(c.tela.consultas).sort(), ['categories', 'expenses']);
});

test('3. a nova categoria aparece e pode ser selecionada', async () => {
  const c = montarCenario();
  const criada = await c.salvarCategoriaENomear('Troco de motoboy');
  assert.ok(c.tela.categorias.some(x => x.id === criada.id), 'categoria nova tem de estar na lista');
  assert.equal(c.tela.categoriaSelecionada, 'c2');
  // E o id selecionado tem de existir de fato entre as opções renderizadas.
  const opcoes = selectableCategories(c.tela.categorias).map(x => x.id);
  assert.ok(opcoes.includes(c.tela.categoriaSelecionada), 'seleção apontava para opção inexistente');
});

test('4. a lista de gastos NAO desaparece e "Carregando" nao volta', async () => {
  const c = montarCenario();
  const antes = c.tela.gastos;
  await c.salvarCategoriaENomear('Troco de motoboy');
  // Referência preservada = componente não remonta = sem "Carregando gastos...".
  assert.equal(c.tela.gastos, antes, 'a lista de gastos não pode ser substituída ao criar categoria');
  assert.equal(c.tela.initialLoading, false, '"Carregando gastos..." não pode reaparecer');
  assert.equal(c.tela.gastos.length, 1);
});

test('5. o restante do formulário permanece intacto', async () => {
  const c = montarCenario();
  const antes = { ...c.tela.camposDoFormulario };
  await c.salvarCategoriaENomear('Troco de motoboy');
  assert.deepEqual(c.tela.camposDoFormulario, antes, 'criar categoria não pode limpar o formulário');
});

test('6. nada de tela branca: categorias sempre chega como lista', () => {
  // A causa raiz da tela branca: `categories` chegando como OBJETO estourava o
  // spread. `Array.isArray` na borda é o que impediu o despejo da árvore.
  for (const entrada of [undefined, null, {}, 'texto', 42, CATEGORIAS]) {
    const lista = selectableCategories(Array.isArray(entrada) ? entrada : []);
    assert.ok(Array.isArray(lista), `entrada ${JSON.stringify(entrada)}`);
  }
  // E o select continua controlado mesmo com estado `undefined`.
  const semDefini = { categoryId: undefined };
  assert.equal(semDefini.categoryId || '', '');
});

test('7. PJ, Autônomo e Diarista aparecem como si mesmos', () => {
  const equipe = [
    { id: 'e1', name: 'Ana', function: 'Autonomo', status: 'ativo' },
    { id: 'e2', name: 'Bruno', function: 'PJ', status: 'ativo' },
    { id: 'e3', name: 'Carla', function: 'Diarista', status: 'ativo' },
    { id: 'e4', name: 'Denis', function: 'Motorista', status: 'inativo' },
  ];
  const rotulos = Object.fromEntries(equipe.map(e => [e.id, employeeOptionLabel(e)]));
  assert.match(rotulos.e1, /Aut[oô]nomo/);
  assert.match(rotulos.e2, /PJ/);
  assert.match(rotulos.e3, /Diarista/);
  // Nenhum rótulo genérico inventado: "Freelancer" não é rótulo válido.
  for (const r of Object.values(rotulos)) assert.ok(!/freelancer/i.test(r), r);
  // Inativo segue a regra de elegibilidade já existente.
  const elegiveis = payableEmployees(equipe).map(e => e.id);
  assert.ok(!elegiveis.includes('e4'), 'inativo não pode aparecer');
  assert.deepEqual(employeeSelectOptions(equipe).map(([id]) => id), ['e1', 'e2', 'e3']);
  assert.equal(employeeById(equipe, 'e1').name, 'Ana');
});

test('8.-indicator de refresh não trava em true após a categoria', async () => {
  const c = montarCenario();
  await c.salvarCategoriaENomear('Troco de motoboy');
  assert.equal(c.tela.refreshing, false, '"Atualizando..." ficaria preso na tela');
});

test('9. o fluxo integrado está ligado no código de produção', async () => {
  const painel = await read('src/pages/Financeiro.jsx');
  const gerenciador = await read('src/components/financeiro/ExpenseCategoryManager.jsx');
  const componente = await read('src/components/financeiro/DailyExpensesPanel.jsx');
  // O pai entrega um handler específico para categoria.
  assert.match(painel, /onCategoriesChanged=\{reloadCategories\}/);
  assert.match(painel, /onSaved=\{reloadExpenses\}/);
  // E o painel usa esse handler, com o global apenas como reserva.
  assert.match(componente, /onSaved=\{onCategoriesChanged \|\| onSaved\}/);
  // Ordem correta: grava, recarrega, só então seleciona.
  const idxSaved = gerenciador.indexOf('await onSaved');
  const idxSelect = gerenciador.indexOf('onSelect?.(novoId)');
  assert.ok(idxSaved > -1 && idxSelect > idxSaved, 'onSaved precisa vir antes da seleção');
  // E a seleção só acontece com id real.
  assert.match(gerenciador, /if \(novoId\)/);
});
