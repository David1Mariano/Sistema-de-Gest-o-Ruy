// Teste integrado: DRAFT + CRIAÇÃO DE CATEGORIA + REFRESH.
//
// Este é o ponto onde as duas frentes se cruzam, e foi exatamente aqui que o
// rascunho podia ter regredido uma correção financeira.
//
// O que a tela precisa garantir, ao mesmo tempo:
//   - a lista de gastos NÃO desaparece quando uma categoria é criada
//     (`reloadCategories` é uma releitura parcial, não um `load()` global);
//   - o formulário de Novo Gasto ABERTO não perde o que já foi digitado
//     (é aqui que entra o rascunho);
//   - a categoria nova passa a ser selecionável;
//   - `initialLoading` não volta a `true` e a lista não mostra
//     "Carregando gastos..." outra vez.
//
// Sem jsdom no projeto, o comportamento é modelado em processo com a mesma
// máquina de estados que a tela usa (`initialLoading`/`refreshing`/`seqRef`/
// `apply`/`safe`, de `src/pages/Financeiro.jsx`) e a sessão de rascunho real
// (`createDraftSession`, a mesma que o hook React embrulha). A LIGAÇÃO com os
// arquivos reais é conferida por leitura de fonte, como nas demais suítes.
//
// Fixtures sintéticos. Nenhum dado real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createDraftSession, resolveUserKey } from '../src/lib/draftStore.js';
import { DRAFT_FORM_KEYS, DRAFT_DEBOUNCE_MS } from '../src/lib/draftConfig.js';
import { emptyExpenseForm } from '../src/lib/dailyExpenses.js';
import { selectableCategories, findCategoryIdByKey } from '../src/lib/expenseCategories.js';
import { employeeSelectOptions, payableEmployees } from '../src/lib/paymentRecipients.js';

const ler = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const USER = { id: 7, auth_user_id: 'uuid-7' };
const USER_KEY = resolveUserKey(USER);
const GASTO_KEY = DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO;

// ---------------------------------------------------------------------------
// Modelo da tela. Espelha `src/pages/Financeiro.jsx` (bloco de carregamento
// consolidado na main) e o `DailyExpensesPanel`.
// ---------------------------------------------------------------------------

function criarTela() {
  let data = {
    expenses: [],
    categories: [],
    centers: [],
    employees: [],
    suppliers: [],
    accounts: [],
    payments: [],
  };
  let initialLoading = true;
  let refreshing = false;
  let failure = '';
  let seqRef = 0;
  let carregou = false;
  // Registro de quais entities foram consultadas, para provar que criar
  // categoria NÃO dispara o `load()` global de ~15 entities.
  const consultas = [];

  const apply = (parcial, seq) => {
    if (seq !== seqRef) return false;
    data = { ...data, ...parcial };
    return true;
  };
  const safe = async (fn) => {
    try { return { ok: true, value: await fn() }; } catch { return { ok: false, value: null }; }
  };
  // Cada entity é lida por uma função. `safe` é quem a chama — é por isso que
  // uma falha vira `{ok:false}` em vez de derrubar a tela. O registro em
  // `consultas` existe para provar que criar categoria NÃO dispara o `load()`
  // global de ~15 entities.
  const lerEntity = (fonte, nome) => async () => { consultas.push(nome); return fonte[nome](); };

  return {
    get data() { return data; },
    get initialLoading() { return initialLoading; },
    get refreshing() { return refreshing; },
    get failure() { return failure; },
    get consultas() { return consultas; },

    async load(fn) {
      const seq = ++seqRef;
      if (carregou) refreshing = true; else initialLoading = true;
      const [expenses, categories, centers, employees, suppliers, accounts, payments] = await Promise.all([
        safe(lerEntity(fn, 'FinancialExpense.list')),
        safe(lerEntity(fn, 'ExpenseCategory.list')),
        safe(lerEntity(fn, 'CostCenter.list')),
        safe(lerEntity(fn, 'Employee.list')),
        safe(lerEntity(fn, 'Supplier.list')),
        safe(lerEntity(fn, 'Account.list')),
        safe(lerEntity(fn, 'EmployeePayment.list')),
      ]);
      apply({
        expenses: expenses.ok ? expenses.value : data.expenses,
        categories: categories.ok ? categories.value : data.categories,
        centers: centers.ok ? centers.value : data.centers,
        employees: employees.ok ? employees.value : data.employees,
        suppliers: suppliers.ok ? suppliers.value : data.suppliers,
        accounts: accounts.ok ? accounts.value : data.accounts,
        payments: payments.ok ? payments.value : data.payments,
      }, seq);
      if (seq === seqRef) { initialLoading = false; refreshing = false; carregou = true; }
    },

    // Releitura parcial usada ao criar categoria. Só duas entities.
    async reloadCategories(fn) {
      const seq = ++seqRef;
      refreshing = true;
      const [categories, expenses] = await Promise.all([
        safe(lerEntity(fn, 'ExpenseCategory.list')),
        safe(lerEntity(fn, 'FinancialExpense.list')),
      ]);
      apply({
        categories: categories.ok ? categories.value : data.categories,
        expenses: expenses.ok ? expenses.value : data.expenses,
      }, seq);
      if (seq === seqRef) refreshing = false;
    },

    async reloadExpenses(fn) {
      const seq = ++seqRef;
      refreshing = true;
      const r = await safe(lerEntity(fn, 'FinancialExpense.list'));
      apply({ expenses: r.ok ? r.value : data.expenses }, seq);
      if (seq === seqRef) refreshing = false;
    },
  };
}

