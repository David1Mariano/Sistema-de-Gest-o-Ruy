import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryOrder, filterOrders, orderMetrics } from '../src/lib/delivery/domain.js';
import { providerAdapter } from '../supabase/functions/_shared/delivery-providers.mjs';
import { deliveryCustomer, catalogMapping } from '../supabase/functions/_shared/delivery-catalog.mjs';
import { AIProvider, ToolRegistry, ConversationService } from '../supabase/functions/_shared/delivery-assistant.mjs';
globalThis.fetch = async () => { throw Error('NETWORK_DISABLED_IN_CENTRAL_TESTS'); };

const row = (id = 'one', status = 'concluded') => ({ platform: 'ifood', merchant_id: 'm1', external_id: id, data: { platform: 'ifood', merchant_id: 'm1', external_id: id, number: '123', status, money: { customer_total: 2500 }, customer: { name: 'Private', phone: 'Private' } } });
test('Central: projection excludes PII/raw, isolates identifiers and filters without fabricating data', () => {
  const order = deliveryOrder(row());
  assert.equal(order.customer, null); assert.equal(order.address, null); assert.equal(order.deliveryType, null);
  assert.throws(() => deliveryOrder({ ...row(), merchant_id: 'other' }), /INVALID_DELIVERY_ORDER/);
  assert.equal(filterOrders([order], { search: '123' }).length, 1);
  assert.equal(filterOrders([order], { search: 'Private' }).length, 0);
  assert.equal(filterOrders([order], { channel: '99food' }).length, 0);
  assert.equal(filterOrders([order], { status: 'preparing' }).length, 0);
});
test('Central: deduplication, cancellation, unknown totals and merchant isolation', () => {
  const order = deliveryOrder(row());
  const metrics = orderMetrics([order, order, deliveryOrder(row('two', 'cancelled'))]);
  assert.equal(metrics.orders, 2); assert.equal(metrics.sales, 2500); assert.equal(metrics.average, 2500); assert.equal(metrics.cancelled, 1);
  assert.equal(orderMetrics([]).sales, null);
  assert.equal(orderMetrics([{ ...order, money: {} }]).sales, null);
  assert.equal(orderMetrics([order, { ...order, merchantId: 'm2' }]).orders, 2);
});
test('Providers: unknown contracts fail closed; iFood event retains provider/merchant identity', () => {
  for (const name of ['99food', 'whatsapp', 'own']) {
    const adapter = providerAdapter(name);
    assert.equal(adapter.capabilities.commands, false);
    assert.throws(() => adapter.connect(), /CONFIGURATION_REQUIRED/);
    assert.throws(() => adapter.normalizeEvent({}), /CONFIGURATION_REQUIRED/);
  }
  assert.throws(() => providerAdapter('invented'), /UNKNOWN_PROVIDER/);
  const event = providerAdapter('ifood', {}, {}).normalizeEvent({ id: 'e1', merchantId: 'm1', orderId: 'o1', code: 'PLC', createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(event.provider, 'ifood'); assert.equal(event.merchantId, 'm1'); assert.equal(event.eventId, 'e1');
});
test('Customer and catalog contracts do not infer customer history or change stock', () => {
  const customer = deliveryCustomer({ id: 'c1', merchantId: 'm1', provider: 'own', externalCustomerId: 'x' });
  assert.equal(customer.profile, null); assert.equal(customer.history.orders, null);
  const mapping = catalogMapping({ provider: 'ifood', merchantId: 'm1', internalProductId: 'p1', externalProductId: 'x1', revision: 1 });
  assert.equal(mapping.internalProductId, 'p1'); assert.ok(!('stock' in mapping));
  assert.throws(() => catalogMapping({ ...mapping, revision: 0 }), /REVISION/);
});
const context = { verified: true, subjectId: 'customer-1', merchantId: 'm1', provider: 'whatsapp' };
// Test-only store; production must implement transactions, scope and durable idempotency.
function storeFixture() {
  const conversation = { mode: 'ai', version: 0, processedIds: [], pendingReply: null };
  let chain = Promise.resolve();
  return { conversation, withConversation(id, ctx, fn) {
    if (id !== 'c1' || ctx.subjectId !== context.subjectId || ctx.merchantId !== context.merchantId || ctx.provider !== context.provider) throw Error('SCOPE_DENIED');
    const result = chain.then(async () => { const next = structuredClone(conversation); const value = await fn(next); Object.assign(conversation, next); return value; });
    chain = result.catch(() => {}); return result;
  } };
}
test('AI: no SDK/configuration, arbitrary tools, SQL, price or unverified context', async () => {
  await assert.rejects(new AIProvider().plan(), /AI_NOT_CONFIGURED/);
  assert.throws(() => new ToolRegistry({ executeSql() {} }), /TOOL_NOT_ALLOWED/);
  const tools = new ToolRegistry({ adicionarItem: async () => 'ok' });
  await assert.rejects(tools.execute('adicionarItem', { draftId: 'd', productId: 'p', quantity: 1, price: 1 }, context), /ARGUMENTS/);
  await assert.rejects(tools.execute('adicionarItem', { draftId: 'd', productId: 'p', quantity: -1 }, context), /QUANTITY/);
  await assert.rejects(tools.execute('executeSql', {}, context), /TOOL_NOT_AVAILABLE/);
  await assert.rejects(tools.execute('adicionarItem', {}, {}), /UNVERIFIED/);
});
test('AI: human takeover invalidates in-flight plan and only operator can return to AI', async () => {
  let finish, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const store = storeFixture(), ai = { plan: async () => { started(); return new Promise(resolve => { finish = resolve; }); } };
  const service = new ConversationService({ store, ai });
  const pending = service.draftReply('c1', context, 'msg1', 'hello'); await waiting;
  await service.handoff('c1', { ...context, operator: true }, 'human');
  finish({ reply: 'draft', calls: [] });
  assert.deepEqual(await pending, { suppressed: true }); assert.equal(store.conversation.pendingReply, null);
  await assert.rejects(service.handoff('c1', context, 'ai'), /HANDOFF_FORBIDDEN/);
  await service.handoff('c1', { ...context, operator: true }, 'ai');
  assert.equal(store.conversation.mode, 'ai');
});
test('AI: replay is deduplicated, wrong merchant denied and reply remains an unsent draft', async () => {
  const store = storeFixture(), service = new ConversationService({ store, ai: { plan: async () => ({ reply: 'draft', calls: [] }) } });
  assert.equal((await service.draftReply('c1', context, 'msg1', 'hi')).draft, true);
  assert.deepEqual(await service.draftReply('c1', context, 'msg1', 'hi'), { suppressed: true });
  await assert.rejects(service.draftReply('c1', { ...context, merchantId: 'm2' }, 'msg2', 'hi'), /SCOPE_DENIED/);
  assert.equal(store.conversation.pendingReply.text, 'draft');
});

test('AI: concurrent duplicate plans execute at most one permitted tool', async () => {
  let release; const barrier = new Promise(resolve => { release = resolve; }); let plans = 0, calls = 0;
  const store = storeFixture();
  const service = new ConversationService({ store, tools: new ToolRegistry({ consultarHorario: async () => { calls++; } }),
    ai: { plan: async () => { if (++plans === 2) release(); await barrier; return { reply: 'draft', calls: [{ name: 'consultarHorario', args: {} }] }; } } });
  const result = await Promise.all([service.draftReply('c1', context, 'same', 'hi'), service.draftReply('c1', context, 'same', 'hi')]);
  assert.equal(calls, 1); assert.equal(result.filter(row => row.suppressed).length, 1);
});
