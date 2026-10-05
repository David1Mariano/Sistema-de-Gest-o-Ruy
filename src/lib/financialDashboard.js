import { filterExpenses, hasExpenseProof } from './dailyExpenses.js';
import { summarizeByCategory, totalOf } from './expenseCategories.js';

export const inDashboardPeriod = (value, start, end) => {
  const date = String(value || '').slice(0, 10);
  return Boolean(date) && (!start || date >= start) && (!end || date <= end);
};

// Preserve the ledger contract: payments and vales have linked expenses.
// Adding their amounts again would double count those expenses.
export function buildFinancialDashboard(data, start = '', end = '') {
  const expenses = filterExpenses(data.expenses || [], { start, end });
  const payments = (data.payments || []).filter(x => x.status !== 'cancelado'
    && inDashboardPeriod(x.payment_date || x.work_date || x.reference_start, start, end));
  const sumClass = classification => totalOf(expenses.filter(x => x.classification === classification));
  return {
    expenses, payments,
    total: totalOf(expenses),
    paid: totalOf(expenses.filter(x => x.status === 'pago')),
    personnel: sumClass('pagamento_colaborador'),
    advances: sumClass('adiantamento_colaborador'),
    inputs: sumClass('compra_insumo'),
    motoboy: totalOf(payments.filter(x => x.payment_type === 'diaria_motoboy' && x.status === 'pago').map(x => ({ amount: x.net_amount }))),
    pending: totalOf(expenses.filter(x => x.status === 'pendente')),
    noProof: expenses.filter(x => x.status === 'pago' && !hasExpenseProof(x)).length,
    periodCount: expenses.length,
    byCategory: summarizeByCategory(expenses),
  };
}

export function dashboardValue(value, aliases, states, format = String) {
  if (aliases.some(alias => states[alias] === 'error')) return 'Indisponível';
  if (aliases.some(alias => states[alias] !== 'ready')) return 'Carregando…';
  return format(value);
}

// Pure incremental transition, shared by the React loader and behavior tests.
// Only aliases supplied by this result change; failures preserve good data.
export function applyDashboardResult(previous, phase) {
  const states = { ...previous.states };
  const errors = { ...previous.errors };
  for (const alias of Object.keys(phase.valores)) {
    states[alias] = 'ready';
    delete errors[alias];
  }
  for (const failure of phase.falhas) {
    states[failure.alias] = 'error';
    errors[failure.alias] = failure;
  }
  return { data: { ...previous.data, ...phase.valores }, states, errors };
}

export function currentDashboardResult(phase, versions, current) {
  return {
    valores: Object.fromEntries(Object.entries(phase.valores).filter(([alias]) => versions[alias] === current[alias])),
    falhas: phase.falhas.filter(f => versions[f.alias] === current[f.alias]),
  };
}
