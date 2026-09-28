import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildExpensePayload, dailyExpenseIndicators, deleteDailyExpense, emptyExpenseForm, expenseDeleteBlocker,
  expenseMatchesSearch, expenseToForm, filterExpenses, formatExpenseAmount, formatExpenseDate,
  resolveExpensePeriod, saveDailyExpense, supplierNameOptions, validateExpenseForm,
} from '../src/lib/dailyExpenses.js';
import {
  expenseAttachmentRecord, hasExpenseAttachment, validateExpenseAttachmentFile,
  EXPENSE_ATTACHMENT_ACCEPT, EXPENSE_ATTACHMENT_PREFIX,
} from '../src/lib/expenseAttachment.js';
import { loadPaymentProof } from '../src/lib/paymentProof.js';

// Fixtures sintéticos reaproveitados da suíte existente. Nenhum dado real.
const fixtures = await readFile(new URL('./test-payment-proof.mjs', import.meta.url), 'utf8');
const jpeg = Buffer.from(fixtures.match(/const jpeg = Buffer.from\('([^']+)'/)[1], 'base64');
const png = Buffer.from(fixtures.match(/const png = Buffer.from\(\s*'([^']+)'/)[1], 'base64');
const makePdf = new Function(`${fixtures.match(/function makePdf\(\) \{[\s\S]*?\n\}/)[0]}; return makePdf();`);
const pdf = makePdf();
const dataUrl = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;

const REF = new Date('2026-03-18T12:00:00Z'); // quarta-feira
const employees = [{ id: 'e1', name: 'Maria Souza', sector: 'Produção', function: 'Cozinheira' }];
const categories = [{ id: 'c1', name: 'Insumos', status: 'ativo' }, { id: 'c2', name: 'Manutenção', status: 'ativo' }];
const centers = [{ id: 'cc1', name: 'Cozinha', status: 'ativo' }];

// Entidades em memória: nenhum acesso a banco, Supabase ou rede.
function fakeEntities() {
  const store = { expense: new Map(), payment: new Map() };
  const nextId = (prefix, map) => `${prefix}_${map.size + 1}`;
  return {
    store,
    entities: {
      FinancialExpense: {
        create: async (data) => { const id = nextId('fe', store.expense); store.expense.set(id, { ...data, id }); return { ...data, id }; },
        update: async (id, patch) => { const merged = { ...store.expense.get(id), ...patch, id }; store.expense.set(id, merged); return merged; },
        delete: async (id) => { store.expense.delete(id); return true; },
      },
      EmployeePayment: {
        create: async (data) => { const id = nextId('ep', store.payment); store.payment.set(id, { ...data, id }); return { ...data, id }; },
        update: async (id, patch) => { const merged = { ...store.payment.get(id), ...patch, id }; store.payment.set(id, merged); return merged; },
      },
    },
  };
}

const validForm = (over = {}) => ({
  ...emptyExpenseForm(REF),
  description: 'Compra de queijo',
  amount: '48,90',
  category_id: 'c1',
  cost_center_id: 'cc1',
  ...over,
});

// ---------------------------------------------------------------- formatação

test('data aparece em DD/MM/AAAA e valor em R\$ 0,00', () => {
  assert.equal(formatExpenseDate('2026-03-18'), '18/03/2026');
  assert.equal(formatExpenseDate('2026-01-05'), '05/01/2026');
  assert.equal(formatExpenseDate(''), '—');
  assert.equal(formatExpenseDate(undefined), '—');
  assert.equal(formatExpenseDate('data invalida'), '—');
  // toLocaleString usa espaço não separável entre "R$" e o número.
  const moeda = (valor) => formatExpenseAmount(valor).replace(/\u00a0/g, ' ');
  assert.equal(moeda(48.9), 'R$ 48,90');
  assert.equal(moeda(0), 'R$ 0,00');
  assert.equal(moeda(''), 'R$ 0,00');
  assert.equal(moeda(1234.5), 'R$ 1.234,50');
});

// ------------------------------------------------------------ criação/formulário

test('criação: payload usa somente campos já existentes e preserva as regras', () => {
  const payload = buildExpensePayload(validForm({ amount: '1.234,56' }), {
    categories, centers, employees, responsibleUser: 'Operador',
  });
  assert.equal(payload.description, 'Compra de queijo');
  assert.equal(payload.amount, 1234.56, 'aceita vírgula e ponto como separador');
  assert.equal(payload.category_name, 'Insumos', 'categoria é resolvida pelo id');
  assert.equal(payload.cost_center_name, 'Cozinha');
  assert.equal(payload.date, '2026-03-18');
  assert.equal(payload.paid_date, '2026-03-18', 'pago usa a data do gasto como padrão');
  assert.equal(payload.origin_type, 'manual');
  assert.equal(payload.responsible_user, 'Operador');
  assert.equal(payload.status, 'pago');
  // Nenhum campo fora do conjunto original da entidade.
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['account', 'amount', 'beneficiary_id', 'beneficiary_name', 'beneficiary_type', 'category_id',
      'category_name', 'classification', 'cost_center_id', 'cost_center_name', 'date', 'description',
      'document_number', 'invoice_url', 'observation', 'origin_type', 'paid_date', 'payment_method',
      'proof_url', 'responsible_user', 'status'].sort(),
  );
});

test('formulário: pendente não recebe paid_date; colaborador exige seleção', () => {
  const pending = buildExpensePayload(validForm({ status: 'pendente' }), { categories, centers, employees });
  assert.equal(pending.paid_date, '');
  const semEmpregado = buildExpensePayload(validForm({ beneficiary_type: 'colaborador' }), { categories, centers, employees });
  assert.equal(semEmpregado.beneficiary_id, '');
  const comEmpregado = buildExpensePayload(
    validForm({ beneficiary_type: 'colaborador', employee_id: 'e1' }), { categories, centers, employees });
  assert.equal(comEmpregado.beneficiary_name, 'Maria Souza', 'nome vem do Employee, não do texto digitado');
  assert.equal(comEmpregado.employee_id, 'e1');
});

// Integração com a regra numérica compartilhada (Agente 1): o Gastos Diários
// NÃO pode ter uma segunda rotina de parse/arredondamento diferente da do estoque.
test('valor segue a regra compartilhada do numberUtils (pt-BR na tela, número no banco)', async () => {
  const { parseDecimalBR, roundMoney, toNumberBR } = await import('../src/lib/numberUtils.js');
  const casos = [
    ['48,90', 48.9], ['1.234,56', 1234.56], ['1234.56', 1234.56],
    ['1.500,25', 1500.25], ['0,01', 0.01], ['10', 10],
  ];
  for (const [digitado, esperado] of casos) {
    const payload = buildExpensePayload(validForm({ amount: digitado }), { categories, centers, employees });
    assert.equal(payload.amount, esperado, `digitado "${digitado}"`);
    assert.equal(payload.amount, roundMoney(parseDecimalBR(digitado)), 'mesma função do projeto');
    assert.equal(typeof payload.amount, 'number', 'no banco é número, nunca string formatada');
  }
  // Valor não numérico nunca vira NaN no registro.
  assert.equal(buildExpensePayload(validForm({ amount: 'abc' }), { categories, centers, employees }).amount, 0);
  // Centavos: nada de erro de ponto flutuante no total gravado.
  assert.equal(buildExpensePayload(validForm({ amount: '0,1' }), { categories, centers, employees }).amount, 0.1);
  assert.equal(buildExpensePayload(validForm({ amount: '33,33' }), { categories, centers, employees }).amount, 33.33);
  assert.equal(toNumberBR(''), NaN);
});

test('validação do formulário explica cada campo obrigatório', () => {
  const semData = { ...emptyExpenseForm(REF), date: '' };
  const vazio = validateExpenseForm(semData);
  assert.equal(vazio.valid, false);
  assert.ok(vazio.errors.description);
  assert.ok(vazio.errors.amount);
  assert.ok(vazio.errors.date);
  assert.equal(validateExpenseForm(validForm(), { employees }).valid, true);
  assert.ok(validateExpenseForm(validForm({ amount: '0' })).errors.amount);
  assert.ok(validateExpenseForm(validForm({ amount: 'abc' })).errors.amount);
  assert.ok(validateExpenseForm(validForm({ beneficiary_type: 'colaborador' }), { employees }).errors.employee_id);
});

test('salvar cria o gasto e o EmployeePayment vinculado, e a edição mantém os dois em sincronia', async () => {
  const { entities, store } = fakeEntities();
  const criado = await saveDailyExpense({
    entities, form: validForm({ beneficiary_type: 'colaborador', employee_id: 'e1' }),
    categories, centers, employees, responsibleUser: 'Operador',
  });
  assert.equal(criado.created, true);
  const expenseId = criado.expense.id;

// ------------------------------------------------------------------- pesquisa

const amostra = [
  { id: '1', date: '2026-03-18', description: 'Compra de queijo', category_name: 'Insumos', beneficiary_name: 'Hortifruti Silva', responsible_user: 'Maria', amount: 48.9, payment_method: 'pix', category_id: 'c1', status: 'pago' },
  { id: '2', date: '2026-03-10', description: 'Manutenção do freezer', category_name: 'Manutenção', responsible_user: 'João', amount: 320, payment_method: 'dinheiro', category_id: 'c2', status: 'pago' },
  { id: '3', date: '2026-02-02', description: 'Gás de cozinha', category_name: 'Insumos', responsible_user: 'Maria', amount: 150, payment_method: 'cartao_credito', category_id: 'c1', status: 'pago' },
  { id: '4', date: '2026-03-18', description: 'Lançamento cancelado', amount: 999, status: 'cancelado' },
];

test('pesquisa encontra por descrição, categoria, fornecedor e responsável, ignorando acentos', () => {
  const buscar = (termo) => filterExpenses(amostra, { search: termo }).map((row) => row.id);
  assert.deepEqual(buscar('queijo'), ['1']);
  assert.deepEqual(buscar('QUEIJO'), ['1'], 'maiúsculas');
  assert.deepEqual(buscar('manutencao'), ['2'], 'sem acento encontra com acento');
  assert.deepEqual(buscar('manutenção'), ['2'], 'com acento também');
  assert.deepEqual(buscar('hortifruti'), ['1'], 'fornecedor');
  assert.deepEqual(buscar('joao'), ['2'], 'responsável sem acento');
  assert.deepEqual(buscar('insumos'), ['1', '3'], 'categoria');
  assert.deepEqual(buscar('gás'), ['3']);
  assert.deepEqual(buscar('inexistente'), []);
  assert.deepEqual(buscar(''), ['1', '2', '3'], 'vazio lista todos os válidos');
  assert.deepEqual(buscar('queijo insumo'), ['1'], 'múltiplas palavras');
  assert.deepEqual(buscar('queijo freezer'), [], 'todas as palavras precisam bater');
  assert.equal(expenseMatchesSearch(amostra[0], '  '), true, 'espaços não filtram');
});

test('busca nunca é mecanismo de autorização: a listagem continua vindo do servidor/banco', () => {
  // A busca é apenas apresentação; o conjunto completo continua disponível
  // para quem tem permissão (o painel recebe `rows` já carregados da entity).
  assert.equal(filterExpenses(amostra, { search: 'inexistente' }).length, 0);
  assert.equal(amostra.length, 4, 'a origem dos dados não muda com a busca');
});

// -------------------------------------------------------------------- filtros

test('filtros por período, categoria e forma de pagamento', () => {
  assert.deepEqual(filterExpenses(amostra, { start: '2026-03-01', end: '2026-03-31' }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(filterExpenses(amostra, { categoryId: 'c1' }).map((r) => r.id), ['1', '3']);
  assert.deepEqual(filterExpenses(amostra, { paymentMethod: 'dinheiro' }).map((r) => r.id), ['2']);
  assert.deepEqual(filterExpenses(amostra, { start: '2026-03-18' }).map((r) => r.id), ['1'], 'cancelado nunca aparece');
  assert.deepEqual(filterExpenses(amostra, { start: '2026-03-10', end: '2026-03-18', paymentMethod: 'pix' }).map((r) => r.id), ['1']);
});

test('atalhos de período: hoje, esta semana, este mês, personalizado e tudo', () => {
  assert.deepEqual(resolveExpensePeriod('hoje', { reference: REF }), { start: '2026-03-18', end: '2026-03-18' });
  assert.deepEqual(resolveExpensePeriod('semana', { reference: REF }), { start: '2026-03-16', end: '2026-03-22' }, 'semana de segunda a domingo');
  assert.deepEqual(resolveExpensePeriod('mes', { reference: REF }), { start: '2026-03-01', end: '2026-03-18' });
  assert.deepEqual(resolveExpensePeriod('personalizado', { start: '2026-01-01', end: '2026-01-31', reference: REF }), { start: '2026-01-01', end: '2026-01-31' });
  assert.deepEqual(resolveExpensePeriod('todos', { reference: REF }), { start: '', end: '' });
});

// ----------------------------------------------------------------- indicadores

test('indicadores somam apenas gastos válidos, sem os cancelados', () => {
  const rows = [
    ...amostra,
    { id: '5', date: '2026-03-18', description: 'Café', amount: 25, status: 'pago' },
    { id: '6', date: '2026-03-18', description: 'Sem anexo', amount: 10, status: 'pago' },
  ];
  const kpi = dailyExpenseIndicators(rows, { reference: REF });
  assert.equal(kpi.todayCount, 3, 'três lançamentos hoje (o cancelado não conta)');
  assert.equal(kpi.todayTotal, 48.9 + 25 + 10);
  assert.equal(kpi.monthCount, 4);
  assert.equal(kpi.monthTotal, 48.9 + 320 + 25 + 10);
  assert.equal(kpi.totalCount, 5, 'o lançamento cancelado fica fora da contagem');
  assert.equal(kpi.noProofCount, 5, 'apenas os pagos sem comprovante');
});

// -------------------------------------------------------------------- exclusão

test('exclusão: gasto manual sem vínculo é removido', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  assert.equal(expenseDeleteBlocker(expense, {}), null);
  await deleteDailyExpense({ entities, expense, payments: [], vales: [] });
  assert.equal(store.expense.size, 0);
});

test('exclusão é bloqueada quando o gasto vem de outra tela ou tem vínculo', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  const deVale = { ...expense, origin_type: 'vale' };
  assert.match(expenseDeleteBlocker(deVale, {}), /Vale do RH/);
  assert.match(expenseDeleteBlocker({ ...expense, origin_type: 'pagamento_colaborador' }, {}), /colaborador/);
  assert.match(expenseDeleteBlocker(expense, { payments: [{ financial_expense_id: expense.id }] }), /pagamento de colaborador/);
  assert.match(expenseDeleteBlocker(expense, { vales: [{ financial_expense_id: expense.id }] }), /vale/);
  await assert.rejects(deleteDailyExpense({ entities, expense: deVale, payments: [], vales: [] }), /não pode ser excluído/);
  assert.equal(store.expense.size, 1, 'nada é apagado quando a exclusão é bloqueada');
  assert.equal(expenseDeleteBlocker({}, {}), 'Gasto não encontrado.');
});

// ------------------------------------------------------------------ anexos

for (const [format, type, bytes] of [['JPG', 'image/jpeg', jpeg], ['PNG', 'image/png', png], ['PDF', 'application/pdf', pdf]]) {
  test(`comprovante ${format}: base64 -> Blob -> URL acessível e revogada`, async () => {

test('registro sem comprovante funciona e não oferece botão de anexo', () => {
  const semAnexo = { id: 'g2', description: 'Gás de cozinha', amount: 150, status: 'pago' };
  assert.equal(hasExpenseAttachment(semAnexo), false);
  assert.equal(expenseAttachmentRecord(semAnexo, 'proof_url'), null);
  assert.equal(expenseAttachmentRecord({ proof_url: '' }, 'proof_url'), null);
  assert.equal(expenseAttachmentRecord({ proof_url: 'x' }, 'desconhecido'), null, 'campo não confirmado não é inferido');
  // A nota fiscal é um anexo independente: não esconde o comprovante.
  const comNota = { id: 'g3', proof_url: dataUrl('image/png', png), invoice_url: dataUrl('application/pdf', pdf) };
  assert.equal(expenseAttachmentRecord(comNota, 'proof_url').proof_url, comNota.proof_url);
  assert.equal(expenseAttachmentRecord(comNota, 'invoice_url').proof_url, comNota.invoice_url);
});

test('upload aceita os formatos previstos e recusa arquivo perigoso ou disfarçado', async () => {
  for (const [name, type, bytes] of [
    ['a.JPG', 'image/jpeg', jpeg], ['a.jpeg', 'image/jpeg', jpeg], ['a.png', 'image/png', png],
    ['a.webp', 'image/webp', Buffer.from('RIFFxxxxWEBP')], ['a.pdf', 'application/pdf', pdf],
  ]) await assert.doesNotReject(validateExpenseAttachmentFile(new File([bytes], name, { type })));
  for (const file of [
    new File(['MZ'], 'malicioso.exe', { type: 'application/octet-stream' }),
    new File(['MZ'], 'disfarce.jpg', { type: 'image/jpeg' }),
    new File(['<html>'], 'pagina.jpg', { type: 'text/html' }),
    new File([], 'vazio.pdf', { type: 'application/pdf' }),
  ]) await assert.rejects(validateExpenseAttachmentFile(file));
  assert.match(EXPENSE_ATTACHMENT_ACCEPT, /image\/jpeg/);
  assert.match(EXPENSE_ATTACHMENT_ACCEPT, /application\/pdf/);
});

test('legado: o upload continua gravando base64 e o preview o reconstrói', async () => {
  // Compatibilidade preservada: nada migra para Storage automaticamente.
  const payload = buildExpensePayload(validForm({ proof_url: dataUrl('image/jpeg', jpeg) }), { categories, centers, employees });
  assert.ok(payload.proof_url.startsWith('data:image/jpeg;base64,'), 'segue o formato legado');
  const blob = await loadPaymentProof({ id: 'g4', proof_url: payload.proof_url }, { prefix: EXPENSE_ATTACHMENT_PREFIX });
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(blob.size, jpeg.length);
});

test('fornecedores sugeridos vêm da entity Supplier e são deduplicados', () => {
  const lista = supplierNameOptions([
    { name: 'Hortifruti Silva', trade_name: 'Hortifruti Silva' },
    { name: 'Distribuidora ABC', trade_name: 'ABC Distribuidora' },
    { name: 'Hortifruti Silva' },
  ]);
  assert.deepEqual(lista, ['ABC Distribuidora', 'Hortifruti Silva']);
  assert.deepEqual(supplierNameOptions([]), []);
});

test('abrir um gasto existente preenche o formulário sem perder dados', () => {
  const form = expenseToForm({
    id: 'g5', created_date: 'x', date: '2026-03-10', description: 'Manutenção', amount: 320,
    category_id: 'c2', payment_method: 'dinheiro', status: 'pendente', proof_url: 'data:application/pdf;base64,AA==',
    origin_type: 'manual', responsible_user: 'João',
  }, REF);
  assert.equal(form.description, 'Manutenção');
  assert.equal(form.amount, 320, 'valor volta como número para o NumberInput compartilhado');
  assert.equal(form.category_id, 'c2');

// ------------------------------------------- não regressão do AttachmentPreview

test('o painel não abre Data URL em nova aba: o botão vai para o AttachmentPreview', async () => {
  const { createServer: createViteServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { fileURLToPath } = await import('node:url');
  // Somente transformação SSR em memória: não abre porta nem toca em banco.
  const vite = await createViteServer({
    configFile: false, plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  });
  try {
    const previousWindow = globalThis.window;
    try {
      globalThis.window = { self: null, top: null };
      await vite.ssrLoadModule('/src/lib/utils.js');
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
    const { ExpenseAttachment, ExpenseAttachmentUpload } = await vite.ssrLoadModule('/src/components/financeiro/ExpenseAttachment.jsx');
    for (const [field, type, bytes] of [['proof_url', 'image/jpeg', jpeg], ['proof_url', 'image/png', png], ['proof_url', 'application/pdf', pdf], ['invoice_url', 'application/pdf', pdf]]) {
      const record = { id: 'g1', [field]: dataUrl(type, bytes) };
      const html = renderToStaticMarkup(createElement(ExpenseAttachment, { record, field, label: 'Comprovante' }));
      assert.match(html, /<button/, 'o anexo vira botão, não link');
      assert.ok(html.includes('Comprovante'));
      assert.doesNotMatch(html, /href=|data:(image|application)/, 'Data URL nunca vira link direto');
      assert.doesNotMatch(html, /target=/, 'nada abre em nova aba');
      assert.equal(renderToStaticMarkup(createElement(ExpenseAttachment, { record: { id: 'vazio' }, field })), '');
    }
    const uploadHtml = renderToStaticMarkup(createElement(ExpenseAttachmentUpload, {
      label: 'Comprovante', record: {}, field: 'proof_url', refEl: { current: null }, onFile: () => {},
    }));
    assert.match(uploadHtml, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf,\.jpg,\.jpeg,\.png,\.webp,\.pdf"/);
  } finally { await vite.close(); }
});

  assert.equal(form.status, 'pendente');
  assert.ok(form.proof_url, 'o comprovante existente é preservado na edição');
  assert.equal(form.id, undefined, 'metadados da entity não entram no formulário');
  assert.equal(form.created_date, undefined);
});

    // Simula gravar, serializar e reler o registro depois de salvar/recarregar.
    const saved = JSON.parse(JSON.stringify({ id: 'g1', proof_url: dataUrl(type, bytes) }));
    const record = expenseAttachmentRecord(saved, 'proof_url');
    assert.ok(record, 'o botão de comprovante é oferecido');
    assert.equal(hasExpenseAttachment(saved), true);
    const blob = await loadPaymentProof(record, { prefix: EXPENSE_ATTACHMENT_PREFIX });
    assert.equal(blob.type, type);
    const url = URL.createObjectURL(blob);
    try {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    } finally { URL.revokeObjectURL(url); }
    await assert.rejects(fetch(url), 'a Object URL é revogada');
  });
}


test('indicadores de lista vazia são zero, sem NaN', () => {
  const kpi = dailyExpenseIndicators([], { reference: REF });
  assert.equal(kpi.todayTotal, 0);
  assert.equal(kpi.totalCount, 0);
  assert.equal(kpi.noProofCount, 0);
  assert.equal(formatExpenseAmount(kpi.monthTotal).replace(/\u00a0/g, ' '), 'R$ 0,00');
});

  const pagamento = [...store.payment.values()][0];
  assert.equal(pagamento.financial_expense_id, expenseId, 'pagamento aponta para o gasto');
  assert.equal(pagamento.net_amount, 48.9);

  await saveDailyExpense({
    entities, form: validForm({ beneficiary_type: 'colaborador', employee_id: 'e1', amount: '99,50', description: 'Compra de queijo (corrigido)' }),
    categories, centers, employees, responsibleUser: 'Operador', editing: criado.expense, payments: [pagamento],
  });
  assert.equal(store.expense.get(expenseId).amount, 99.5, 'gasto editado');
  assert.equal([...store.payment.values()][0].net_amount, 99.5, 'pagamento não fica defasado');
  assert.equal(store.expense.size, 1, 'edição não duplica o gasto');
  assert.equal(store.payment.size, 1, 'edição não duplica o pagamento');
});

test('gasto de colaborador registra o responsável; gasto comum não cria EmployeePayment', async () => {
  const { entities, store } = fakeEntities();
  await saveDailyExpense({ entities, form: validForm(), categories, centers, employees, responsibleUser: 'Operador' });
  assert.equal(store.expense.size, 1);
  assert.equal(store.payment.size, 0, 'fornecedor/outro não gera pagamento');
  assert.equal([...store.expense.values()][0].responsible_user, 'Operador');
});

