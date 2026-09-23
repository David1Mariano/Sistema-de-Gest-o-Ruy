const value = (item, field) => Number(item?.[field] || 0);
const active = (item) => item.status !== 'cancelado';

export const localISO = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export function buildDirectionMetrics(data) {
  const today = localISO();
  const month = today.slice(0, 7);
  const inMonth = (date) => date?.startsWith(month);
  const revenues = data.revenues.filter(active);
  const expenses = data.expenses.filter(active);
  const payments = data.payments.filter(active);
  const openPayables = data.payables.filter((x) => !['pago', 'cancelado'].includes(x.status));
  const openReceivables = data.receivables.filter((x) => !['recebido', 'cancelado'].includes(x.status));
  const horizon = new Date(`${today}T12:00:00`); horizon.setDate(horizon.getDate() + 30);
  const until = localISO(horizon);
  const payable30 = openPayables.filter((x) => x.due_date >= today && x.due_date <= until).reduce((sum, x) => sum + value(x, 'amount'), 0);
  const receivable30 = openReceivables.filter((x) => x.expected_date >= today && x.expected_date <= until).reduce((sum, x) => sum + value(x, 'net_amount'), 0);
  const currentBalance = data.accounts.filter((x) => x.status !== 'inativo').reduce((sum, x) => sum + value(x, 'current_balance'), 0);
  const absencesToday = data.absences.filter((x) => x.date === today && x.status !== 'cancelado');
  const overdue = openPayables.filter((x) => x.due_date < today);
  const dueToday = openPayables.filter((x) => x.due_date === today);
  const lowStock = data.inventory.filter((x) => x.status !== 'inativo' && value(x, 'current_stock') <= value(x, 'minimum_stock'));
  const productionPending = data.orders.filter((x) => x.date === today && x.status === 'planejada');
  const limit = new Date(`${today}T12:00:00`); limit.setDate(limit.getDate() + 15);
  const experienceEnding = data.employees.filter((x) => x.experience_end >= today && x.experience_end <= localISO(limit) && !['desligado', 'inativo'].includes(x.status));
  const revenueToday = revenues.filter((x) => x.date === today).reduce((s, x) => s + value(x, 'net_amount'), 0);
  const expenseToday = expenses.filter((x) => x.date === today).reduce((s, x) => s + value(x, 'amount'), 0);
  const revenueMonth = revenues.filter((x) => inMonth(x.date)).reduce((s, x) => s + value(x, 'net_amount'), 0);
  const expenseMonth = expenses.filter((x) => inMonth(x.date)).reduce((s, x) => s + value(x, 'amount'), 0);
  const monthRevenues = revenues.filter((x) => inMonth(x.date));
  const grossRevenueMonth = monthRevenues.reduce((s, x) => s + value(x, 'gross_amount'), 0);
  const deductionsMonth = monthRevenues.reduce((s, x) => s + value(x, 'discount_amount') + value(x, 'fee_amount'), 0);
  const peopleCost = payments.filter((x) => inMonth(x.payment_date)).reduce((s, x) => s + value(x, 'net_amount'), 0);
  const channels = Object.entries(revenues.filter((x) => inMonth(x.date)).reduce((acc, x) => ({ ...acc, [x.source_type || 'outro']: (acc[x.source_type || 'outro'] || 0) + value(x, 'net_amount') }), {})).sort((a, b) => b[1] - a[1]);
  return { today, revenueToday, expenseToday, balanceToday: revenueToday - expenseToday, revenueMonth, grossRevenueMonth, deductionsMonth, expenseMonth, peopleCost, resultMonth: revenueMonth - expenseMonth, currentBalance, payable30, receivable30, projectedBalance: currentBalance + receivable30 - payable30, activeEmployees: data.employees.filter((x) => !['desligado', 'inativo'].includes(x.status)).length, absencesToday, overdue, dueToday, lowStock, productionPending, experienceEnding, channels };
}