// Dados de origem da tela. As funções lançam quando queremos simular rede
// caída; devolver o array é o caminho feliz.
const fonte = ({ expenses = [], categories = [], employees = [] } = {}) => ({
  'FinancialExpense.list': () => expenses,
  'ExpenseCategory.list': () => categories,
  'CostCenter.list': () => [],
  'Employee.list': () => employees,
  'Supplier.list': () => [],
  'Account.list': () => [],
  'EmployeePayment.list': () => [],
});

// ---------------------------------------------------------------------------
// O roteiro da seção 6: abrir o form, preencher, criar categoria, recarregar.
// ---------------------------------------------------------------------------

test('IC1 — draft ativo + criação de categoria: o formulário não perde nada', async () => {
  const storage = fakeStorage();
  let clock = 0;
  const sessao = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => clock });

  // 1-2. Financeiro > Gastos carrega; a lista aparece.
  const gastosJa = [
    { id: 'e1', description: 'Queijo', amount: 100, category_id: 'c1', category_name: 'Alimentação' },
    { id: 'e2', description: 'Gás', amount: 80, category_id: 'c1', category_name: 'Alimentação' },
  ];
  const tela = criarTela();
  await tela.load(fonte({ expenses: gastosJa, categories: [{ id: 'c1', name: 'Alimentação', status: 'ativo' }] }));
  assert.equal(tela.initialLoading, false, 'a lista carregou e initialLoading já desligou');
  assert.equal(tela.data.expenses.length, 2, 'a lista de gastos está visível');

  // 3-8. Abrir Novo Gasto e preencher; o rascunho grava.
  sessao.restore({ base: emptyExpenseForm() });
  let form = emptyExpenseForm();
  form = { ...form, amount: 187.5, description: 'Compra de queijo', date: '2026-09-29', category_id: 'c1' };
  sessao.change(form, clock);
  assert.equal(sessao.flush(clock + DRAFT_DEBOUNCE_MS), true, 'o rascunho gravou depois do debounce');
  assert.equal(storage.length, 1, 'existe rascunho ativo enquanto o formulário está aberto');

  // 9-10. Criar categoria nova e rodar reloadCategories.
  const antesDaConsulta = tela.consultas.length;
  await tela.reloadCategories(fonte({
    expenses: gastosJa,
    categories: [
      { id: 'c1', name: 'Alimentação', status: 'ativo' },
      { id: 'c-novo', name: 'Limpeza', status: 'ativo' },
    ],
  }));

  // 11. A lista de gastos NÃO desaparece.
  assert.equal(tela.data.expenses.length, 2, 'os gastos já carregados continuam na tela');
  assert.equal(tela.initialLoading, false, 'initialLoading NÃO volta a true durante o refresh');
  assert.equal(tela.refreshing, false, 'refreshing não fica preso');

  // 13-14. A categoria nova é selecionável.
  const opcoes = selectableCategories(tela.data.categories);
  assert.equal(opcoes.some((c) => c.id === 'c-novo'), true, 'a categoria nova aparece para seleção');
  assert.equal(findCategoryIdByKey([{ expense: gastosJa[0] }], 'alimentacao'), 'c1', 'o resumo por categoria acha o id real pela chave normalizada');

  // 15. O draft continua válido.
  assert.equal(storage.length, 1, 'o refresh de categoria não tocou no rascunho');
  const relido = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => clock });
  const r = relido.restore({ base: emptyExpenseForm() });

  // 12. O formulário NÃO perdeu os campos.
  assert.equal(r.restored, true, 'o rascunho foi reencontrado depois do refresh');
  assert.equal(r.data.amount, 187.5, 'o valor digitado sobreviveu');
  assert.equal(r.data.description, 'Compra de queijo', 'a descrição sobreviveu');
  assert.equal(r.data.date, '2026-09-29', 'a data sobreviveu');
  assert.equal(r.data.category_id, 'c1', 'a categoria escolhida antes continua a escolha');

  // 11b. Nenhum reset para o estado inicial, nenhum "Carregando gastos..." novo.
  const consultasDoRefresh = tela.consultas.slice(antesDaConsulta).sort();
  assert.deepEqual(consultasDoRefresh, ['ExpenseCategory.list', 'FinancialExpense.list'], 'reloadCategories consulta só 2 entities, não as ~15 do load()');
  assert.equal(tela.consultas.filter((c) => c === 'FinancialExpense.list').length, 2, 'gastos não foram recarregados duas vezes');
});

