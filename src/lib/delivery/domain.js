// Public operational projection. No customer PII is imported by the current adapter.
export const CHANNELS = Object.freeze({ ifood: 'iFood', '99food': '99Food', whatsapp: 'WhatsApp', own: 'Canal próprio' });
export const ORDER_STATES = Object.freeze({ placed: 'Novos', confirmed: 'Aceitos', preparing: 'Em preparo', ready: 'Prontos', dispatched: 'Em entrega', concluded: 'Finalizados', cancelled: 'Cancelados', unknown: 'Não informado' });
export const orderKey = order => JSON.stringify([order.provider, order.merchantId, order.externalId]);
export function deliveryOrder(row) {
  const data = row.data;
  if (!data || !Object.hasOwn(CHANNELS, row.platform) || !row.merchant_id || !row.external_id || data.platform !== row.platform || data.merchant_id !== row.merchant_id || data.external_id !== row.external_id) throw Error('INVALID_DELIVERY_ORDER');
  return {
    provider: row.platform, merchantId: row.merchant_id, externalId: row.external_id,
    displayId: data.number ?? null, status: Object.hasOwn(ORDER_STATES, data.status) ? data.status : 'unknown',
    customer: null, items: data.items ?? null, money: data.money,
    payment: data.payments ?? null, deliveryType: data.delivery_type ?? null, address: null,
    timestamps: { placedAt: data.ordered_at, eventAt: data.event_at },
    rawReference: { eventId: data.event_id ?? null }, // Reference only, never raw provider body.
  };
}
export function filterOrders(orders, { channel = 'all', status = 'all', search = '' } = {}) {
  const query = search.trim().toLocaleLowerCase('pt-BR');
  return orders.filter(order => (channel === 'all' || order.provider === channel) && (status === 'all' || order.status === status) &&
    (!query || [order.displayId, order.externalId, order.customer?.name, order.customer?.phone].some(value => value && String(value).toLocaleLowerCase('pt-BR').includes(query))));
}
export function orderMetrics(orders) {
  const unique = [...new Map(orders.map(order => [orderKey(order), order])).values()];
  const done = unique.filter(order => order.status === 'concluded');
  const sales = !done.length || done.some(order => !Number.isSafeInteger(order.money?.customer_total)) ? null : done.reduce((total, order) => total + order.money.customer_total, 0);
  return { orders: unique.length, sales, average: sales == null ? null : Math.round(sales / done.length),
    preparing: unique.filter(order => order.status === 'preparing').length,
    waiting: unique.filter(order => order.status === 'placed').length,
    cancelled: unique.filter(order => order.status === 'cancelled').length };
}
