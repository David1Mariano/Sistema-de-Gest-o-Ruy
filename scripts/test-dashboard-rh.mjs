import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRHMetrics } from '../src/lib/rhDashboardMetrics.js';
import { buildDirectionMetrics } from '../src/lib/directionMetrics.js';
import { warnings, end } from './fixtures/dashboard-data.mjs';
test('RH: counts and vale amount respect the same selected employees', () => {
  const data = { employees: [{ id: 'a', status: 'ativo', created_date: end }], schedules: [{ employee_id: 'a', day_type: 'trabalho', status: 'ativo' }], absences: [{ employee_id: 'a', type: 'atraso', date: end, status: 'ativo' }], vales: [{ employee_id: 'a', status: 'pendente', amount: '12.50' }, { employee_id: 'b', status: 'pendente', amount: 100 }], warnings };
  const m = buildRHMetrics(data, end);
  assert.deepEqual([m.total, m.active, m.workingToday, m.lateToday, m.valesPending, m.valesPendingAmount, m.warnMonth, m.newMonth], [1, 1, 1, 1, 1, 12.5, 1, 1]);
});
test('RH and Direção share monthly Warning contract; changing period recalculates', () => {
  const data = { employees: [{ id: 'a' }, { id: 'b' }], warnings, schedules: [], absences: [], vales: [], revenues: [], expenses: [], payments: [], payables: [], receivables: [], accounts: [], inventory: [], orders: [] };
  for (const date of [end, '2026-08-31', '2026-10-01']) assert.equal(buildRHMetrics(data, date).warnMonth, buildDirectionMetrics(data, date).warningsMonth);
});
