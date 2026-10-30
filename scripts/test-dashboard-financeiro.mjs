import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFinancialDashboard, dashboardValue } from '../src/lib/financialDashboard.js';
import { filterExpenses, formatExpenseAmount } from '../src/lib/dailyExpenses.js';
import { summarizeByCategory, totalOf } from '../src/lib/expenseCategories.js';
import { renderComponent, cardText } from './dashboard-render-harness.mjs';
import { expenses, payments, vales, start, end } from './fixtures/dashboard-data.mjs';

const render = await renderComponent('./src/components/financeiro/FinancialOverviewCards.jsx');
test('four known expenses: every total and category uses the same ledger', () => {
  const result = buildFinancialDashboard({ expenses, payments, vales }, start, end);
  assert.deepEqual([result.total, result.paid, result.personnel, result.inputs, result.advances, result.motoboy, result.pending, result.noProof, result.periodCount], [1000, 700, 200, 300, 400, 100, 300, 1, 4]);
  assert.equal(result.byCategory.reduce((s, x) => s + x.total, 0), result.total);
  assert.equal(result.paid + result.pending, result.total);
  const gastos = filterExpenses(expenses, { start, end });
  assert.equal(totalOf(gastos), result.total);
  assert.deepEqual(summarizeByCategory(gastos), result.byCategory);
});
test('production React cards display the calculated amounts and count', () => {
  const stats = buildFinancialDashboard({ expenses, payments }, start, end);
  const html = render({ stats, sourceStates: { expenses: 'ready', payments: 'ready' } });
  for (const [label, expected] of [['Saídas pagas', 700], ['Pagamentos de pessoas', 200], ['Diárias de motoboy', 100], ['Insumos', 300], ['Vales/adiantamentos', 400], ['Pendentes', 300]]) {
    assert.equal(cardText(html, label), formatExpenseAmount(expected));
  }
  assert.equal(cardText(html, 'Pagos sem comprovante'), '1');
  assert.equal(cardText(html, 'Lançamentos no período'), '4');
});
test('legitimate operational-only expenses do not become wages, supplies or vales', () => {
  const result = buildFinancialDashboard({ expenses: expenses.map(x => ({ ...x, classification: 'despesa_operacional' })), payments: [] }, start, end);
  assert.deepEqual([result.personnel, result.inputs, result.advances, result.motoboy], [0, 0, 0, 0]);
});
test('cancelled and out-of-period entries excluded; missing dates never gain an invented date', () => {
  const result = buildFinancialDashboard({ expenses: [...expenses, { amount: 99, status: 'cancelado', date: start }, { amount: 77, date: '2026-10-01' }], payments: [...payments, { net_amount: 100, payment_type: 'diaria_motoboy', status: 'pago' }] }, start, end);
  assert.equal(result.periodCount, 4); assert.equal(result.total, 1000); assert.equal(result.motoboy, 100);
});
test('zero, missing source and failed source are distinct', () => {
  assert.equal(dashboardValue(0, ['expenses'], { expenses: 'ready' }), '0');
  assert.equal(dashboardValue(0, ['expenses'], {}), 'Carregando…');
  assert.equal(dashboardValue(0, ['expenses'], { expenses: 'error' }), 'Indisponível');
});