test('IC2 — falha ao recriar categoria: a lista se mantém e o rascunho sobrevive', async () => {
  const storage = fakeStorage();
  const sessao = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => 0 });
  sessao.change({ ...emptyExpenseForm(), description: 'Meio preenchido', amount: 33 }, 0);
  sessao.flush(DRAFT_DEBOUNCE_MS, { force: true });

  const tela = criarTela();
  const gastos = [{ id: 'e1', description: 'Queijo', amount: 100, category_id: 'c1', category_name: 'Alimentação' }];
  await tela.load(fonte({ expenses: gastos, categories: [{ id: 'c1', name: 'Alimentação', status: 'ativo' }] }));

  // A releitura de categorias falha. A de gastos volta. O ponto é que a
  // TELA não pode virar lista vazia por causa disso.
  await tela.reloadCategories({
    'FinancialExpense.list': () => gastos,
    'ExpenseCategory.list': () => { throw new Error('rede caiu'); },
  });

  assert.equal(tela.data.expenses.length, 1, 'a lista de gastos continua — falha de refresh não vira lista vazia');
  assert.equal(tela.data.categories.length, 1, 'a categoria anterior é preservada quando a releitura falha');
  assert.equal(storage.length, 1, 'o rascunho do formulário aberto continua intacto');
  const r = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => 0 }).restore({ base: emptyExpenseForm() });
  assert.equal(r.data.description, 'Meio preenchido', 'o que a pessoa digitou não foi perdido');
});

