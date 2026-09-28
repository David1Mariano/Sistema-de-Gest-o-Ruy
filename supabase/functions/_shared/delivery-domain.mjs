export class DeliveryError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const FOOD99_BLOCKED = 'AGUARDANDO HOMOLOGAÇÃO/CREDENCIAIS 99FOOD';
export function normalize99Food() { throw new DeliveryError('FOOD99_NOT_AVAILABLE', 501); }
export function requiredString(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new DeliveryError('INVALID_PROVIDER_PAYLOAD');
  return value;
}
export function cents(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 100))) throw new DeliveryError('INVALID_MONEY');
  return Math.round(value * 100);
}
export function eventEnvelope(event) {
  const created = Date.parse(event?.createdAt);
  if (!Number.isFinite(created)) throw new DeliveryError('INVALID_EVENT_DATE');
  return { id: requiredString(event.id), merchantId: requiredString(event.merchantId),
    orderId: requiredString(event.orderId), code: requiredString(event.code),
    fullCode: typeof event.fullCode === 'string' ? event.fullCode.slice(0, 100) : null,
    createdAt: new Date(created).toISOString() };
}
const states = { PLC: 'placed', CFM: 'confirmed', RTP: 'ready', DSP: 'dispatched', CON: 'concluded', CAN: 'cancelled' };
export const ifoodStatus = code => states[code] || 'unknown';
export function normalizeIFood(order, event) {
  const e = eventEnvelope(event);
  if (order?.id !== e.orderId || order?.merchant?.id !== e.merchantId) throw new DeliveryError('MERCHANT_ORDER_MISMATCH', 403);
  if (!Number.isFinite(Date.parse(order.createdAt))) throw new DeliveryError('INVALID_ORDER_DATE');
  const total = order.total || {};
  const money = { subtotal: cents(total.subTotal), discounts: cents(total.benefits), delivery_fee: cents(total.deliveryFee),
    additions: cents(total.additionalFees), customer_total: cents(total.orderAmount), commission: null, fees: null, net: null, refund: null, receivable: null, payout: null };
  const gross = [money.subtotal, money.delivery_fee, money.additions];
  money.gross = gross.every(v => v !== null) ? gross.reduce((a, b) => a + b, 0) : null;
  return {
    platform: 'ifood', external_id: e.orderId, merchant_id: e.merchantId,
    number: order.displayId == null ? null : String(order.displayId).slice(0, 100),
    ordered_at: new Date(order.createdAt).toISOString(), status: states[e.code] || 'unknown', event_at: e.createdAt,
    event_id: e.id, cancelled: e.code === 'CAN', money,
    items: Array.isArray(order.items) ? order.items.map(i => ({ id: i.id ?? null, name: typeof i.name === 'string' ? i.name.slice(0, 300) : null,
      quantity: typeof i.quantity === 'number' && Number.isFinite(i.quantity) ? i.quantity : null, total: cents(i.totalPrice) })) : null,
    payments: Array.isArray(order.payments?.methods) ? order.payments.methods.map(p => ({ method: p.method ?? null, type: p.type ?? null,
      currency: p.currency ?? null, value: cents(p.value) })) : null,
    financial_status: 'pending_reconciliation', origin: 'ifood_api',
  };
}
export function mayApply(previous, next) {
  if (!previous) return true;
  if (Date.parse(next.event_at) < Date.parse(previous.event_at)) return false;
  if (previous.status === 'cancelled' && next.status !== 'cancelled') return false;
  if (Date.parse(next.event_at) === Date.parse(previous.event_at) && next.status !== 'cancelled') return false;
  if (previous.status === 'concluded' && !['concluded', 'cancelled'].includes(next.status)) return false;
  return true;
}
export function publicFailure(error) {
  const code = error instanceof DeliveryError ? error.code : 'INTEGRATION_UNAVAILABLE';
  return { code, status: error instanceof DeliveryError ? error.status : 503 };
}
