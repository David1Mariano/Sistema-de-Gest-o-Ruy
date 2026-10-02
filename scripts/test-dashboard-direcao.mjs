import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDirectionMetrics } from '../src/lib/directionMetrics.js';
import { dashboardValue } from '../src/lib/financialDashboard.js';
import { renderComponent, cardText } from './dashboard-render-harness.mjs';
import { warnings, end } from './fixtures/dashboard-data.mjs';
const empty = { revenues: [], expenses: [], payments: [], payables: [], receivables: [], accounts: [], absences: [], inventory: [], orders: [], employees: [] };
const render = await renderComponent('./src/components/direcao/DirectionMetric.jsx');
test('Warning: multiple employees and statuses, month scope matches existing RH contract', () => {
  const metrics = buildDirectionMetrics({ ...empty, warnings }, end);
  assert.equal(metrics.warningsMonth, 3);
  const html = render({ label: 'Advertências no mês', value: dashboardValue(metrics.warningsMonth, ['warnings'], { warnings: 'ready' }), icon: () => null });
  assert.equal(cardText(html, 'Advertências no mês'), '3');
});
test('zero warnings is zero, other months do not leak into current month', () => {
  assert.equal(buildDirectionMetrics({ ...empty, warnings: [] }, end).warningsMonth, 0);
  assert.equal(buildDirectionMetrics({ ...empty, warnings }, '2026-08-31').warningsMonth, 1);
  assert.equal(buildDirectionMetrics({ ...empty, warnings }, '2026-10-01').warningsMonth, 0);
});
test('executive financial, staff, alerts and projection contracts', () => {
  const data = { ...empty, revenues: [{ date: end, gross_amount: 120, net_amount: 100, fee_amount: 20 }], expenses: [{ date: end, amount: 30 }], employees: [{ status: 'ativo' }, { status: 'desligado' }], accounts: [{ current_balance: 50 }], payables: [{ due_date: '2026-10-01', amount: 10, status: 'pendente' }], receivables: [{ expected_date: '2026-10-02', net_amount: 20, status: 'pendente' }], orders: [{ date: end, status: 'planejada' }], absences: [{ date: end, status: 'ativo' }], inventory: [{ current_stock: 1, minimum_stock: 2, status: 'ativo' }] };
  const m = buildDirectionMetrics(data, end);
  assert.deepEqual([m.revenueToday, m.expenseToday, m.balanceToday, m.resultMonth, m.activeEmployees, m.projectedBalance], [100, 30, 70, 70, 1, 60]);
  assert.equal(m.productionPending.length, 1); assert.equal(m.absencesToday.length, 1); assert.equal(m.lowStock.length, 1);
});