test('IC3 — salvar o gasto limpa o rascunho só depois do backend confirmar', async () => {
  const storage = fakeStorage();
  const sessao = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => 0 });
  sessao.change({ ...emptyExpenseForm(), description: 'Vai pro banco', amount: 55, category_id: 'c-novo' }, 0);
  sessao.flush(0, { force: true });
  assert.equal(storage.length, 1, 'rascunho existe antes de salvar');

  // Falha do backend: o rascunho é a única cópia e precisa ficar.
  sessao.failed();
  assert.equal(storage.length, 1, 'falhou o save, o rascunho permanece');

  // Sucesso: só agora ele sai.
  sessao.saved();
  assert.equal(storage.length, 0, 'confirmado no servidor, o rascunho sai');
});

test('IC4 — duas abas: uma não destrói o rascunho da outra', async () => {
  const storage = fakeStorage();
  const abaUm = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => 0 });
  abaUm.change({ ...emptyExpenseForm(), description: 'aba um' }, 0);
  abaUm.flush(0, { force: true });

  // A outra aba abre o MESMO formulário e só o RELÊ — não apaga.
  const abaDois = createDraftSession({ userKey: USER_KEY, formKey: GASTO_KEY, storage, now: () => 10 });
  const r = abaDois.restore({ base: emptyExpenseForm() });
  assert.equal(r.data.description, 'aba um', 'a segunda aba enxerga o rascunho e NÃO o apaga');
});

test('IC5 — o formulário de gasto segue a regra centralizada de destinatário', () => {
  // A correção da main (freelancer/PJ/Autônomo/Diarista) precisa continuar
  // valendo NO MESMO arquivo onde mora o rascunho.
  const employees = [
    { id: 'e1', name: 'Ana', hire_type: 'autonomo', function: 'Cozinheira', status: 'ativo' },
    { id: 'e2', name: 'Bruno', hire_type: 'pj', status: 'ativo' },
    { id: 'e3', name: 'Carla', hire_type: 'diarista', status: 'ativo' },
    { id: 'e4', name: 'Inativo', hire_type: 'clt', status: 'inativo' },
  ];
  const opcoes = employeeSelectOptions(employees);
  assert.equal(opcoes.length, 3, 'inativo fica de fora e os três tipos aparecem');
  assert.equal(opcoes.some(([, label]) => label.includes('PJ')), true, 'label de PJ presente');
  assert.equal(opcoes.some(([, label]) => label.includes('Autônomo')), true, 'label de Autônomo presente');
  assert.equal(opcoes.some(([, label]) => label.includes('Diarista')), true, 'label de Diarista presente');
  assert.equal(payableEmployees(employees).length, 3, 'mesma regra fora do formulário');
});

