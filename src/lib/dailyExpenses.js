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
//
// Numeração: segue a regra compartilhada do projeto em `numberUtils.js`
// (integrada pelo Agente 1) — na TELA o valor é pt-BR com vírgula, no ESTADO e
// no BANCO é número. Import relativo, e não o alias '@/', porque este arquivo
// roda igual no app (Vite) e nos testes do Node.
import { parseDecimalBR, roundMoney } from './numberUtils.js';
import { todayISO } from './timeUtils.js';

export { roundMoney, todayISO };

// Erro de concorrência: o gasto foi alterado por outra máquina depois que este
// formulário foi aberto. A mensagem pede atualização, sem mesclar intenção.
export class ExpenseConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExpenseConflictError';
    this.code = 'gasto_alterado_por_outra_maquina';
  }
}

// Id estável por tentativa de criação. `create()` respeita `data.id` nos DOIS
// backends (cloudDb e localDb fazem upsert pela chave entity+id), então o
// mesmo id reenviado atualiza o mesmo registro em vez de duplicar o gasto.
// É o que torna seguro repetir a criação depois de um timeout.
export function newExpenseId() {
  if (globalThis.crypto?.randomUUID) return `fe_${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `fe_${hex}`;
  }
  return `fe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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

// A data local vem de `timeUtils.todayISO` (reexportada acima): dia do fuso
// do navegador, igual ao estoque e ao Ponto. Sem isso, um gasto registrado às
// 21h30 no Brasil (UTC-3) seria datado como o dia seguinte.

// Datas gravadas pelo app são 'YYYY-MM-DD' (string). Formatamos sem passar por
// Date para não sofrer o deslocamento de fuso do construtor com meia-noite.
export function formatExpenseDate(value) {
  const raw = String(value ?? '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

// Formatador único de moeda: o MESMO que o restante do Financeiro usa
// (`toLocaleString('pt-BR', {style:'currency'})`), só que com o
// Intl.NumberFormat instanciado uma vez. Não muda o texto exibido.
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatExpenseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return BRL.format(0);
  return BRL.format(n);
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
  // NumberInput trabalha com NÚMERO (regra do numberUtils); texto formatado
  // faria o campo exibir "320" como texto e travar a máscara.
  form.amount = expense.amount === undefined || expense.amount === null ? '' : Number(expense.amount) || '';
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
// O valor é normalizado pela regra compartilhada (numberUtils): aceita o que o
// funcionário digita ("48,90", "1.234,56", "1234.56") e grava número em centavos.
const parseExpenseAmount = (value) => {
  const parsed = parseDecimalBR(value);
  if (parsed === '' || !Number.isFinite(parsed)) return 0;
  const money = roundMoney(parsed);
  return Number.isFinite(money) ? money : 0;
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
//
// Escritas na CRIAÇÃO: 2 (antes eram 3).
//   1) FinancialExpense.create   — com `id` estável, então repetir a tentativa
//                                  faz upsert do MESMO registro (não duplica);
//   2) EmployeePayment.create    — já nasce com `financial_expense_id`, o id do
//                                  gasto já existe no passo 1. O antigo
//                                  "create + update para ligar" era um ponto de
//                                  falha e uma janela em que o pagamento existia
//                                  sem vínculo (órfão).
// Se o passo 2 falhar, o gasto é compensado (excluído) para não sobrar registro
// pela metade, e o erro sobe para a tela: nunca devolvemos sucesso parcial.
export async function saveDailyExpense({ entities, form, editing = null, categories = [], centers = [], employees = [], responsibleUser = '', payments = [] }) {
  const payload = buildExpensePayload(form, { categories, centers, employees, responsibleUser });
  const employee = payload.beneficiary_id
    ? employees.find((item) => item.id === payload.beneficiary_id)
    : null;

  if (editing?.id) {
    // `origin_type`/`origin_id` não mudam na edição: o registro continua
    // pertencendo à tela que o criou.
    const patch = { ...payload, origin_type: editing.origin_type, origin_id: editing.origin_id };
    const antes = await entities.FinancialExpense.get(editing.id).catch(() => null);
    const linked = findActiveLinkedPayment(payments, editing.id);
    const updated = await updateExpenseGuarded({ entities, editing, patch });
    try {
      const payment = await syncLinkedEmployeePayment({ entities, expenseId: editing.id, employee, payload, linked });
      return { expense: updated, payment, created: false };
    } catch (err) {
      // `transact` protege UMA linha: o gasto e o pagamento são entidades
      // diferentes e NÃO há transação entre elas. Se a gravação do pagamento
      // falhar depois do gasto ter sido gravado, devolvemos o gasto ao estado
      // anterior — é COMPENSAÇÃO, não atomicidade. Sem ela, FinancialExpense e
      // EmployeePayment terminariam com valores diferentes em silêncio.
      if (antes) {
        try {
          await entities.FinancialExpense.update(editing.id, {
            amount: antes.amount, date: antes.date, paid_date: antes.paid_date,
            description: antes.description, classification: antes.classification,
            category_id: antes.category_id, category_name: antes.category_name,
            cost_center_id: antes.cost_center_id, cost_center_name: antes.cost_center_name,
            beneficiary_type: antes.beneficiary_type, beneficiary_id: antes.beneficiary_id,
            beneficiary_name: antes.beneficiary_name, employee_id: antes.employee_id,
            payment_method: antes.payment_method, account: antes.account,
            status: antes.status, observation: antes.observation, proof_url: antes.proof_url,
          });
        } catch { /* mantém o erro original; a reconciliação manual resolve */ }
      }
      throw err;
    }
  }

  // `expense_id` torna a criação idempotente por tentativa: o mesmo id reenviado
  // atualiza o mesmo registro em vez de criar um segundo gasto.
  const id = form.expense_id || newExpenseId();
  const created = await entities.FinancialExpense.create({ ...payload, id });
  if (!employee) return { expense: created, payment: null, created: true, expenseId: id };

  try {
    const payment = await entities.EmployeePayment.create({ ...linkedPaymentPatch(payload, employee), financial_expense_id: created.id });
    return { expense: created, payment, created: true, expenseId: id };
  } catch (err) {
    // Falha parcial: o gasto existe mas o pagamento do colaborador não.
    // Compensamos removendo o gasto recém-criado (ele não tem nenhum vínculo
    // ainda), para o estado não ficar pela metade. Se a compensação falhar, o
    // erro original sobe junto e o id estável evita gasto duplicado no retry.
    try { await entities.FinancialExpense.delete(created.id); } catch { /* mantém o erro original */ }
    throw new Error(
      'O gasto não foi salvo: o registro do pagamento do colaborador falhou e o gasto foi desfeito. '
      + 'Tente novamente.'
    );
  }
}

// ---------------------------------------------------------------- concorrência
//
// `client.transact(id, mutate)` faz read-modify-write COMPARANDO A VERSÃO: se
// outra máquina gravou no meio, o PATCH volta vazio e a função repete. Nós
// usamos isso para ABORTAR, não para mesclar: um formulário financeiro não
// pode sobrescrever a intenção de outro usuário em silêncio.
//
// IMPORTANTE: `transact` protege UMA linha. FinancialExpense e EmployeePayment
// continuam sendo entidades diferentes — a operação NÃO é atômica entre elas.

function assertSameVersion(entity, row, expectedUpdatedDate) {
  // Sem versão carregada (registro antigo) não há como detectar conflito:
  // nesse caso seguimos o fluxo normal em vez de bloquear uma edição legítima.
  if (!expectedUpdatedDate || !row?.updated_date) return;
  if (row.updated_date !== expectedUpdatedDate) {
    throw new ExpenseConflictError(
      `Este gasto foi alterado em outra máquina depois que você abriu a tela. `
      + 'Atualize a lista e revise antes de salvar, para não sobrescrever a alteração de outro usuário.'
    );
  }
}

// Grava o FinancialExpense da edição detectando conflito. Usa transact quando
// disponível; sem ele, cai para update() (comportamento antigo, sem Worse).
async function updateExpenseGuarded({ entities, editing, patch }) {
  if (typeof entities.FinancialExpense.transact !== 'function') {
    return entities.FinancialExpense.update(editing.id, patch);
  }
  return entities.FinancialExpense.transact(editing.id, async (row) => {
    assertSameVersion('FinancialExpense', row, editing.updated_date);
    return { ...patch, id: editing.id };
  });
}

// ------------------------------------------------------------ EmployeePayment
//
// Decisão de produto (documentada): NUNCA apagamos pagamento.
// O projeto já trata pagamento cancelado como "inexistente" em todos os
// cálculos (Financeiro, FichaColaborador e métricas filtram status
// 'cancelado'), e a FichaColaborador registra exclusão como 'exclusao_logica'.
// Então, quando o favorecido muda, o pagamento antigo é CANCELADO — o
// histórico continua visível na ficha de quem o recebeu — e o novo é criado
// vinculado ao mesmo gasto. Reconciliar o pagamento antigo para o colaborador
// B apagaria da ficha do A um lançamento que de fato pertence a ele.

const CANCEL_NOTE = 'Cancelado pelo Financeiro: favorecido do gasto alterado.';

async function cancelLinkedPayment({ entities, linked, expectedUpdatedDate }) {
  if (!linked) return null;
  const note = [linked.observation, CANCEL_NOTE].filter(Boolean).join(' | ');
  if (typeof entities.EmployeePayment.transact !== 'function') {
    return entities.EmployeePayment.update(linked.id, { status: 'cancelado', observation: note });
  }
  return entities.EmployeePayment.transact(linked.id, async (row) => {
    assertSameVersion('EmployeePayment', row, expectedUpdatedDate || linked.updated_date);
    if (row.status === 'cancelado') return null; // já estava: nada a fazer
    return { status: 'cancelado', observation: note };
  });
}

// Pagamento que "representa" o gasto hoje: o ÚLTIMO ativo vinculado. Depois de
// uma troca de favorecido existem pagamentos cancelados E um ativo apontando
// para o mesmo gasto; escolher pelo primeiro da lista pegaria um já cancelado
// e deixaria o ativo para trás.
export function findActiveLinkedPayment(payments = [], expenseId) {
  if (!expenseId) return null;
  const linked = (payments || []).filter((payment) => payment?.financial_expense_id === expenseId);
  if (!linked.length) return null;
  const ativos = linked.filter((payment) => payment.status !== 'cancelado');
  return ativos[ativos.length - 1] || null;
}

// Deixa o EmployeePayment coerente com o favorecido atual do gasto.
//   fornecedor -> fornecedor   : nada a fazer (não existe pagamento)
//   fornecedor -> colaborador  : cria 1 pagamento já vinculado ao gasto
//   A -> A                     : atualiza o pagamento existente (não duplica)
//   A -> B                     : cancela o de A e cria 1 para B
//   colaborador -> fornecedor  : cancela o pagamento do colaborador
export async function syncLinkedEmployeePayment({ entities, expenseId, employee, payload, linked }) {
  if (employee) {
    if (!linked) {
      return entities.EmployeePayment.create({ ...linkedPaymentPatch(payload, employee), financial_expense_id: expenseId });
    }
    if (linked.employee_id === employee.id) {
      return updatePaymentGuarded({ entities, linked, patch: linkedPaymentPatch(payload, employee) });
    }
    await cancelLinkedPayment({ entities, linked });
    return entities.EmployeePayment.create({ ...linkedPaymentPatch(payload, employee), financial_expense_id: expenseId });
  }
  return cancelLinkedPayment({ entities, linked });
}

async function updatePaymentGuarded({ entities, linked, patch }) {
  if (typeof entities.EmployeePayment.transact !== 'function') {
    return entities.EmployeePayment.update(linked.id, patch);
  }
  return entities.EmployeePayment.transact(linked.id, async (row) => {
    assertSameVersion('EmployeePayment', row, linked.updated_date);
    return { ...patch, id: linked.id };
  });
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

// Recarrega os vínculos que protegem a exclusão. `expenseDeleteBlocker` só
// enxerga o snapshot da tela; se, entre carregar e clicar em excluir, nasceu um
// EmployeePayment/Vale ou o registro virou origem protegida, o bloqueio
// acontece mesmo assim. Sem essa revalidação, apagaríamos com base em dado
// velho. Limitação conhecida: `list` tem teto de registros, então um vínculo
// além do teto não seria visto (mesma janela de antes, agora com dado fresco).
async function reloadLinks({ entities, payments = [], vales = [] }) {
  const load = async (name, snapshot) => {
    try {
      const list = entities[name]?.list;
      if (typeof list !== 'function') return snapshot;
      return await list.call(entities[name], '-created_date', 2000) || snapshot;
    } catch {
      return snapshot; // offline/erro: usa o snapshot, sem travar a exclusão
    }
  };
  const [freshPayments, freshVales] = await Promise.all([
    load('EmployeePayment', payments),
    load('Vale', vales),
  ]);
  return { payments: freshPayments, vales: freshVales };
}

export async function deleteDailyExpense({ entities, expense, payments = [], vales = [], revalidate = true }) {
  let current = { payments, vales };
  if (revalidate) current = await reloadLinks({ entities, payments, vales });
  const blocker = expenseDeleteBlocker(expense, current);
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

