import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDirectionMetrics } from '../src/lib/directionMetrics.js';
import { renderComponent, cardText } from './dashboard-render-harness.mjs';
import { warnings, warningsFive, warningsMultiMonth, end } from './fixtures/dashboard-data.mjs';
const empty = { revenues: [], expenses: [], payments: [], payables: [], receivables: [], accounts: [], absences: [], inventory: [], orders: [], employees: [] };
const render = await renderComponent('./src/components/direcao/DirectionMetric.jsx');
const card = (value, extra = {}) => render({ label: 'Advertências', detail: 'válidas cadastradas', value, icon: () => null, ...extra });
test('RH contract preserved: the monthly metric still exists and keeps its scope', () => {
  const metrics = buildDirectionMetrics({ ...empty, warnings }, end);
  assert.equal(metrics.warningsMonth, 3, 'a métrica mensal continua existindo para o RH');
});
test('métrica mensal: zero é zero e outros meses não vazam para o mês', () => {
  assert.equal(buildDirectionMetrics({ ...empty, warnings: [] }, end).warningsMonth, 0);
  assert.equal(buildDirectionMetrics({ ...empty, warnings }, '2026-08-31').warningsMonth, 1);
  assert.equal(buildDirectionMetrics({ ...empty, warnings }, '2026-10-01').warningsMonth, 0);
});
test('Direção: 5 advertências com 1 cancelada conta 4 válidas', () => {
  const metrics = buildDirectionMetrics({ ...empty, warnings: warningsFive }, end);
  assert.equal(metrics.warningsRegistered, 4, 'a cancelada não entra');
  assert.equal(metrics.warningsRegisteredPending, 2, 'as 2 pendentes entre as válidas');
});
test('Direção não depende de mês: válidas de qualquer data contam', () => {
  const metrics = buildDirectionMetrics({ ...empty, warnings: warningsMultiMonth }, end);
  assert.equal(metrics.warningsRegistered, 3, 'mês atual + mês anterior + antiga');
  assert.equal(metrics.warningsMonth, 2, 'o recorte mensal é menor — Direção != RH');
  assert.notEqual(metrics.warningsRegistered, metrics.warningsMonth, 'os escopos são realmente diferentes');
});
test('Direção ignora a cancelada mesmo quando ela está dentro do mês', () => {
  const soCancelada = [{ id: 'x1', date: end, status: 'cancelada' }];
  assert.equal(buildDirectionMetrics({ ...empty, warnings: soCancelada }, end).warningsRegistered, 0);
  assert.equal(buildDirectionMetrics({ ...empty, warnings: soCancelada }, end).warningsMonth, 1, 'a mensal ainda a conta, como sempre');
});
test('card: carregando nunca mostra 0', () => {
  const html = card(0, { carregado: false });
  assert.equal(cardText(html, 'Advertências'), 'Carregando…');
});
test('card: carregado sem registros mostra 0 (zero legítimo)', () => {
  const html = card(0, { carregado: true });
  assert.equal(cardText(html, 'Advertências'), '0');
});
test('card: carregado com registros mostra N', () => {
  const html = card(4, { carregado: true });
  assert.equal(cardText(html, 'Advertências'), '4');
});
test('card: falha mostra Indisponível, nunca 0', () => {
  const html = card(0, { carregado: false, falhou: true });
  assert.equal(cardText(html, 'Advertências'), 'Indisponível');
});
test('recuperação de erro: o mesmo card sai de Indisponível para o valor', () => {
  assert.equal(cardText(card(0, { falhou: true }), 'Advertências'), 'Indisponível');
  assert.equal(cardText(card(3, { carregado: true }), 'Advertências'), '3', 'nova carga bem-sucedida');
});
test('executive financial, staff, alerts and projection contracts', () => {
  const data = { ...empty, revenues: [{ date: end, gross_amount: 120, net_amount: 100, fee_amount: 20 }], expenses: [{ date: end, amount: 30 }], employees: [{ status: 'ativo' }, { status: 'desligado' }], accounts: [{ current_balance: 50 }], payables: [{ due_date: '2026-10-01', amount: 10, status: 'pendente' }], receivables: [{ expected_date: '2026-10-02', net_amount: 20, status: 'pendente' }], orders: [{ date: end, status: 'planejada' }], absences: [{ date: end, status: 'ativo' }], inventory: [{ current_stock: 1, minimum_stock: 2, status: 'ativo' }] };
  const m = buildDirectionMetrics(data, end);
  assert.deepEqual([m.revenueToday, m.expenseToday, m.balanceToday, m.resultMonth, m.activeEmployees, m.projectedBalance], [100, 30, 70, 70, 1, 60]);
  assert.equal(m.productionPending.length, 1); assert.equal(m.absencesToday.length, 1); assert.equal(m.lowStock.length, 1);
});
