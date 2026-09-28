// Regras do painel FINANCEIRO -> GASTOS DIÁRIOS.
//
// Tudo aqui é puro e sem React para poder ser testado isoladamente. Nenhum
// campo persistido novo foi criado: o painel usa exatamente o que a entidade
// `FinancialExpense` já gravava (date, description, classification,
// category_id/name, cost_center_id/name, beneficiary_*, amount, payment_method,
// account, document_number, proof_url, invoice_url, status, observation,
// origin_type/id, responsible_user).
//
// Regras de negócio herdadas do Financeiro.jsx e preservadas aqui:
// - gasto manual NÃO mexe em estoque, compras, contas a pagar nem CashMovement;
// - quando o favorecido é um colaborador, o gasto também gera um
//   EmployeePayment e os dois ficam ligados pelo campo
//   `EmployeePayment.financial_expense_id`;
// - gastos com `origin_type` diferente de 'manual' (ex.: 'vale') são gerados por
//   outras telas e nunca devem ser editados/excluídos por aqui.

export const EXPENSE_CLASS_LABELS = {
  despesa_operacional: 'Despesa operacional', compra_insumo: 'Compra de insumo', pagamento_colaborador: 'Pagamento de colaborador',
  adiantamento_colaborador: 'Vale/adiantamento', manutencao: 'Manutenção', taxa_imposto: 'Taxa/Imposto',
  conta_fixa: 'Conta fixa', logistica_delivery: 'Logística/Delivery', outros: 'Outros',
};

export const EXPENSE_METHOD_LABELS = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_debito: 'Cartão débito', cartao_credito: 'Cartão crédito', transferencia: 'Transferência', boleto: 'Boleto', outro: 'Outro' };

export const EXPENSE_STATUS_LABELS = { pago: 'Pago', pendente: 'Pendente' };

export const EXPENSE_BENEFICIARY_LABELS = { fornecedor: 'Fornecedor', colaborador: 'Colaborador', outro: 'Outro' };

// Origens conhecidas. Só 'manual' é editável/excluível neste painel.
export const EXPENSE_ORIGIN_LABELS = {
  manual: 'Lançamento manual',
  vale: 'Vale do RH',
  pagamento_colaborador: 'Pagamento de colaborador',
};

export const EXPENSE_PERIOD_PRESETS = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'semana', label: 'Esta semana' },
  { key: 'mes', label: 'Este mês' },
  { key: 'personalizado', label: 'Personalizado' },
  { key: 'todos', label: 'Tudo' },
];

