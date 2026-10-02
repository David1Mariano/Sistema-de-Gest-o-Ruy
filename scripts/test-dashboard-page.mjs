import { test } from 'node:test';
import assert from 'node:assert/strict';
import { financePageHarness, deferred } from './dashboard-page-harness.mjs';
import { FONTE_FINANCEIRO } from '../src/lib/financeiroLoad.js';
import { cardText } from './dashboard-render-harness.mjs';
import { todayISO } from '../src/lib/timeUtils.js';

test('real Financeiro page: phased reads, memo recalculation, selective refresh, errors and recovery', async () => {
  const expenseRead = deferred(), categoryRead = deferred(), paymentRead = deferred();
  const subscriptions = {}, calls = {};
  const entities = Object.fromEntries(FONTE_FINANCEIRO.map(f => [f.entity, {
    list: async (sort, limit) => { calls[f.entity] = (calls[f.entity] || 0) + 1; assert.equal(sort, f.sort); assert.equal(limit, f.limit); return []; },
    subscribe: callback => { subscriptions[f.entity] = callback; return () => delete subscriptions[f.entity]; },
  }]));
  entities.FinancialExpense.list = async () => expenseRead.promise;
  entities.ExpenseCategory.list = async () => categoryRead.promise;
  entities.EmployeePayment.list = async () => paymentRead.promise;
  const page = await financePageHarness(entities);
  try {
    await page.flush(); assert.equal(cardText(page.html(), 'Lançamentos no período'), 'Carregando…');
    expenseRead.resolve([{ id: 'a', date: todayISO(), amount: 20, status: 'pago' }]);
    await page.flush(); assert.equal(cardText(page.html(), 'Lançamentos no período'), '1');
    assert.equal(cardText(page.html(), 'Diárias de motoboy'), 'Carregando…');
    categoryRead.resolve([]); await page.flush();
    const newer = [{ id: 'a', date: todayISO(), amount: 20, status: 'pago' }, { id: 'b', date: todayISO(), amount: 30, status: 'pago' }];
    entities.FinancialExpense.list = async () => newer;
    await subscriptions.FinancialExpense(); await page.flush();
    assert.equal(cardText(page.html(), 'Lançamentos no período'), '2');
    paymentRead.resolve([{ date: todayISO(), payment_date: todayISO(), payment_type: 'diaria_motoboy', net_amount: 80, status: 'pago' }]);
    await page.flush();
    assert.equal(cardText(page.html(), 'Lançamentos no período'), '2');
    assert.match(cardText(page.html(), 'Diárias de motoboy'), /80,00/);
    entities.EmployeePayment.list = async () => { throw new Error('fixture offline'); };
    await subscriptions.EmployeePayment(); await page.flush();
    assert.equal(cardText(page.html(), 'Diárias de motoboy'), 'Indisponível');
    assert.equal(cardText(page.html(), 'Lançamentos no período'), '2');
    entities.EmployeePayment.list = async () => [];
    await subscriptions.EmployeePayment(); await page.flush();
    assert.match(cardText(page.html(), 'Diárias de motoboy'), /0,00/);
    const revalidation = deferred(), categoriesLater = deferred();
    entities.FinancialExpense.list = async () => revalidation.promise;
    entities.ExpenseCategory.list = async () => categoriesLater.promise;
    const refresh = page.refresh(); await page.flush();
    assert.equal(cardText(page.html(), 'Lançamentos no período'), '2');
    revalidation.resolve([...newer, { id: 'c', date: todayISO(), amount: 40, status: 'pago' }]);
    await page.flush(); assert.equal(cardText(page.html(), 'Lançamentos no período'), '3');
    categoriesLater.resolve([]); await refresh; await page.flush();
    assert.equal(cardText(page.html(), 'Lançamentos no período'), '3');
  } finally { page.unmount(); }
});

test('real Direção page: Warning arrives after core data and updates its rendered card', async () => {
  const warningRead = deferred(); const subscriptions = {};
  const names = ['Revenue', 'FinancialExpense', 'AccountsPayable', 'AccountsReceivable', 'FinancialAccount', 'InventoryItem', 'Absence', 'ProductionOrder', 'Employee', 'EmployeePayment', 'CashMovement', 'Sangria', 'FechamentoCaixa', 'Warning'];
  const entities = Object.fromEntries(names.map(name => [name, {
    list: async () => [], subscribe: callback => { subscriptions[name] = callback; return () => {}; },
  }]));
  entities.Warning.list = async () => warningRead.promise;
  const page = await financePageHarness(entities, 'Direcao');
  try {
    await page.flush(); assert.equal(cardText(page.html(), 'Advertências no mês'), 'Carregando…');
    warningRead.resolve([{ date: todayISO(), employee_id: 'a' }, { date: todayISO(), employee_id: 'b' }]);
    await page.flush(); assert.equal(cardText(page.html(), 'Advertências no mês'), '2');
    entities.Warning.list = async () => [];
    await subscriptions.Warning(); await page.flush();
    assert.equal(cardText(page.html(), 'Advertências no mês'), '0');
    entities.Warning.list = async () => { throw new Error('offline fixture'); };
    await subscriptions.Warning(); await page.flush();
    assert.equal(cardText(page.html(), 'Advertências no mês'), 'Indisponível');
  } finally { page.unmount(); }
});
