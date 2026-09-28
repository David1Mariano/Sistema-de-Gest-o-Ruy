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

// Origens conhecidas. A origem NÃO decide sozinho a edição/exclusão: o que
// protege é `PROTECTED_EXPENSE_ORIGINS` (e os vínculos). Um gasto de
// 'pagamento_colaborador' é um FinancialExpense normal e pode ser corrigido aqui.
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

// Campos buscáveis: descrição, categoria, fornecedor/colaborador, responsável e
// também o VALOR — o funcionário digita "1.250,90" ou "1250,90" e encontra.
export function expenseSearchIndex(expense = {}) {
  const amount = Number(expense.amount);
  const valor = Number.isFinite(amount)
    ? [amount.toFixed(2), amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]
    : [];
  return normalizeExpenseText([
    expense.description, expense.category_name, expense.classification,
    expense.beneficiary_name, expense.beneficiary_type,
    expense.cost_center_name, expense.responsible_user, expense.observation,
    ...valor,
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

export const hasExpenseProof = (expense = {}) => Boolean(expense.proof_url || expense.storage_path);

// Filtros do histórico. `includeCancelled` só é usado no histórico completo,
// para o usuário enxergar o que cancelou — os totais da tela continuam ignorando.
export function filterExpenses(rows = [], {
  search = '', start = '', end = '', categoryId = '', paymentMethod = '',
  beneficiary = '', status = '', proof = '', includeCancelled = false,
} = {}) {
  return rows.filter((expense) => {
    if (!includeCancelled && isCancelledExpense(expense)) return false;
    if (!inRange(expense.date, start, end)) return false;
    if (categoryId && expense.category_id !== categoryId) return false;
    if (paymentMethod && expense.payment_method !== paymentMethod) return false;
    if (beneficiary && expense.beneficiary_name !== beneficiary) return false;
    if (status && expense.status !== status) return false;
    if (proof === 'com' && !hasExpenseProof(expense)) return false;
    if (proof === 'sem' && hasExpenseProof(expense)) return false;
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
// Devolve o gasto ao estado anterior SEMPRE que ainda for seguro.
//
// Só reverte se o registro continuar sendo EXATAMENTE o que esta operação
// gravou. A prova é a VERSÃO: `transact` devolve o registro já com o
// `updated_date` novo, então comparar esse valor com o `updated_date` atual
// dentro da transação distingue "ninguém mexeu depois de mim" de "outra
// máquina mexeu" — sem depender de um campo de negócio (valor, descrição...),
// que pode estar igual por coincidência.
//
// Se alguém mexeu, NÃO sobrescrevemos, NÃO forçamos rollback e NÃO mesclamos:
// devolvemos `null`, que faz o `transact` abortar SEM NENHUMA ESCRITA. O erro
// original da falha do EmployeePayment sobe normalmente e a alteração
// concorrente fica intacta.
async function compensarExpenseSeSeguro({ entities, id, versaoDaNossaGravacao, antes }) {
  if (!antes) return { compensado: false, motivo: 'sem snapshot anterior' };
  // Sem versão não há como provar posse da linha: não escrever é mais seguro.
  if (!versaoDaNossaGravacao) return { compensado: false, motivo: 'gravação sem versão' };

  const restaurar = {
    amount: antes.amount, date: antes.date, paid_date: antes.paid_date,
    description: antes.description, classification: antes.classification,
    category_id: antes.category_id, category_name: antes.category_name,
    cost_center_id: antes.cost_center_id, cost_center_name: antes.cost_center_name,
    beneficiary_type: antes.beneficiary_type, beneficiary_id: antes.beneficiary_id,
    beneficiary_name: antes.beneficiary_name, employee_id: antes.employee_id,
    payment_method: antes.payment_method, account: antes.account,
    status: antes.status, observation: antes.observation, proof_url: antes.proof_url,
  };

  if (typeof entities.FinancialExpense.transact !== 'function') {
    // Sem transação não dá para provar que a linha continua sendo nossa; em vez
    // de arriscar apagar alteração alheia, deixamos para reconciliação manual.
    console.error('[gastos-diarios] Compensação ignorada: transact indisponível.', { id });
    return { compensado: false, motivo: 'transact indisponível' };
  }

  try {
    await entities.FinancialExpense.transact(id, (atual) => {
      // Ainda é o que eu gravei? Só então restauro.
      if (atual?.updated_date !== versaoDaNossaGravacao) return null;
      return restaurar;
    });
    return { compensado: true, motivo: 'restaurado' };
  } catch (err) {
    // Falhou a própria compensação: não mascaramos, registramos para a reconciliação.
    console.error('[gastos-diarios] Falha ao compensar o gasto', id, err);
    return { compensado: false, motivo: 'falha na compensação' };
  }
}

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
    // Auditoria: o que MUDOU de fato. Só o que difere do anterior vira evento,
    // então salvar sem mexer em nada não gera ruído no histórico.
    await auditExpenseDiff({ entities, antes, depois: updated, responsibleUser });
    // Versão do registro TAL COMO NOSSA GRAVAÇÃO DEIXOU: a chave do CAS.
    const versaoDaNossaGravacao = updated?.updated_date || null;
    try {
      const payment = await syncLinkedEmployeePayment({ entities, expenseId: editing.id, employee, payload, linked });
      return { expense: updated, payment, created: false };
    } catch (err) {
      // `transact` protege UMA linha: gasto e pagamento são entidades
      // diferentes e NÃO há transação entre elas. Se a gravação do pagamento
      // falhar depois do gasto gravado, tentamos devolver o gasto ao estado
      // anterior — é COMPENSAÇÃO, não atomicidade. Só o fazemos se o registro
      // ainda for o nosso; havendo alteração concorrente, ela é preservada e
      // fica valendo a última gravação.
      const resultado = await compensarExpenseSeSeguro({
        entities, id: editing.id, versaoDaNossaGravacao, antes,
      });
      if (!resultado.compensado) {
        console.error('[gastos-diarios] Gasto não compensado; pode exigir reconciliação manual.', {
          id: editing.id, motivo: resultado.motivo,
        });
      }
      // O erro original da falha do pagamento sobe sempre: nada é mascarado.
      throw err;
    }
  }

  // `expense_id` torna a criação idempotente por tentativa: o mesmo id reenviado
  // atualiza o mesmo registro em vez de criar um segundo gasto.
  const id = form.expense_id || newExpenseId();
  const created = await entities.FinancialExpense.create({ ...payload, id });
  await auditExpense({
    entities, expense: created, action: 'criacao', newValue: describeExpense(created), responsibleUser,
  });
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

async function cancelLinkedPayment({ entities, linked, expectedUpdatedDate, note: noteBase }) {
  if (!linked) return null;
  const note = [linked.observation, noteBase || CANCEL_NOTE].filter(Boolean).join(' | ');
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


// Origens cujo registro financeiro é DERIVADO de outro módulo que é o
// dono da verdade. Editar/apagar o gasto aqui quebraria a rastreabilidade
// (o Vale continua sendo o Vale; a Conta a Pagar continua sendo a conta).
// `pagamento_colaborador` NÃO está aqui: o EmployeePayment é o dono dos
// dados do pagamento e o gasto é apenas o espelho financeiro — por isso um
// gasto criado na tela de Pagamentos precisa ser editável aqui.
export const PROTECTED_EXPENSE_ORIGINS = new Set(['vale', 'conta_pagar', 'recorrencia', 'lote']);

// Vínculos que exigem o fluxo da tela dona: apagar o gasto deixaria o Vale ou
// o EmployeePayment apontando para um id inexistente.
export const linkedVale = (expense, vales = []) =>
  (vales || []).some((vale) => vale?.financial_expense_id === expense?.id);
export const linkedPayment = (expense, payments = []) =>
  (payments || []).some((payment) => payment?.financial_expense_id === expense?.id);

// Bloqueio de EDIÇÃO: só origem protegida ou vínculo com Vale. Um pagamento de
// colaborador não impede a edição — o `saveDailyExpense` já mantém o
// EmployeePayment sincronizado.
export function expenseEditBlocker(expense = {}, { vales = [] } = {}) {
  if (!expense.id) return 'Gasto não encontrado.';
  const origin = expense.origin_type || 'manual';
  if (PROTECTED_EXPENSE_ORIGINS.has(origin)) {
    return `Este gasto veio de "${EXPENSE_ORIGIN_LABELS[origin] || origin}" e não pode ser excluído nem editado aqui: altere o registro de origem.`;
  }
  if (linkedVale(expense, vales)) {
    return 'Este gasto está vinculado a um Vale do RH e não pode ser excluído nem editado aqui: altere o vale.';
  }
  return null;
}

// Bloqueio de EXCLUSÃO: apenas o que é estrutural.
//
// REGRA DE PRODUTO: o simples vínculo com EmployeePayment NÃO bloqueia mais.
// O projeto nunca apaga pagamento (ver nota acima): ele CANCELA logicamente e
// registra o motivo em `observation`. Excluir o gasto faz exatamente o mesmo
// com o pagamento ativo vinculado, então não sobra pagamento ativo órfão e o
// histórico do colaborador permanece rastreável.
//
// Continuam bloqueados só os casos em que apagar aqui quebraria a origem do
// registro: Vale, Conta a Pagar, recorrência, lote e vínculo com Vale.
export function expenseDeleteBlocker(expense = {}, { payments = [], vales = [] } = {}) {
  return expenseEditBlocker(expense, { vales });
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

const EXCLUSAO_CANCEL_NOTE = 'Cancelado pelo Financeiro: o gasto vinculado foi excluído.';

// Registra um evento de auditoria sem NUNCA derrubar a operação principal.
// Espelha `logAudit` (src/lib/pontoUtils.js), mas recebe o `entities` em vez de
// importar a singleton, para poder ser testado com a entity em memória.
export async function auditExpense({ entities, expense, action, field, oldValue, newValue, reason, responsibleUser }) {
  try {
    const create = entities?.AuditLog?.create;
    if (typeof create !== 'function') return null;
    return await create.call(entities.AuditLog, {
      entity_type: 'FinancialExpense',
      entity_id: expense?.id || '',
      action: action || 'alteracao',
      field: field || '',
      old_value: oldValue != null ? String(oldValue) : '',
      new_value: newValue != null ? String(newValue) : '',
      reason: reason || '',
      responsible_user: responsibleUser || '',
    });
  } catch {
    // A auditoria é best-effort: perder o registro não pode fazer o usuário
    // acreditar que o gasto não foi excluído.
    return null;
  }
}

const describeExpense = (expense = {}) => `${expense.description || 'Sem descrição'} | ${formatExpenseAmount(expense.amount)} | ${expense.category_name || 'sem categoria'} | ${expense.beneficiary_name || 'sem favorecido'}`;

// Campos que viram evento de auditoria quando mudam. `updated_date` fica de
// fora de propósito: ele muda em toda gravação e poluiria o histórico.
const AUDITED_FIELDS = [
  ['amount', 'valor'],
  ['category_name', 'categoria'],
  ['beneficiary_name', 'favorecido'],
  ['description', 'descricao'],
  ['status', 'situacao'],
  ['payment_method', 'forma de pagamento'],
  ['date', 'data'],
];

// Um evento por campo que mudou de verdade. Sem `antes` (edição sem
// snapshot), não registramos nada: inventar um "valor anterior" seria mentira.
export async function auditExpenseDiff({ entities, antes, depois, responsibleUser }) {
  if (!antes?.id || !depois?.id) return [];
  const eventos = [];
  for (const [campo, rotulo] of AUDITED_FIELDS) {
    const velho = antes[campo];
    const novo = depois[campo];
    if (String(velho ?? '') === String(novo ?? '')) continue;
    await auditExpense({
      entities, expense: depois, action: 'alteracao', field: rotulo,
      oldValue: rotulo === 'valor' ? formatExpenseAmount(velho) : velho,
      newValue: rotulo === 'valor' ? formatExpenseAmount(novo) : novo,
      responsibleUser,
    });
    eventos.push({ field: rotulo, oldValue: velho, newValue: novo });
  }
  return eventos;
}

// Exclui o gasto tratando o pagamento vinculado.
//
// ORDEM (aprovada): cancelar o EmployeePayment ativo -> registrar auditoria ->
// excluir o gasto.
//
// FALHA PARCIAL, documentada: se a exclusão do gasto falhar DEPOIS do
// cancelamento, o pagamento já está cancelado e o gasto continua existindo. Não
// há transação distribuída entre as duas entities, então devolvemos um erro
// explícito avisando que o pagamento foi cancelado e que é preciso conferir na
// tela — nunca devolvemos sucesso parcial silencioso. O inverso (gasto apagado
// e pagamento ativo) é impossível pela ordem escolhida: o pagamento é sempre
// tratado ANTES.
export async function deleteDailyExpense({
  entities, expense, payments = [], vales = [], revalidate = true,
  responsibleUser = '', onPaid = null,
}) {
  let current = { payments, vales };
  if (revalidate) current = await reloadLinks({ entities, payments, vales });
  const blocker = expenseDeleteBlocker(expense, current);
  if (blocker) throw new Error(blocker);

  const linked = findActiveLinkedPayment(current.payments, expense.id);
  let pagamentoCancelado = false;
  if (linked) {
    await cancelLinkedPayment({ entities, linked, note: EXCLUSAO_CANCEL_NOTE });
    pagamentoCancelado = true;
  }

  await auditExpense({
    entities, expense, action: 'exclusao_logica',
    // Guardamos a "fotografia" do lançamento: categoria, favorecido e valor
    // continuam recuperáveis mesmo depois que o registro some.
    oldValue: describeExpense(expense), reason: EXCLUSAO_CANCEL_NOTE, responsibleUser,
  });

  try {
    const resultado = await entities.FinancialExpense.delete(expense.id);
    if (typeof onPaid === 'function') await onPaid({ expense, pagamentoCancelado });
    return resultado;
  } catch (e) {
    throw new Error(
      pagamentoCancelado
        ? `O pagamento de ${linked?.employee_name || 'colaborador'} foi cancelado, mas o gasto não pôde ser excluído. `
          + 'Atualize a lista e tente de novo para não deixar o pagamento cancelado sem o gasto.'
        : (e?.message || 'Não foi possível excluir o gasto.'),
    );
  }
}

export const expenseCategoryOptions = (categories = []) => categories.filter((category) => category.status === 'ativo');

// ============================================================ HISTÓRICO
//
// A tela de Histórico é RASTREABILIDADE, não a lista operacional. Ela junta
// duas fontes que JÁ existem no projeto, sem inventar armazenamento nem duplicar
// entidade:
//
//   1. FinancialExpense  -> o lançamento como está hoje (data, valor,
//                           categoria, favorecido, situação, comprovante)
//   2. AuditLog          -> os eventos de criação/edição/exclusão gravados a
//                           partir desta versão, por `entity_id`
//
// LIMITE HONESTO: até esta versão, FinancialExpense não gravava auditoria.
// Então o que existe hoje é o ESTADO ATUAL do lançamento mais `created_date` /
// `updated_date`. Edições feitas ANTES disso não são reconstituíveis — e não
// vamos fingir que são. A partir de agora, cada evento é gravado.

export const EXPENSE_AUDIT_LABELS = {
  criacao: 'Criação',
  alteracao: 'Alteração',
  exclusao_logica: 'Exclusão',
};

// Eventos de um gasto, do mais recente para o mais antigo.
export function expenseEvents(auditRecords = [], expenseId) {
  if (!expenseId) return [];
  return (auditRecords || [])
    .filter((record) => record?.entity_type === 'FinancialExpense' && record?.entity_id === expenseId)
    .map((record) => ({
      id: record.id,
      at: record.created_date || record.updated_date || '',
      action: record.action,
      rotulo: EXPENSE_AUDIT_LABELS[record.action] || record.action,
      field: record.field || '',
      oldValue: record.old_value || '',
      newValue: record.new_value || '',
      reason: record.reason || '',
      responsibleUser: record.responsible_user || '',
    }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// Uma linha por lançamento, já com os eventos que existem.
export function buildHistoryRows(expenses = [], auditRecords = []) {
  return (expenses || []).map((expense) => ({
    expense,
    id: expense.id,
    events: expenseEvents(auditRecords, expense.id),
    excluido: expenseEvents(auditRecords, expense.id).some((event) => event.action === 'exclusao_logica'),
  }));
}

const normalize = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Índice de pesquisa do histórico: descrição, categoria, favorecido,
// observação e valor — conforme pedido.
function historySearchIndex(row) {
  const { expense } = row;
  const eventos = row.events.map((e) => `${e.field} ${e.oldValue} ${e.newValue} ${e.reason}`).join(' ');
  return normalize([
    expense.description, expense.category_name, expense.beneficiary_name,
    expense.observation, expense.document_number, expense.responsible_user,
    expense.amount, eventos,
  ].join(' '));
}

// Filtros do histórico. `origem` e `evento` são filtros de RASTREABILIDADE;
// os demais reaproveitam a mesma semântica já validada em `filterExpenses`.
export function filterHistoryRows(rows = [], {
  search = '', start = '', end = '', categoryId = '', beneficiary = '', status = '',
  proof = '', origin = '', event = '',
} = {}) {
  const query = normalize(search).trim();
  return (rows || []).filter((row) => {
    const { expense } = row;
    if (start && String(expense.date ?? '').slice(0, 10) < start) return false;
    if (end && String(expense.date ?? '').slice(0, 10) > end) return false;
    if (categoryId && expense.category_id !== categoryId) return false;
    if (beneficiary && expense.beneficiary_name !== beneficiary) return false;
    if (status && expense.status !== status) return false;
    if (proof === 'com' && !hasExpenseProof(expense)) return false;
    if (proof === 'sem' && hasExpenseProof(expense)) return false;
    if (origin && (expense.origin_type || 'manual') !== origin) return false;
    if (event && !row.events.some((e) => e.action === event)) return false;
    if (query && !query.split(/\s+/).filter(Boolean).every((w) => historySearchIndex(row).includes(w))) return false;
    return true;
  });
}

// Mais recente primeiro. Empate resolvido pelo id para a ordem ser estável
// entre renders (a lista não pode "pular" linha a cada recarga).
export function sortHistoryRows(rows = []) {
  return [...(rows || [])].sort((a, b) => {
    const data = String(b.expense?.updated_date || b.expense?.date || '').localeCompare(String(a.expense?.updated_date || a.expense?.date || ''));
    if (data) return data;
    return String(b.expense?.id || '').localeCompare(String(a.expense?.id || ''));
  });
}

// Categorias oferecidas no filtro do histórico.
//
// Deduplica por nome equivalente e põe as ativas primeiro, com a MESMA regra de
// `selectableCategories` (expenseCategories.js). Não importamos de lá de
// propósito: aquele arquivo já importa este, e a importação de volta criaria
// um ciclo.
//
// Categoria DESATIVADA continua na lista (marcada com sufixo): registro antigo
// não pode sumir do filtro só porque alguém desligou a categoria depois.
export function historyCategoryOptions(categories = []) {
  const seen = new Set();
  const ordered = [...(categories || [])].sort((a, b) => {
    const ativo = (b.status === 'ativo' ? 1 : 0) - (a.status === 'ativo' ? 1 : 0);
    if (ativo) return ativo;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR');
  });
  return ordered
    .filter((category) => {
      const key = normalizeExpenseText(category?.name).replace(/\s+/g, ' ');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((category) => ({ ...category, inativa: category.status !== 'ativo' }));
}

// Origens presentes no histórico, para o filtro não oferecer valor vazio.
export function historyOriginOptions(rows = []) {
  return [...new Set((rows || []).map((r) => r.expense?.origin_type || 'manual'))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

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