export const todayISO = (reference = new Date()) => {
  const d = reference instanceof Date ? reference : new Date(reference);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// Datas gravadas pelo app são 'YYYY-MM-DD' (string). Formatamos sem passar por
// Date para não sofrer o deslocamento de fuso do construtor com meia-noite.
export function formatExpenseDate(value) {
  const raw = String(value ?? '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatExpenseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export const isCancelledExpense = (expense) => expense?.status === 'cancelado';

export function expenseCategoryLabel(expense = {}) {
  return expense.category_name || EXPENSE_CLASS_LABELS[expense.classification] || 'Sem categoria';
}

export function expenseMethodLabel(expense = {}) {
  return EXPENSE_METHOD_LABELS[expense.payment_method] || expense.payment_method || '—';
}

export function expenseStatusLabel(expense = {}) {
  return EXPENSE_STATUS_LABELS[expense.status] || expense.status || '—';
}

// A busca ignora acentos e maiúsculas para que "manutencao" encontre
// "Manutenção". Sem acento no texto digitado o funcionário erra menos.
export function normalizeExpenseText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Campos buscáveis: descrição, categoria, fornecedor/colaborador e responsável.
export function expenseSearchIndex(expense = {}) {
  return normalizeExpenseText([
    expense.description, expense.category_name, expense.classification,
    expense.beneficiary_name, expense.beneficiary_type,
    expense.cost_center_name, expense.responsible_user, expense.observation,
  ].filter(Boolean).join(' '));
}

// Todos os termos digitados precisam aparecer (busca por múltiplas palavras).
export function expenseMatchesSearch(expense, term) {
  const query = normalizeExpenseText(term);
  if (!query) return true;
  const index = expenseSearchIndex(expense);
  return query.split(/\s+/).filter(Boolean).every((word) => index.includes(word));
}

function inRange(value, start, end) {
  const date = String(value ?? '').slice(0, 10);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export function filterExpenses(rows = [], { search = '', start = '', end = '', categoryId = '', paymentMethod = '' } = {}) {
  return rows.filter((expense) => {
    if (isCancelledExpense(expense)) return false;
    if (!inRange(expense.date, start, end)) return false;
    if (categoryId && expense.category_id !== categoryId) return false;
    if (paymentMethod && expense.payment_method !== paymentMethod) return false;
    return expenseMatchesSearch(expense, search);
  });
}

export function monthStartISO(reference = new Date()) {
  const iso = todayISO(reference);
  return iso ? `${iso.slice(0, 7)}-01` : '';
}

export function weekStartISO(reference = new Date()) {
  const iso = todayISO(reference);
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // a semana começa na segunda
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

export function weekEndISO(reference = new Date()) {
  const iso = todayISO(reference);
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (6 - ((d.getUTCDay() + 6) % 7)));
  return d.toISOString().slice(0, 10);
}

export function resolveExpensePeriod(preset = 'mes', { start, end, reference = new Date() } = {}) {
  const today = todayISO(reference);
  if (preset === 'hoje') return { start: today, end: today };
  if (preset === 'semana') return { start: weekStartISO(reference), end: weekEndISO(reference) };
  if (preset === 'personalizado') return { start: start || '', end: end || '' };
  if (preset === 'todos') return { start: '', end: '' };
  return { start: monthStartISO(reference), end: today };
}

// Indicadores calculados SEMPRE sobre todos os gastos válidos já carregados,
// nunca sobre o resultado da busca: assim o número não "salta" conforme o
// funcionário digita. Itens cancelados nunca entram na soma.
export function dailyExpenseIndicators(rows = [], { reference = new Date() } = {}) {
  const today = todayISO(reference);
  const month = today ? today.slice(0, 7) : '';
  const valid = rows.filter((expense) => !isCancelledExpense(expense));
  const sum = (list) => list.reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
  const todayRows = valid.filter((expense) => String(expense.date ?? '').slice(0, 10) === today);
  const monthRows = valid.filter((expense) => String(expense.date ?? '').slice(0, 7) === month);
  const paid = valid.filter((expense) => expense.status === 'pago');
  return {
    todayTotal: sum(todayRows),
    todayCount: todayRows.length,
    monthTotal: sum(monthRows),
    monthCount: monthRows.length,
    totalCount: valid.length,
    totalSum: sum(valid),
    noProofCount: paid.filter((expense) => !expense.proof_url && !expense.storage_path).length,
  };
}


export function emptyExpenseForm(reference = new Date()) {
  const today = todayISO(reference);
  return {
    date: today, paid_date: today, description: '', classification: 'despesa_operacional',
    category_id: '', cost_center_id: '', beneficiary_type: 'outro', beneficiary_name: '',
    employee_id: '', amount: '', payment_method: 'pix', account: '', document_number: '',
    proof_url: '', invoice_url: '', status: 'pago', observation: '',
  };
}

// Preenche o formulário a partir de um gasto já gravado, sem arrastar
// metadados da entidade (id/created_date) para dentro do formulário.
export function expenseToForm(expense = {}, reference = new Date()) {
  const base = emptyExpenseForm(reference);
  const form = { ...base };
  for (const key of Object.keys(base)) {
    if (expense[key] !== undefined && expense[key] !== null) form[key] = expense[key];
  }
  form.amount = expense.amount === undefined || expense.amount === null ? '' : String(expense.amount);
  form.paid_date = expense.paid_date || expense.date || base.paid_date;
  if (expense.beneficiary_id && !expense.employee_id) form.employee_id = expense.beneficiary_id;
  if (!expense.beneficiary_type) form.beneficiary_type = expense.beneficiary_id ? 'colaborador' : 'outro';
  return form;
}

export function validateExpenseForm(form = {}, { employees = [] } = {}) {
  const errors = {};
  const description = String(form.description ?? '').trim();
  const amount = parseExpenseAmount(form.amount);
  if (!description) errors.description = 'Descreva o gasto.';
  if (!form.date) errors.date = 'Informe a data do gasto.';
  if (amount <= 0) errors.amount = 'Informe um valor maior que zero.';
  if (form.beneficiary_type === 'colaborador') {
    const employee = employees.find((emp) => emp.id === form.employee_id);
    if (!employee) errors.employee_id = 'Selecione o colaborador.';
  }
  if (form.status === 'pago' && !form.paid_date) errors.paid_date = 'Informe a data do pagamento.';
  return { valid: Object.keys(errors).length === 0, errors };
}

// Monta o registro exatamente no formato já usado pelo Financeiro.jsx antes
// desta mudança: nenhum campo novo e nenhum campo removido.
// Aceita o que o funcionário digita: "48,90", "1.234,56" ou "1234.56".
const parseExpenseAmount = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function buildExpensePayload(form = {}, { categories = [], centers = [], employees = [], responsibleUser = '' } = {}) {
  const amount = parseExpenseAmount(form.amount);
  const category = categories.find((item) => item.id === form.category_id);
  const center = centers.find((item) => item.id === form.cost_center_id);
  const employee = form.beneficiary_type === 'colaborador'
    ? employees.find((item) => item.id === form.employee_id)
    : null;
  const paidDate = form.status === 'pago' ? (form.paid_date || form.date) : '';
  const payload = {
    date: form.date,
    paid_date: paidDate,
    description: String(form.description ?? '').trim(),
    classification: form.classification || 'despesa_operacional',
    category_id: form.category_id || '',
    category_name: category?.name || '',
    cost_center_id: form.cost_center_id || '',
    cost_center_name: center?.name || '',
    beneficiary_type: form.beneficiary_type || 'outro',
    beneficiary_id: employee?.id || '',
    beneficiary_name: employee ? employee.name : (form.beneficiary_name || ''),
    amount,
    payment_method: form.payment_method || 'pix',
    account: form.account || '',
    document_number: form.document_number || '',
    proof_url: form.proof_url || '',
    invoice_url: form.invoice_url || '',
    status: form.status || 'pago',
    observation: form.observation || '',
  };
  if (employee) payload.employee_id = employee.id;
  if (!form.origin_type) payload.origin_type = 'manual';
  if (responsibleUser) payload.responsible_user = responsibleUser;
  return payload;
}

function employeePaymentTypeFor(classification) {
  return classification === 'adiantamento_colaborador' ? 'adiantamento' : 'outros';
}

function linkedPaymentPatch(payload, employee) {
  return {
    employee_id: employee.id,
    employee_name: employee.name,
    sector: employee.sector || '',
    function: employee.function || '',
    payment_type: employeePaymentTypeFor(payload.classification),
    reference_start: payload.date,
    reference_end: payload.date,
    work_date: payload.date,
    days_quantity: 1,
    daily_rate: 0,
    gross_amount: payload.amount,
    discount_amount: 0,
    net_amount: payload.amount,
    payment_date: payload.paid_date || payload.date,
    payment_method: payload.payment_method,
    status: payload.status,
    proof_url: payload.proof_url,
    observation: payload.observation,
  };
}

// Cria/atualiza o gasto e mantém o EmployeePayment vinculado em sincronia.
// Não toca em CashMovement, AccountsPayable, Purchase nem StockMovement: o
// gasto diário não gera movimentação financeira automática nesta etapa.
export async function saveDailyExpense({ entities, form, editing = null, categories = [], centers = [], employees = [], responsibleUser = '', payments = [] }) {
  const payload = buildExpensePayload(form, { categories, centers, employees, responsibleUser });
  const employee = payload.beneficiary_id
    ? employees.find((item) => item.id === payload.beneficiary_id)
    : null;

  if (editing?.id) {
    // `origin_type`/`origin_id` não mudam na edição: o registro continua
    // pertencendo à tela que o criou.
    const patch = { ...payload, origin_type: editing.origin_type, origin_id: editing.origin_id };
    const updated = await entities.FinancialExpense.update(editing.id, patch);
    const linked = (payments || []).find((payment) => payment.financial_expense_id === editing.id);
    if (linked && employee) await entities.EmployeePayment.update(linked.id, linkedPaymentPatch(payload, employee));
    return { expense: updated, created: false };
  }

  const created = await entities.FinancialExpense.create(payload);
  if (!employee) return { expense: created, created: true };
  const payment = await entities.EmployeePayment.create(linkedPaymentPatch(payload, employee));
  await entities.EmployeePayment.update(payment.id, { financial_expense_id: created.id });
  return { expense: created, created: true };
}

// Exclusão é bloqueada quando o gasto pertence a outra tela (vale, pagamento
// em lote) ou quando algum registro ainda aponta para ele. Sem isso, apagar o
// gasto deixaria Vale/EmployeePayment órfãos apontando para um id inexistente.
export function expenseDeleteBlocker(expense = {}, { payments = [], vales = [] } = {}) {
  if (!expense.id) return 'Gasto não encontrado.';
  const origin = expense.origin_type || 'manual';
  if (origin !== 'manual') {
    return `Este gasto foi gerado em "${EXPENSE_ORIGIN_LABELS[origin] || origin}" e não pode ser excluído aqui.`;
  }
  if ((vales || []).some((vale) => vale.financial_expense_id === expense.id)) {
    return 'Este gasto está vinculado a um vale. Cancele o vale antes de excluir o gasto.';
  }
  if ((payments || []).some((payment) => payment.financial_expense_id === expense.id)) {
    return 'Este gasto está vinculado a um pagamento de colaborador e não pode ser excluído.';
  }
  return null;
}

export async function deleteDailyExpense({ entities, expense, payments = [], vales = [] }) {
  const blocker = expenseDeleteBlocker(expense, { payments, vales });
  if (blocker) throw new Error(blocker);
  return entities.FinancialExpense.delete(expense.id);
}

export const expenseCategoryOptions = (categories = []) => categories.filter((category) => category.status === 'ativo');

export const paymentMethodOptions = () => Object.entries(EXPENSE_METHOD_LABELS);

// Sugestões de fornecedor/estabelecimento a partir da entity Supplier já
// existente. Só popula a lista; o valor salvo continua sendo beneficiary_name.
export function supplierNameOptions(suppliers = []) {
  const names = suppliers
    .map((supplier) => supplier.trade_name || supplier.name)
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export const formatExpenseLabel = (expense) => {
  const value = formatExpenseAmount(expense?.amount);
  return `${expense?.description || 'Gasto'} · ${value} · ${formatExpenseDate(expense?.date)}`;
};