test('IC6 — ligação: o arquivo do formulário tem rascunho E a regra centralizada', async () => {
  const gasto = await ler('src/components/financeiro/DailyExpenseForm.jsx');
  assert.match(gasto, /usePersistentDraft\(/, 'rascunho presente no formulário de gasto');
  assert.match(gasto, /draft\.markSaved\(\)/, 'limpeza só depois do backend');
  assert.match(gasto, /draft\.markFailed\(\)/, 'falha mantém o rascunho');
  assert.match(gasto, /employeeSelectOptions/, 'regra centralizada de destinatário preservada no MESMO arquivo');
  assert.doesNotMatch(gasto, /status\s*!==\s*'inativo'/, 'sem filtro próprio que possa divergir da regra central');

  const painel = await ler('src/pages/Financeiro.jsx');
  assert.match(painel, /onCategoriesChanged=\{reloadCategories\}/, 'categoria recarrega pela releitura parcial');
  assert.match(painel, /onSaved=\{reloadExpenses\}/, 'salvar gasto usa a releitura parcial');
  assert.match(painel, /loading=\{initialLoading\}/, 'a lista usa initialLoading, que não volta durante refresh');
  assert.doesNotMatch(painel, /\.catch\(\(\) => \[\]\)/, 'falha nunca vira lista vazia');

  const componente = await ler('src/components/financeiro/DailyExpensesPanel.jsx');
  assert.match(componente, /onSaved=\{onCategoriesChanged \|\| onSaved\}/, 'o gerenciador de categoria usa a releitura parcial');
  assert.match(componente, /failure && <p role="alert"/, 'falha de refresh aparece como aviso, não como tela vazia');

  const gerenciador = await ler('src/components/financeiro/ExpenseCategoryManager.jsx');
  const idxSaved = gerenciador.indexOf('await onSaved');
  const idxSelect = gerenciador.indexOf('onSelect?.(novoId)');
  assert.ok(idxSaved > -1 && idxSelect > idxSaved, 'a categoria é salva ANTES de ser selecionada');
  assert.match(gerenciador, /if \(novoId\)/, 'só seleciona com id real');
  assert.match(gerenciador, /Array\.isArray\(categories\) \? categories : \[\]/, 'normaliza a lista na borda');
});

test('IC7 — nenhum "Carregando gastos..." novo durante o refresh de categoria', async () => {
  const painel = await ler('src/components/financeiro/DailyExpensesPanel.jsx');
  // A lista é desenhada a partir de `loading` (= initialLoading) e não de
  // `refreshing`. É isso que impede a lista de piscar a cada refresh.
  const linhaLista = painel.split('\n').find((l) => l.includes("gasto(s) ·"));
  assert.ok(linhaLista, 'a linha de total da lista existe');
  assert.match(linhaLista, /loading \? 'Carregando\.\.\.'/, 'o texto de carregamento depende de loading/initialLoading');
  assert.doesNotMatch(linhaLista, /refreshing/, 'refreshing NÃO controla o texto de carregamento da lista');
  assert.match(painel, /\{refreshing &&/, 'refreshing vira indicador discreto, não tela de espera');
});

test('IC8 — CategoryDigest: todo setter chamado existe de fato', async () => {
  // Bug real que existia na main: o botão "Fechar detalhamento" chamava
  // `setAberto(null)`, que nunca foi declarado. Clicar quebrava com
  // ReferenceError. Um teste que só casa string não pega isso; o que pega é
  // cruzar todo `setX(` chamado com os setters realmente declarados.
  const codigo = await ler('src/components/financeiro/CategoryDigest.jsx');

  // 1. Setters declarados: o segundo elemento de cada destructuring de useState.
  const declarados = new Set();
  for (const m of codigo.matchAll(/const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\(/g)) {
    declarados.add(m[2]);
  }
  assert.equal(declarados.size, 1, 'o componente tem um estado (grupoAberto)');
  assert.equal(declarados.has('setGrupoAberto'), true, 'o setter declarado é setGrupoAberto');

  // 2. Todo `setAlgo(` invocado precisa estar declarado.
  const chamados = new Set([...codigo.matchAll(/\bset([A-Z][\w$]*)\s*\(/g)].map((m) => `set${m[1]}`));
  const naoDeclarados = [...chamados].filter((s) => !declarados.has(s));
  assert.deepEqual(naoDeclarados, [], `chamar setter inexistente quebra em runtime com ReferenceError: ${naoDeclarados.join(', ')}`);

  // 3. specifically: `setAberto` não pode reaparecer.
  assert.doesNotMatch(codigo, /\bsetAberto\b/, 'setAberto nunca foi declarado neste arquivo');

  // 4. O "Fechar detalhamento" usa o setter real.
  const linhaBotao = codigo.split('\n').find((l) => l.includes('setGrupoAberto(null)}') && l.includes('onClick'));
  assert.ok(linhaBotao, 'o botão de fechar detalhamento chama setGrupoAberto(null)');
  assert.equal(linhaBotao.includes('Fechar detalhamento') || codigo.includes('Fechar detalhamento'), true, 'o rótulo do botão existe');

  // 5. Todos os pontos que fecham o grupo usam o mesmo setter (toggle,
  //    limpar filtro e fechar detalhamento).
  assert.equal((codigo.match(/setGrupoAberto\(null\)/g) || []).length, 2, 'toggle/limpar e fechar detalhamento usam o mesmo setter');
  assert.match(codigo, /setGrupoAberto\(ativo \? null : grupo\)/, 'o toggle de abrir/fechar também usa o mesmo setter');
});
