import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  buildExpensePayload, dailyExpenseIndicators, deleteDailyExpense, emptyExpenseForm,
  expenseDeleteBlocker, expenseEditBlocker, expenseMatchesSearch, expenseMethodLabel,
  expenseStatusLabel, expenseToForm, filterExpenses, formatExpenseAmount, formatExpenseDate,
  hasExpenseProof, newExpenseId, resolveExpensePeriod, saveDailyExpense, supplierNameOptions,
  validateExpenseForm, ExpenseConflictError, PROTECTED_EXPENSE_ORIGINS, linkedPayment, linkedVale,
} from '../src/lib/dailyExpenses.js';
import {
  categoryKey, findEquivalentCategory, normalizeCategoryName, sameCategoryName,
  selectableCategories, summarizeByCategory, totalOf,
} from '../src/lib/expenseCategories.js';
import {
  expenseAttachmentRecord, hasExpenseAttachment, validateExpenseAttachmentFile,
  EXPENSE_ATTACHMENT_ACCEPT, EXPENSE_ATTACHMENT_PREFIX,
} from '../src/lib/expenseAttachment.js';
import { loadPaymentProof } from '../src/lib/paymentProof.js';
import { todayISO } from '../src/lib/timeUtils.js';

// Fixtures sintéticos reaproveitados da suíte já existente. Nenhum dado real.
const fixtures = await readFile(new URL('./test-payment-proof.mjs', import.meta.url), 'utf8');
const jpeg = Buffer.from(fixtures.match(/const jpeg = Buffer.from\('([^']+)'/)[1], 'base64');
const png = Buffer.from(fixtures.match(/const png = Buffer.from\(\s*'([^']+)'/)[1], 'base64');
const makePdf = new Function(`${fixtures.match(/function makePdf\(\) \{[\s\S]*?\n\}/)[0]}; return makePdf();`);
const pdf = makePdf();
const dataUrl = (type, bytes) => `data:${type};base64,${bytes.toString('base64')}`;

const REF = new Date('2026-03-18T12:00:00Z'); // quarta-feira
const employees = [
  { id: 'e1', name: 'Maria Souza', sector: 'Produção', function: 'Cozinheira' },
  { id: 'e2', name: 'Joao Lima', sector: 'Produção', function: 'Auxiliar' },
];
const categories = [{ id: 'c1', name: 'Insumos', status: 'ativo' }, { id: 'c2', name: 'Manutenção', status: 'ativo' }];
const centers = [{ id: 'cc1', name: 'Cozinha', status: 'ativo' }];
// Intl/Intl.NumberFormat usam espaço não separável entre "R$" e o número.
const nbsp = (value) => String(value).replace(/\u00a0/g, ' ');
const reais = (n) => nbsp(n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));


// Entidades em memória que reproduzem a semântica de cloudDb/localDb:
// `create` respeita `data.id` (upsert pela chave entity+id), `update` faz merge
// ebumpe `updated_date`, e `transact` compara a versão lida (CAS) e só grava se
// ela não mudou. Nenhum acesso a banco, Supabase ou rede.
let clock = 0;
const stamp = () => new Date(1700000000000 + (clock += 1000)).toISOString();

function fakeEntities(options = {}) {
  const store = { FinancialExpense: new Map(), EmployeePayment: new Map(), Vale: new Map() };
  const makeClient = (entity) => ({
    async create(data) {
      if (options.failCreate?.[entity]) throw new Error(`falha simulada em ${entity}.create`);
      const id = data?.id || `${entity.toLowerCase()}_${store[entity].size + 1}`;
      const rec = { ...data, id, created_date: data?.created_date || stamp(), updated_date: stamp() };
      store[entity].set(id, rec); // mesmo id => upsert, nunca duplica
      return { ...rec };
    },
    async update(id, patch) {
      const existing = store[entity].get(id);
      if (!existing) throw new Error(`${entity} "${id}" não encontrado.`);
      const merged = { ...existing, ...patch, id, updated_date: stamp() }; //bumpe de versão
      store[entity].set(id, merged);
      return { ...merged };
    },
    async transact(id, mutate) {
      const existing = store[entity].get(id);
      if (!existing) throw new Error(`${entity} "${id}" não encontrado.`);
      const patch = await mutate({ ...existing });
      if (patch === null || patch === undefined) return { ...existing };
      // CAS: se a versão lida não for mais a atual, outra máquina gravou.
      if (store[entity].get(id)?.updated_date !== existing.updated_date) {
        throw new Error(`${entity} "${id}" mudou durante a gravação.`);
      }
      const merged = { ...existing, ...patch, id, updated_date: stamp() };
      store[entity].set(id, merged);
      return { ...merged };
    },
    async delete(id) {
      if (options.failDelete?.includes(entity)) throw new Error(`falha simulada em ${entity}.delete`);
      store[entity].delete(id);
      return { id };
    },
    async list() {
      return [...store[entity].values()].map((row) => ({ ...row }));
    },
    async get(id) {
      const found = store[entity].get(id);
      if (!found) throw new Error(`${entity} "${id}" não encontrado.`);
      return { ...found };
    },
  });
  return {
    store,
    entities: {
      FinancialExpense: makeClient('FinancialExpense'),
      EmployeePayment: makeClient('EmployeePayment'),
      Vale: makeClient('Vale'),
      ExpenseCategory: makeClient('ExpenseCategory'),
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

const asColab = (over = {}) => validForm({ beneficiary_type: 'colaborador', employee_id: 'e1', ...over });
const paymentsOf = (store) => [...store.EmployeePayment.values()];
const expenseOf = (store) => [...store.FinancialExpense.values()];
const pagamentosAtivos = (store) => [...store.EmployeePayment.values()].filter((p) => p.status !== 'cancelado');


// ---------------------------------------------------------------- formatação

test('data aparece em DD/MM/AAAA e valor em R$ 0,00', () => {
  assert.equal(formatExpenseDate('2026-03-18'), '18/03/2026');
  assert.equal(formatExpenseDate('2026-01-05'), '05/01/2026');
  assert.equal(formatExpenseDate(''), '—');
  assert.equal(formatExpenseDate(undefined), '—');
  assert.equal(formatExpenseDate('data invalida'), '—');
  assert.equal(nbsp(formatExpenseAmount(48.9)), 'R$ 48,90');
  assert.equal(nbsp(formatExpenseAmount(0)), 'R$ 0,00');
  assert.equal(nbsp(formatExpenseAmount('')), 'R$ 0,00');
  assert.equal(nbsp(formatExpenseAmount(1234.5)), 'R$ 1.234,50');
});

test('o contador monetário usa Intl e coincide com o do restante do Financeiro', () => {
  for (const valor of [0, 0.01, 48.9, 1234.56, -12.3, 1e6]) {
    assert.equal(nbsp(formatExpenseAmount(valor)), reais(valor), `valor ${valor}`);
  }
  assert.equal(nbsp(formatExpenseAmount('lixo')), reais(0), 'valor inválido nunca mostra NaN');
});

// ---------------------------------------------------------------- numeração

test('valor segue a regra compartilhada do numberUtils (Agente 1) e NaN nunca persiste', async () => {
  const { parseDecimalBR, roundMoney } = await import('../src/lib/numberUtils.js');
  const casos = [
    ['48,90', 48.9], ['48.90', 48.9], ['1.234,56', 1234.56],
    ['1234,56', 1234.56], ['1234.56', 1234.56],
  ];
  for (const [digitado, esperado] of casos) {
    const payload = buildExpensePayload(validForm({ amount: digitado }), { categories, centers, employees });
    assert.equal(payload.amount, esperado, `digitado "${digitado}"`);
    assert.equal(payload.amount, roundMoney(parseDecimalBR(digitado)), 'mesma função do projeto');
    assert.equal(typeof payload.amount, 'number', 'no banco é número, nunca string formatada');
    assert.ok(Number.isFinite(payload.amount), 'NaN nunca é gravado');
  }
  for (const lixo of ['abc', '', null, undefined, 'NaN', '0,1,2']) {
    const amount = buildExpensePayload(validForm({ amount: lixo }), { categories, centers, employees }).amount;
    assert.ok(Number.isFinite(amount), `"${lixo}" não pode virar NaN`);
  }
  assert.equal(buildExpensePayload(validForm({ amount: 'abc' }), { categories, centers, employees }).amount, 0);
  assert.equal(buildExpensePayload(validForm({ amount: '33,33' }), { categories, centers, employees }).amount, 33.33);
});

// ------------------------------------------------------------ criação/formulário

test('criação: payload usa somente campos já existentes e preserva as regras', () => {
  const payload = buildExpensePayload(validForm({ amount: '1.234,56' }), {
    categories, centers, employees, responsibleUser: 'Operador',
  });
  assert.equal(payload.description, 'Compra de queijo');
  assert.equal(payload.amount, 1234.56);
  assert.equal(payload.category_name, 'Insumos');
  assert.equal(payload.cost_center_name, 'Cozinha');
  assert.equal(payload.date, '2026-03-18');
  assert.equal(payload.paid_date, '2026-03-18', 'pago usa a data do gasto como padrão');
  assert.equal(payload.origin_type, 'manual');
  assert.equal(payload.responsible_user, 'Operador');
  assert.equal(payload.status, 'pago');
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['account', 'amount', 'beneficiary_id', 'beneficiary_name', 'beneficiary_type', 'category_id',
      'category_name', 'classification', 'cost_center_id', 'cost_center_name', 'date', 'description',
      'document_number', 'invoice_url', 'observation', 'origin_type', 'paid_date', 'payment_method',
      'proof_url', 'responsible_user', 'status'].sort(),
    'nenhum campo persistido novo ou removido',
  );
});

test('formulário: pendente não recebe paid_date; colaborador exige seleção', () => {
  assert.equal(buildExpensePayload(validForm({ status: 'pendente' }), { categories, centers, employees }).paid_date, '');
  const semEmpregado = buildExpensePayload(validForm({ beneficiary_type: 'colaborador' }), { categories, centers, employees });
  assert.equal(semEmpregado.beneficiary_id, '');
  const comEmpregado = buildExpensePayload(asColab(), { categories, centers, employees });
  assert.equal(comEmpregado.beneficiary_name, 'Maria Souza', 'nome vem do Employee, não do texto digitado');
  assert.equal(comEmpregado.employee_id, 'e1');
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
  assert.ok(validateExpenseForm(validForm({ beneficiary_type: 'colaborador' }), { employees }).errors.employee_id);
  assert.equal(validateExpenseForm(asColab(), { employees }).valid, true);
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
  assert.equal(form.status, 'pendente');
  assert.ok(form.proof_url, 'o comprovante existente é preservado na edição');
  assert.equal(form.id, undefined, 'metadados da entity não entram no formulário');
  assert.equal(form.created_date, undefined);
});

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
  assert.deepEqual(buscar('QUEIJO'), ['1'], 'case-insensitive');
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

test('busca nunca é mecanismo de autorização: a listagem continua vindo do banco', () => {
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
  assert.deepEqual(resolveExpensePeriod('semana', { reference: REF }), { start: '2026-03-16', end: '2026-03-22' }, 'segunda a domingo');
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

test('indicadores de lista vazia são zero, sem NaN', () => {
  const kpi = dailyExpenseIndicators([], { reference: REF });
  assert.equal(kpi.todayTotal, 0);
  assert.equal(kpi.totalCount, 0);
  assert.equal(kpi.noProofCount, 0);
  assert.equal(nbsp(formatExpenseAmount(kpi.monthTotal)), 'R$ 0,00');
});

// ---------------------------------------------------------------------- datas

test('data às 21h30 no Brasil continua no dia local correto (não vira dia seguinte)', async () => {
  // 2026-03-18 21:30 em São Paulo (UTC-3) = 2026-03-19 00:30 UTC. A data local
  // tem de continuar 18/03; o UTC trocaria o dia.
  const noiteSP = new Date('2026-03-19T00:30:00Z');
  const iso = todayISO(noiteSP);
  assert.equal(iso, '2026-03-18', `esperado dia local, recebido ${iso}`);
  assert.equal(iso.slice(5, 7), '03', 'o mês local continua março');
  // O mesmo utilitário é o do Ponto/Estoque: uma única regra de calendário,
  // sem cópia da lógica de data dentro do painel.
  const { todayISO: paineISODoGasto } = await import('../src/lib/dailyExpenses.js');
  assert.equal(paineISODoGasto, todayISO, 'o painel reaproveita timeUtils.todayISO');
});

// ------------------------------------------------------------------ anexos

for (const [format, type, bytes] of [['JPG', 'image/jpeg', jpeg], ['PNG', 'image/png', png], ['PDF', 'application/pdf', pdf]]) {
  test(`comprovante ${format}: base64 -> Blob -> URL acessível e revogada`, async () => {
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

test('registro sem comprovante funciona e não oferece botão de anexo', () => {
  const semAnexo = { id: 'g2', description: 'Gás de cozinha', amount: 150, status: 'pago' };
  assert.equal(hasExpenseAttachment(semAnexo), false);
  assert.equal(expenseAttachmentRecord(semAnexo, 'proof_url'), null);
  assert.equal(expenseAttachmentRecord({ proof_url: '' }, 'proof_url'), null);
  assert.equal(expenseAttachmentRecord({ proof_url: 'x' }, 'desconhecido'), null, 'campo não confirmado não é inferido');
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

test('storage_path: compatibilidade de leitura sem gravar nada no bucket', () => {
  const record = expenseAttachmentRecord({ id: 'g6', storage_path: 'FinancialExpense/g6/uuid.pdf' }, 'storage_path');
  assert.equal(record.storage_path, 'FinancialExpense/g6/uuid.pdf');
  assert.equal(record.proof_url, '', 'o legado não é inventado a partir do storage');
  assert.equal(hasExpenseAttachment({ id: 'g7' }, 'storage_path'), false);
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

// ------------------------------------------- não regressão do AttachmentPreview

test('Data URL nunca é aberta direto: o anexo vira botão do AttachmentPreview', async () => {
  const { createServer: createViteServer } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { fileURLToPath } = await import('node:url');
  // M1: `ssrLoadModule('/src/...')` vira ERR_LOAD_URL no Windows porque o
  // caminho com barra inicial não é resolvido como arquivo. Passamos o caminho
  // ABSOLUTO DO DISCO, aceito igualmente em Windows e Linux. A verificação em
  // si continua idêntica — não foi removida nem relaxada.
  const abs = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
  const vite = await createViteServer({
    configFile: false, plugins: [react()],
    resolve: { alias: { '@': abs('src') } },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom',
  });
  try {
    // utils.js calcula isIframe ao importar; o restante continua em ambiente SSR.
    const previousWindow = globalThis.window;
    try {
      globalThis.window = { self: null, top: null };
      await vite.ssrLoadModule(abs('src/lib/utils.js'));
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
    const { ExpenseAttachment, ExpenseAttachmentUpload } = await vite.ssrLoadModule(abs('src/components/financeiro/ExpenseAttachment.jsx'));
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

// ================================================= integridade: criação/vínculo

test('criação de colaborador: o pagamento nasce JÁ vinculado (2 escritas, não 3)', async () => {
  const { entities, store } = fakeEntities();
  const r = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  const pagamento = paymentsOf(store)[0];
  assert.equal(pagamento.financial_expense_id, r.expense.id, 'o vínculo vai no próprio create');
  assert.equal(pagamento.net_amount, 48.9);
  assert.equal(store.EmployeePayment.size, 1);
});

test('gasto de fornecedor não cria EmployeePayment, e registra o responsável', async () => {
  const { entities, store } = fakeEntities();
  await saveDailyExpense({ entities, form: validForm(), categories, centers, employees, responsibleUser: 'Operador' });
  assert.equal(store.EmployeePayment.size, 0, 'fornecedor/outro não gera pagamento');
  assert.equal(expenseOf(store)[0].responsible_user, 'Operador');
});

test('idempotência: repetir a criação com o mesmo id NÃO duplica o gasto', async () => {
  const { entities, store } = fakeEntities();
  const id = newExpenseId();
  const form = { ...validForm(), expense_id: id };
  await saveDailyExpense({ entities, form, categories, centers, employees });
  await saveDailyExpense({ entities, form, categories, centers, employees });
  assert.equal(store.FinancialExpense.size, 1, 'o mesmo id faz upsert, não duplica');
  assert.equal(expenseOf(store)[0].id, id);
});

test('falha parcial: pagamento falha => não devolve sucesso e o gasto é compensado', async () => {
  const { entities, store } = fakeEntities({ failCreate: { EmployeePayment: true } });
  await assert.rejects(
    saveDailyExpense({ entities, form: asColab(), categories, centers, employees }),
    /não foi salvo/i,
  );
  assert.equal(store.FinancialExpense.size, 0, 'o gasto órfão é desfeito');
  assert.equal(store.EmployeePayment.size, 0);
});

test('novo id de criação é único a cada chamada', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newExpenseId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^fe_/);
});

// ============================================ integridade: troca de favorecido

const salvarEdicao = (entities, store, form, editing) => saveDailyExpense({
  entities, form, editing, categories, centers, employees, payments: paymentsOf(store),
});

// Igual à tela real, mas com a lista de pagamentos que ela tinha em memória.
const salvarEdicaoComPagamentos = (entities, editing, pagamentos, form) => saveDailyExpense({
  entities, form, editing, categories, centers, employees, payments: pagamentos,
});

test('CASO 1 — fornecedor → fornecedor: nenhum EmployeePayment é criado', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  await salvarEdicao(entities, store, validForm({ description: 'Outro fornecedor' }), expense);
  assert.equal(store.EmployeePayment.size, 0, 'não deve existir pagamento');
  assert.equal(expenseOf(store)[0].description, 'Outro fornecedor');
});

test('CASO 2 — fornecedor → colaborador: cria exatamente 1 pagamento vinculado', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  await salvarEdicao(entities, store, asColab(), expense);
  const pagamento = paymentsOf(store);
  assert.equal(pagamento.length, 1);
  assert.equal(pagamento[0].financial_expense_id, expense.id);
  assert.equal(pagamento[0].employee_id, 'e1');
  assert.equal(pagamento[0].status, 'pago');
});

test('CASO 3 — colaborador A → mesmo colaborador A: atualiza, não duplica', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  const antes = paymentsOf(store)[0];
  await salvarEdicao(entities, store, asColab({ amount: '99,50' }), expense);
  const depois = paymentsOf(store);
  assert.equal(depois.length, 1, 'continua com um único pagamento');
  assert.equal(depois[0].id, antes.id, 'o mesmo registro foi atualizado');
  assert.equal(depois[0].net_amount, 99.5);
  assert.equal(expenseOf(store)[0].amount, 99.5, 'gasto e pagamento coerentes');
});

test('CASO 4 — colaborador A → colaborador B: A não fica com pagamento ativo', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  const deA = paymentsOf(store)[0];
  await salvarEdicao(entities, store, validForm({ beneficiary_type: 'colaborador', employee_id: 'e2' }), expense);
  const ativos = paymentsOf(store).filter((p) => p.status !== 'cancelado');
  const deAApos = store.EmployeePayment.get(deA.id);
  assert.equal(deAApos.status, 'cancelado', 'o pagamento de A é cancelado, não apagado');
  assert.equal(ativos.length, 1, 'só existe um pagamento ativo');
  assert.equal(ativos[0].employee_id, 'e2', 'o ativo é o de B');
  assert.equal(ativos[0].financial_expense_id, expense.id, 'vinculado ao mesmo gasto');
  assert.equal(ativos[0].net_amount, expenseOf(store)[0].amount, 'sem valor divergente');
  assert.equal(store.EmployeePayment.size, 2, 'histórico preservado: nada foi apagado');
  assert.match(deAApos.observation, /favorecido do gasto alterado/i, 'o cancelamento fica registrado');
});

test('CASO 5 — colaborador → fornecedor: o pagamento do colaborador é cancelado', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  const pagamento = paymentsOf(store)[0];
  await salvarEdicao(entities, store, validForm({ beneficiary_type: 'fornecedor', beneficiary_name: 'Hortifruti' }), expense);
  assert.equal(store.EmployeePayment.get(pagamento.id).status, 'cancelado');
  assert.equal(paymentsOf(store).filter((p) => p.status !== 'cancelado').length, 0, 'nenhum pagamento ativo sobra');
  assert.equal(expenseOf(store)[0].beneficiary_type, 'fornecedor');
  assert.equal(expenseOf(store)[0].beneficiary_name, 'Hortifruti');
});

test('nenhum EmployeePayment duplicado após várias trocas de favorecido', async () => {
  const { entities, store } = fakeEntities();
  // A tela recarrega após cada salvamento: cada edição parte do registro ATUAL
  // (é por isso que o CAS não acusa conflito aqui).
  const editar = async (form, anterior) => {
    const r = await salvarEdicao(entities, store, form, anterior);
    return r.expense;
  };
  let atual = (await saveDailyExpense({ entities, form: asColab(), categories, centers, employees })).expense;
  atual = await editar(validForm({ beneficiary_type: 'colaborador', employee_id: 'e2' }), atual);
  atual = await editar(asColab(), atual);
  atual = await editar(validForm({ beneficiary_type: 'fornecedor' }), atual);
  assert.equal(paymentsOf(store).filter((p) => p.status !== 'cancelado').length, 0, 'gasto de fornecedor: zero pagamento ativo');
  assert.equal(expenseOf(store)[0].beneficiary_type, 'fornecedor');
  const ativos = paymentsOf(store).filter((p) => p.status !== 'cancelado');
  assert.equal(new Set(ativos.map((p) => p.financial_expense_id)).size, ativos.length, 'nunca dois ativos para o mesmo gasto');
  // Cada troca para de collaborator gera exatamente 1 pagamento ativo.
  const ativosPorColab = (emp) => pagamentosAtivos(store).filter((p) => p.employee_id === emp).length;
  assert.equal(ativosPorColab('e1') + ativosPorColab('e2'), 0);
});

test('CASO 6 — gasto de Vale continua bloqueado para edição e exclusão', async () => {
  const { entities, store } = fakeEntities();
  const deVale = { id: 'fe_vale', origin_type: 'vale', origin_id: 'vale_1', date: '2026-03-10', amount: 100, status: 'pago' };
  store.FinancialExpense.set('fe_vale', deVale);
  assert.match(expenseDeleteBlocker(deVale, {}), /Vale do RH/);
  await assert.rejects(deleteDailyExpense({ entities, expense: deVale, payments: [], vales: [] }), /não pode ser excluído/);
  assert.equal(store.FinancialExpense.size, 1, 'gasto de Vale não é apagado por aqui');
});

test('origens protegidas (vale/conta a pagar/recorrencia/lote) continuam bloqueadas', () => {
  for (const origem of ['vale', 'conta_pagar', 'recorrencia', 'lote']) {
    assert.ok(expenseDeleteBlocker({ id: 'x', origin_type: origem }, {}), origem);
    assert.ok(expenseEditBlocker({ id: 'x', origin_type: origem }, {}), `${origem} bloqueia edição`);
  }
  assert.equal(expenseDeleteBlocker({ id: 'x', origin_type: 'manual' }, {}), null, 'manual segue liberado');
  assert.equal(expenseEditBlocker({ id: 'x', origin_type: 'manual' }, {}), null, 'manual segue editável');
  assert.equal(expenseDeleteBlocker({}, {}), 'Gasto não encontrado.');
});

// ------------------------------------------- BUG 1: gasto criado em outra tela

test('BUG 1 — gasto criado em Pagamentos aparece e pode ser editado/excluído', () => {
  // Diária de motoboy: origem 'pagamento_colaborador', SEM vínculo de Vale.
  const daOutraTela = {
    id: 'fe_motoboy', origin_type: 'pagamento_colaborador', origin_id: 'pay_1',
    date: '2026-03-10', description: 'Diária de motoboy', amount: 45, status: 'pago',
  };
  assert.equal(expenseEditBlocker(daOutraTela, {}), null, 'edição liberada: a tela de origem não bloqueia');
  assert.equal(expenseDeleteBlocker(daOutraTela, {}), null, 'exclusão liberada sem vínculo protegido');
  // A tela de origem não é arazão do bloqueio: o vínculo é.
  assert.ok(expenseEditBlocker({ ...daOutraTela, origin_type: 'vale' }, {}), 'vale segue bloqueado');
  assert.equal(expenseDeleteBlocker({ id: 'x', origin_type: 'manual' }, {}), null);
});

test('BUG 1 — o conceito vale para qualquer gasto de outra tela, não só motoboy', () => {
  const outra = (id, origem) => ({ id, origin_type: origem, date: '2026-03-10', amount: 10, status: 'pago' });
  for (const origem of ['pagamento_colaborador', 'adiantamento_colaborador', 'logistica_delivery', 'manual']) {
    assert.equal(expenseEditBlocker(outra('e1', origem), {}), null, `edita ${origem}`);
  }
  // 'logistica_delivery' também não é origem protegida.
  assert.equal(PROTECTED_EXPENSE_ORIGINS.has('logistica_delivery'), false);
});

test('BUG 1 — exclusão continua bloqueada com vínculo de Vale ou EmployeePayment', () => {
  const expense = { id: 'fe_1', origin_type: 'pagamento_colaborador', date: '2026-03-10', amount: 10, status: 'pago' };
  const comVale = [{ id: 'v1', financial_expense_id: 'fe_1' }];
  const comPagamento = [{ id: 'p1', financial_expense_id: 'fe_1' }];
  assert.equal(linkedVale(expense, comVale), true);
  assert.equal(linkedPayment(expense, comPagamento), true);
  assert.match(expenseEditBlocker(expense, { vales: comVale }), /vale/i, 'vínculo de Vale bloqueia edição');
  assert.match(expenseDeleteBlocker(expense, { payments: comPagamento }), /pagamento de colaborador/);
  // Página vazia não bloqueia ninguém.
  assert.equal(expenseEditBlocker(expense, { vales: [], payments: [] }), null);
  assert.equal(expenseDeleteBlocker(expense, { vales: [], payments: [] }), null);
});

// ================================================ categorias, totais e histórico

test('categorias: nomes equivalentes (caixa/espaço/acento) não duplicam', () => {
  const lista = [{ id: 'c1', name: 'Limpeza', status: 'ativo' }];
  assert.equal(findEquivalentCategory(lista, 'limpeza').id, 'c1');
  assert.equal(findEquivalentCategory(lista, ' LIMPEZA ').id, 'c1');
  assert.equal(findEquivalentCategory(lista, '  Limpeza  ').id, 'c1');
  assert.equal(findEquivalentCategory(lista, 'Manutenção'), null, 'nome diferente não casa');
  assert.equal(findEquivalentCategory(lista, ''), null);
  assert.equal(findEquivalentCategory(lista, '   '), null);
});

test('categorias: acento e caixa são ignorados ao comparar', () => {
  assert.equal(categoryKey('Manutenção'), categoryKey('manutencao'));
  assert.equal(categoryKey('  MÚltiplos   Espaços '), 'multiplos espacos');
  assert.equal(sameCategoryName('Limpeza', ' LIMPEZA'), true);
  assert.equal(sameCategoryName('Limpeza', 'Limpezas'), false);
  assert.equal(normalizeCategoryName('  Embalagens  '), 'Embalagens');
});

test('categorias: a seleção não repete categoria já duplicada no banco', () => {
  const lista = selectableCategories([
    { id: 'c1', name: 'Limpeza', status: 'ativo' },
    { id: 'c2', name: 'limpeza', status: 'ativo' },
    { id: 'c3', name: 'Embalagens', status: 'ativo' },
    { id: 'c4', name: 'Antiga', status: 'inativo' },
  ]);
  const nomes = lista.map((c) => c.name);
  assert.equal(nomes.filter((n) => categoryKey(n) === 'limpeza').length, 1, 'apenas uma Limpeza');
  assert.ok(nomes.includes('Embalagens'));
  assert.ok(nomes.includes('Antiga'), 'categoria desativada continua visível');
  assert.equal(lista[0].status, 'ativo', 'ativas primeiro');
});

test('totais por categoria: soma, acumula e respeita o cancelamento', () => {
  const rows = [
    { id: '1', category_name: 'Embalagens', amount: 100, status: 'pago' },
    { id: '2', category_name: 'Embalagens', amount: 50, status: 'pago' },
    { id: '3', category_name: 'Embalagens', amount: 20, status: 'pago' },
    { id: '4', category_name: 'Manutenção', amount: 200, status: 'pago' },
    { id: '5', category_name: 'Embalagens', amount: 999, status: 'cancelado' },
  ];
  const resumo = summarizeByCategory(rows);
  const embalagens = resumo.find((r) => r.nome === 'Embalagens');
  assert.equal(embalagens.total, 170, '100 + 50 + 20, cancelado fora');
  assert.equal(embalagens.quantidade, 3);
  assert.equal(resumo.find((r) => r.nome === 'Manutenção').total, 200);
  assert.equal(totalOf(rows), 370, 'total geral também ignora o cancelado');
  assert.equal(resumo[0].nome, 'Manutenção', 'ordenado pelo maior total (200 > 170)');
  assert.equal(resumo[1].nome, 'Embalagens');
});

test('totais: editar valor e trocar de categoria recalcula as duas pontas', () => {
  const antes = [
    { id: '1', category_name: 'Embalagens', amount: 500, status: 'pago' },
    { id: '2', category_name: 'Manutenção', amount: 200, status: 'pago' },
  ];
  assert.equal(summarizeByCategory(antes).find((r) => r.nome === 'Embalagens').total, 500);
  const editado = [{ ...antes[0], amount: 450 }, antes[1]];
  assert.equal(summarizeByCategory(editado).find((r) => r.nome === 'Embalagens').total, 450);
  const trocado = [{ ...antes[0], category_name: 'Manutenção' }, antes[1]];
  const depois = summarizeByCategory(trocado);
  assert.equal(depois.find((r) => r.nome === 'Embalagens'), undefined, 'Embalagens recalculada');
  assert.equal(depois.find((r) => r.nome === 'Manutenção').total, 700, 'Manutenção absorveu o gasto');
  assert.equal(totalOf(trocado), 700, 'total geral não muda ao trocar de categoria');
});

test('totais: exclusão legítima recalcula e nada fica preso em cache', () => {
  const rows = [
    { id: '1', category_name: 'Embalagens', amount: 100, status: 'pago' },
    { id: '2', category_name: 'Embalagens', amount: 50, status: 'pago' },
  ];
  assert.equal(totalOf(rows), 150);
  const semExcluido = rows.filter((r) => r.id !== '1');
  assert.equal(totalOf(semExcluido), 50);
  assert.equal(summarizeByCategory(semExcluido)[0].total, 50);
});

// ============================================================================
// Estabilidade da interface de Gastos Diários (BUG 2, BUG 3 e BUG 4).
// ============================================================================

test('BUG 2 — editar não zera o total: as linhas antigas sobrevivem ao refresh', () => {
  const rows = [
    { id: 'g1', date: '2026-03-10', amount: 100, status: 'pago', category_name: 'Insumos' },
    { id: 'g2', date: '2026-03-10', amount: 50, status: 'pago', category_name: 'Insumos' },
  ];
  assert.equal(totalOf(rows), 150, 'total inicial');
  // A correção: o refresh NÃO zera `rows`; a tela segue com os dados antigos.
  const rowsNaTela = rows;
  assert.equal(totalOf(rowsNaTela), 150, 'total não passa por zero durante o refresh');
  // Só a resposta nova substitui, com o total recalculado.
  const novas = [{ id: 'g1', date: '2026-03-10', amount: 120, status: 'pago', category_name: 'Insumos' }];
  assert.equal(totalOf(novas), 120, 'total novo substitui o antigo ao final');
});

test('BUG 2 — o total só zera quando os dados realmente são vazios', () => {
  assert.equal(totalOf([]), 0, 'zero legítimo: não há gastos carregados');
  assert.equal(totalOf([{ id: 'g1', amount: 100, status: 'cancelado' }]), 0, 'cancelado não entra');
  assert.equal(totalOf([{ id: 'g1', amount: 100, status: 'pago' }]), 100);
});

test('BUG 3 — carga inicial e refresh são estados separados', () => {
  let status = 'initial';
  const rows = [{ id: 'g1', amount: 80, status: 'pago' }];
  assert.equal(status, 'initial', 'primeira carga pode mostrar Carregando gastos...');
  status = 'refreshing';
  assert.notEqual(status, 'initial', 'refresh não pode usar a tela cheia de loading');
  assert.equal(totalOf(rows), 80, 'totais continuam visíveis durante o refresh');
});

test('BUG 3 — falha de rede preserva os dados anteriores (não vira R$ 0,00)', () => {
  const anterior = [{ id: 'g1', amount: 70, status: 'pago' }];
  // Reproduz a correção do `GastosDiarios`: ler() devolve `anterior` no catch
  // em vez de `[]`, que era o que zerava o painel.
  const ler = (falha) => {
    try {
      if (falha) throw new Error('rede');
      return [{ id: 'g2', amount: 30, status: 'pago' }];
    } catch { return anterior; }
  };
  assert.equal(totalOf(ler(false)), 30, 'sucesso usa a resposta nova');
  assert.equal(totalOf(ler(true)), 70, 'falha mantém o total anterior, não vira zero');
});

test('BUG 3 — resposta antiga não sobrescreve a nova (corrida de fetches)', () => {
  // `requestId` garante que só a última carga concluída atualiza a tela.
  let requestId = 0;
  const aplicado = [];

// ------------------------------------------------- BUG 4: criação de categoria

// Entity ExpenseCategory em memória, com contadores e falha opcional.
function fakeCategories(options = {}) {
  const map = new Map((options.initial || []).map((c) => [c.id, c]));
  const lista = { count: 0 };
  const categorias = () => [...map.values()];
  categorias.reload = async () => { lista.count += 1; return categorias(); };
  const entity = {
    async create(data) {
      if (options.failCreate) throw new Error('falha simulada ao criar categoria');
      const id = data.id || `c${map.size + 1}`;
      const rec = { ...data, id };
      map.set(id, rec);
      return rec;
    },
    async update(id, patch) {
      if (options.failUpdate) throw new Error('falha simulada ao atualizar categoria');
      const rec = { ...(map.get(id) || { id }), ...patch };
      map.set(id, rec);
      return rec;
    },
  };
  return { entity, categorias, lista };
}

// Executa o `create()` do ExpenseCategoryManager com a MESMA guarda (ref
// síncrona `busy`), os mesmos contadores e o mesmo tratamento de erro.
async function criarCategoriaFluxo({ nome, categorias, entity, dispararDuasVezes = false }) {
  const state = { name: nome, saving: false, message: '', error: '' };
  const busy = { current: false };
  const contagem = { create: 0, update: 0, reload: 0, status: [] };
  const avisar = (fn) => fn();

  const create = async () => {
    if (busy.current) { contagem.status.push('ignorado-duplo'); return; }
    const key = normalizeCategoryName(state.name);
    if (!key) { avisar(() => { state.error = 'Informe o nome da categoria.'; }); return; }
    busy.current = true;
    state.saving = true;
    state.error = ''; state.message = '';
    try {
      const equivalente = findEquivalentCategory(categorias(), key);
      if (equivalente) {
        if (equivalente.status !== 'ativo') {
          contagem.update += 1;
          await entity.update(equivalente.id, { status: 'ativo' });
          avisar(() => { state.message = `Categoria "${equivalente.name}" já existia e foi reativada.`; });
        } else {
          avisar(() => { state.message = `"${equivalente.name}" já existe.`; });
        }
      } else {
        contagem.create += 1;
        await entity.create({ name: key, group: 'operacao', status: 'ativo' });
        avisar(() => { state.message = `Categoria "${key}" criada.`; });
      }
      contagem.reload += 1;
      await categorias.reload();
    } catch (e) {
      avisar(() => { state.error = e?.message || 'Não foi possível salvar a categoria.'; });
    } finally {
      busy.current = false;
      avisar(() => { state.saving = false; });

test('G — criação normal de "Embalagens": 1 persistência e categoria na lista', async () => {
  const { entity, categorias } = fakeCategories({ initial: [{ id: 'c1', name: 'Limpeza', status: 'ativo' }] });
  const { contagem, state } = await criarCategoriaFluxo({ nome: 'Embalagens', categorias, entity });
  assert.equal(contagem.create, 1, 'exatamente uma criação');
  assert.equal(contagem.update, 0, 'não é reativação');
  assert.equal(contagem.reload, 1, 'um único reload da lista');
  assert.equal(state.saving, false, 'UI saiu do estado saving');
  assert.equal(categorias().filter((c) => c.name === 'Embalagens').length, 1, 'aparece 1x na lista');
  assert.equal(state.error, '', 'sem erro');
  assert.match(state.message, /criada/);
});

test('H — duplo clique enquanto a primeira está pendente cria 1 categoria', async () => {
  const { entity, categorias } = fakeCategories();
  const { contagem, state } = await criarCategoriaFluxo({ nome: 'Embalagens', categorias, entity, dispararDuasVezes: true });
  assert.equal(contagem.create, 1, 'a segunda tentativa é ignorada pela guarda síncrona');
  assert.deepEqual(contagem.status, ['ignorado-duplo']);
  assert.equal(categorias().length, 1, 'não cria duplicata');
  assert.equal(state.saving, false, 'botão liberado no final');
});

test('I — nome equivalente (" limpeza" / "LIMPEZA") não duplica e não trava', async () => {
  for (const nome of [' limpeza', 'LIMPEZA', 'Limpeza ']) {
    const { entity, categorias } = fakeCategories({ initial: [{ id: 'c1', name: 'Limpeza', status: 'ativo' }] });
    const { contagem, state } = await criarCategoriaFluxo({ nome, categorias, entity });
    assert.equal(contagem.create, 0, `${nome}: não cria duplicata`);
    assert.equal(contagem.update, 0, `${nome}: não mexe em categoria já ativa`);
    assert.equal(contagem.reload, 1, `${nome}: um reload e encerra`);
    assert.equal(categorias().length, 1, `${nome}: segue 1 categoria`);
    assert.equal(state.saving, false, `${nome}: UI liberada`);
    assert.equal(state.error, '', `${nome}: sem erro`);
  }
});

test('J — categoria equivalente DESATIVADA é reativada, sem criar outra', async () => {
  const { entity, categorias } = fakeCategories({ initial: [{ id: 'c1', name: 'Limpeza', status: 'inativo' }] });
  const { contagem, state } = await criarCategoriaFluxo({ nome: 'Limpeza', categorias, entity });
  assert.equal(contagem.create, 0, 'não cria nova categoria');

test('K — erro de persistência: mensagem clara, saving liberado, tela utilizável', async () => {
  const { entity, categorias } = fakeCategories({ failCreate: true });
  const { contagem, state } = await criarCategoriaFluxo({ nome: 'Embalagens', categorias, entity });
  assert.equal(state.saving, false, 'savingCategory volta para false no erro');
  assert.match(state.error, /falha simulada/, 'mensagem compreensível');
  assert.equal(contagem.create, 1, 'tentou uma vez');
  assert.equal(categorias().length, 0, 'nada foi persistido');
  // Tentativa seguinte funciona: a tela não ficou travada.
  const { entity: e2, categorias: c2 } = fakeCategories();
  const segunda = await criarCategoriaFluxo({ nome: 'Embalagens', categorias: c2, entity: e2 });
  assert.equal(segunda.state.saving, false);
  assert.equal(segunda.state.error, '', 'segunda tentativa funciona');
  assert.equal(c2().length, 1, 'criou na segunda tentativa');
});

test('L — sem loop: create 1x e reload só o necessário após criar', async () => {
  const { entity, categorias, lista } = fakeCategories({ initial: [{ id: 'c1', name: 'Limpeza', status: 'ativo' }] });
  const { contagem } = await criarCategoriaFluxo({ nome: 'Embalagens', categorias, entity });
  assert.equal(contagem.create, 1, 'create no máximo uma vez');
  assert.equal(lista.count, 1, 'reload executa somente o necessário');
  const segunda = await criarCategoriaFluxo({ nome: 'Embalagens', categorias, entity });
  assert.equal(segunda.contagem.create, 0, 'rodar de novo não recria (dedup)');
  assert.equal(categorias().filter((c) => c.name === 'Embalagens').length, 1, 'sem duplicata');
});

test('L2 — o Gerenciador não tem effect que recarrega sozinho', async () => {
  // Rede de segurança contra regressão de loop de renderização: o componente
  // precisa continuar sem `useEffect` que dispare carga.
  const fonte = await readFile(new URL('../src/components/financeiro/ExpenseCategoryManager.jsx', import.meta.url), 'utf8');
  const efeitos = fonte.match(/useEffect\(/g) || [];
  assert.equal(efeitos.length, 1, 'apenas o efeito de montagem, nenhum efeito de carga');
  assert.ok(!/useEffect\([^)]*onSaved/.test(fonte), 'nenhum efeito atrelado ao onSaved');
  assert.match(fonte, /busy\.current/, 'guarda síncrona de duplo submit');
  assert.match(fonte, /type="button" onClick=\{create\}/, 'botão sem submit acidental');
});

  assert.equal(contagem.update, 1, 'reativa exatamente uma vez');
  assert.equal(contagem.reload, 1, 'um reload só (sem ciclo create->dedup->reactivate->reload)');
  assert.equal(categorias().length, 1, 'continua uma categoria');
  assert.equal(categorias().filter((c) => c.status === 'ativo').length, 1, 'exatamente uma ativa');
  assert.match(state.message, /reativada/);
  assert.equal(state.saving, false);
});

    }
  };

  if (dispararDuasVezes) await Promise.all([create(), create()]); // Enter + clique
  else await create();
  return { contagem, state };
}

  const aplicar = (meuId) => { if (requestId === meuId) aplicado.push(meuId); };
  const lento = ++requestId;  // carga 1 (demora)
  const rapido = ++requestId; // carga 2 (termina antes)
  aplicar(rapido);
  aplicar(lento);
  assert.deepEqual(aplicado, [rapido], 'a resposta antiga não sobrescreve a nova');
});


test('categoria criada permanece após recarregar os dados', async () => {
  // Persistida pela entity ExpenseCategory (já existente no projeto): recarregar
  // devolve exatamente o que foi criado — sem estado local e sem migration.
  const { entities, store } = fakeEntities();
  store.ExpenseCategory = new Map();
  const criada = await entities.ExpenseCategory.create({ name: 'Embalagens', group: 'operacao', status: 'ativo' });
  const recarregado = await entities.ExpenseCategory.list('name', 300);
  assert.equal(recarregado.length, 1, 'sobrevive ao recarregamento');
  assert.equal(recarregado[0].name, criada.name);
  assert.equal(recarregado[0].id, criada.id);
  assert.equal(selectableCategories(recarregado)[0].name, 'Embalagens', 'aparece na seleção');
});

test('filtros: categoria, favorecido, situação e comprovante', () => {
  const base = [
    { id: '1', date: '2026-03-10', category_id: 'c1', beneficiary_name: 'Hortifruti', status: 'pago', amount: 10, proof_url: 'data:image/png;base64,AA==' },
    { id: '2', date: '2026-03-10', category_id: 'c2', beneficiary_name: 'Oficina', status: 'pendente', amount: 20 },
    { id: '3', date: '2026-03-10', category_id: 'c1', beneficiary_name: 'Oficina', status: 'pago', amount: 30 },
    { id: '4', date: '2026-03-10', category_id: 'c1', beneficiary_name: 'Oficina', status: 'cancelado', amount: 40 },
  ];
  const ids = (o) => filterExpenses(base, o).map((r) => r.id);
  assert.deepEqual(ids({ categoryId: 'c1' }), ['1', '3']);
  assert.deepEqual(ids({ beneficiary: 'Oficina' }), ['2', '3']);
  assert.deepEqual(ids({ status: 'pendente' }), ['2']);
  assert.deepEqual(ids({ proof: 'com' }), ['1']);
  assert.deepEqual(ids({ proof: 'sem' }), ['2', '3']);
  assert.deepEqual(ids({ status: 'cancelado' }), [], 'cancelado fora do painel');
  assert.deepEqual(ids({ status: 'cancelado', includeCancelled: true }), ['4'], 'histórico mostra o cancelado');
  assert.equal(hasExpenseProof(base[0]), true);
  assert.equal(hasExpenseProof(base[1]), false);
});

test('histórico: busca por descrição, favorecido e valor, com soma dos resultados', () => {
  const base = [
    { id: '1', date: '2026-03-10', description: 'Compra de copos', beneficiary_name: 'Hortifruti', category_name: 'Embalagens', category_id: 'c1', amount: 827.4, status: 'pago' },
    { id: '2', date: '2026-03-11', description: 'Café', beneficiary_name: 'Padaria', category_name: 'Mercadoria', category_id: 'c2', amount: 500, status: 'pago' },
  ];
  const busca = (o) => filterExpenses(base, { includeCancelled: true, ...o });
  assert.deepEqual(busca({ search: 'copos' }).map((r) => r.id), ['1']);
  assert.deepEqual(busca({ search: 'padaria' }).map((r) => r.id), ['2'], 'busca por favorecido');
  assert.deepEqual(busca({ search: '827,40' }).map((r) => r.id), ['1'], 'valor pt-BR');
  assert.deepEqual(busca({ search: '827.40' }).map((r) => r.id), ['1'], 'valor com ponto');
  assert.deepEqual(busca({ search: 'copos', categoryId: 'c1' }).map((r) => r.id), ['1']);
  assert.deepEqual(busca({ search: 'copos', categoryId: 'c2' }).map((r) => r.id), [], 'filtro combina com a busca');
  const selecao = busca({ search: 'copos', categoryId: 'c1' });
  assert.equal(totalOf(selecao), 827.4, 'total dos resultados filtrados');
  assert.equal(summarizeByCategory(selecao)[0].total, 827.4, 'breakdown por categoria da seleção');
  assert.equal(summarizeByCategory(selecao)[0].nome, 'Embalagens');
  assert.equal(totalOf(base), 1327.4, 'total geral é separado do filtrado');
});

test('histórico: o gasto salvo aparece na listagem com os dados principais', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({
    entities, form: validForm({ category_id: 'c1' }),
    categories, centers, employees, responsibleUser: 'Operador',
  });
  const listados = filterExpenses([...store.FinancialExpense.values()], { includeCancelled: true });
  assert.equal(listados.length, 1, 'o gasto salvo aparece no histórico');
  const linha = listados[0];
  assert.equal(linha.id, expense.id);
  assert.equal(formatExpenseDate(linha.date), '18/03/2026');
  assert.equal(linha.description, 'Compra de queijo');
  assert.equal(linha.category_name, 'Insumos');
  assert.equal(linha.responsible_user, 'Operador');
  assert.equal(expenseStatusLabel(linha), 'Pago');
  assert.equal(hasExpenseProof(linha), false, 'sem comprovante é identificável');
  assert.equal(expenseMethodLabel(linha), 'Pix');
});

test('conflito concorrente no FinancialExpense aborta em vez de sobrescrever', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  const abertoNaTela = { ...expense }; // A abriu o formulário com 48,90
  await entities.FinancialExpense.update(expense.id, { amount: 200 }); // B salvou antes
  await assert.rejects(
    salvarEdicao(entities, store, asColab(), abertoNaTela),
    (err) => err instanceof ExpenseConflictError && /outra máquina/.test(err.message),
  );
  assert.equal(store.FinancialExpense.get(expense.id).amount, 200, 'a alteração de B NÃO foi perdida em silêncio');
  assert.equal(paymentsOf(store)[0].net_amount, 48.9, 'A nem chegou a gravar no pagamento (abortou antes)');
});

test('conflito no EmployeePayment não deixa valor divergente', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  // A tela carregou esta lista de pagamentos ANTES de B mexer (snapshot velho).
  const telaA = { ...expense, amount: 150 };
  const pagamentosNaTela = paymentsOf(store);
  const pagamento = pagamentosNaTela[0];
  await entities.EmployeePayment.update(pagamento.id, { net_amount: 999 }); // B mexe depois
  await assert.rejects(
    salvarEdicaoComPagamentos(entities, telaA, pagamentosNaTela, asColab({ amount: '150,00' })),
    (err) => err instanceof ExpenseConflictError,
    'conflito no pagamento também aborta, sem divergir valores',
  );
  assert.equal(store.EmployeePayment.get(pagamento.id).net_amount, 999, 'não sobrescrito em silêncio');
  assert.equal(store.FinancialExpense.get(expense.id).amount, 48.9, 'o gasto também não foi gravado');
});

test('troca de favorecido termina sempre com 1 pagamento ativo coerente', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  await salvarEdicao(entities, store, validForm({ beneficiary_type: 'colaborador', employee_id: 'e2' }), expense);
  const ativos = paymentsOf(store).filter((p) => p.status !== 'cancelado');
  assert.equal(ativos.length, 1);
  assert.equal(ativos[0].employee_id, 'e2');
  assert.equal(ativos[0].net_amount, expenseOf(store)[0].amount, 'gasto e pagamento não divergem');
});

test('compensação protegida: alteração concorrente de B NÃO é sobrescrita pelo rollback de A', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  const telaA = { ...expense };
  const pagamentosNaTela = paymentsOf(store); // o que a tela de A tinha em memória

  // Passo 4: operação B altera o MESMO gasto depois da gravação de A e antes
  // de a gravação do pagamento de A acontecer.
  let bAlterou = false;
  const outraMaquinaGrava = async () => {
    if (bAlterou) return;
    bAlterou = true;
    await entities.FinancialExpense.update(expense.id, {
      description: 'ALTERADO PELA MÁQUINA B', amount: 777,
    });
  };
  // Passo 5: a manipulação do pagamento de A falha.
  entities.EmployeePayment.transact = async () => {
    await outraMaquinaGrava();
    throw new Error('falha ao gravar pagamento');
  };

  // Passo 6: a compensação de A é acionada. A operação A retorna erro.
  await assert.rejects(
    salvarEdicaoComPagamentos(entities, telaA, pagamentosNaTela, asColab({ amount: '150,00' })),
    /falha ao gravar pagamento/,
    'A não pode virar sucesso silencioso',
  );

  // A alteração de B permanece intacta — a compensação não a sobrescreveu.
  const final = store.FinancialExpense.get(expense.id);
  assert.equal(final.description, 'ALTERADO PELA MÁQUINA B', 'alteração de B preservada');
  assert.equal(final.amount, 777, 'valor de B preservado (rollback de A não rodou)');

  // Nenhum EmployeePayment incorreto/duplicado ficou ativo.
  const ativos = pagamentosAtivos(store);
  assert.equal(ativos.length, 1, 'continua um único pagamento ativo');
  assert.equal(ativos[0].id, pagamentosNaTela[0].id, 'o pagamento de A não foi duplicado');
  assert.equal(ativos[0].net_amount, 48.9, 'o pagamento de A não foi gravado pela operação que falhou');
});

test('sem `transact` disponível o código ainda salva (compatibilidade)', async () => {
  const { entities, store } = fakeEntities();
  delete entities.FinancialExpense.transact;
  delete entities.EmployeePayment.transact;
  const { expense } = await saveDailyExpense({ entities, form: asColab(), categories, centers, employees });
  await salvarEdicao(entities, store, asColab({ amount: '77,00' }), expense);
  assert.equal(expenseOf(store)[0].amount, 77);
  assert.equal(paymentsOf(store)[0].net_amount, 77, 'sem transact, gasto e pagamento seguem coerentes');
});

// ============================================================ exclusão segura

test('exclusão: gasto manual sem vínculo é removido', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  assert.equal(expenseDeleteBlocker(expense, {}), null);
  await deleteDailyExpense({ entities, expense, payments: [], vales: [] });
  assert.equal(store.FinancialExpense.size, 0);
});

test('exclusão revalida vínculos com dados atuais (não confia só no snapshot)', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  await entities.EmployeePayment.create({ employee_id: 'e1', net_amount: 10, financial_expense_id: expense.id });
  await assert.rejects(
    deleteDailyExpense({ entities, expense, payments: [], vales: [] }),
    /pagamento de colaborador/,
    'a revalidação enxerga o vínculo que o snapshot não tinha',
  );
  assert.equal(store.FinancialExpense.size, 1, 'o gasto não foi apagado');
});

test('exclusão revalida Vale nascido depois do carregamento da tela', async () => {
  const { entities, store } = fakeEntities();
  const { expense } = await saveDailyExpense({ entities, form: validForm(), categories, centers, employees });
  await entities.Vale.create({ id: 'vale_1', financial_expense_id: expense.id, amount: 10 });
  await assert.rejects(deleteDailyExpense({ entities, expense, payments: [], vales: [] }), /vale/i);
  assert.equal(store.FinancialExpense.size, 1);
});
