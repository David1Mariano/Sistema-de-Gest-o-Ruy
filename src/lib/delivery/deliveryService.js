// Serviço Delivery: idempotente (client_token) + transições validadas + auditoria.
// Espelha stockService: checa token antes de escrever; usa transact do backend.
import { totalsOf, validateOrder, canTransition, DeliveryError } from './deliveryRules.js';

export function newDeliveryToken(prefix = 'del') {
  const rnd = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replaceAll('-', '').slice(0, 18);
  return `${prefix}_${rnd}`;
}

function clients(base44) {
  return {
    Order: base44.entities.DeliveryOrder, Item: base44.entities.DeliveryOrderItem,
    Pay: base44.entities.DeliveryPayment, Fee: base44.entities.DeliveryFee,
    Assign: base44.entities.DeliveryDriverAssignment, Audit: base44.entities.DeliveryAuditEvent,
  };
}

export async function findOrderByToken(base44, clientToken) {
  if (!clientToken) return null;
  const rows = await base44.entities.DeliveryOrder.filter({ client_token: clientToken });
  return rows?.[0] || null;
}

export async function createOrder(base44, input, { user = 'sistema' } = {}) {
  const t = clients(base44);
  validateOrder(input);
  if (input.client_token) {
    const dup = await findOrderByToken(base44, input.client_token);
    if (dup) return { order: dup, duplicated: true };
  }
  const totals = totalsOf(input);
  const order = await t.Order.create({
    client_token: input.client_token || newDeliveryToken(),
    customer_id: input.customer_id || '', customer_name: input.customer_name,
    customer_phone: input.customer_phone || '', channel: input.channel || 'balcao',
    fulfillment: input.fulfillment || 'entrega', status: 'novo',
    address_id: input.address_id || '', address_text: input.address_text || '',
    coupon: input.coupon || '', observation: input.observation || '',
    ...totals, created_by: user,
  });
  await t.Item.bulkCreate((input.items || []).map((i) => ({
    order_id: order.id, product_id: i.product_id || '', product_name: i.product_name,
    qty: Number(i.qty), unit_price_cents: Number(i.unit_price_cents),
    line_total_cents: Number(i.qty) * Number(i.unit_price_cents),
    notes: i.notes || '', addons_text: i.addons_text || '',
  })));
  await t.Audit.create({ order_id: order.id, event: 'criado', from_status: '', to_status: 'novo', actor: user });
  return { order, duplicated: false };
}

export async function transitionOrder(base44, orderId, to, { user = 'sistema', reason = '' } = {}) {
  const t = clients(base44);
  const current = await t.Order.get(orderId).catch(async () => (await t.Order.filter({ id: orderId }))[0]);
  if (!current) throw new DeliveryError('Pedido não encontrado.', 'pedido_ausente');
  if (!canTransition(current.status, to)) throw new DeliveryError(`Transição ${current.status} → ${to} inválida.`, 'transicao_invalida');
  if (to === 'cancelado' && !reason) throw new DeliveryError('Cancelamento exige motivo.', 'motivo_obrigatorio');
  const saved = typeof t.Order.transact === 'function'
    ? await t.Order.transact(orderId, (row) => {
        if (!canTransition(row.status, to)) throw new DeliveryError('Estado mudou no servidor.', 'conflito_estado');
        return { status: to, cancel_reason: to === 'cancelado' ? reason : row.cancel_reason };
      })
    : await t.Order.update(orderId, { status: to, cancel_reason: to === 'cancelado' ? reason : current.cancel_reason });
  await t.Audit.create({ order_id: orderId, event: to === 'cancelado' ? 'cancelado' : 'transicao', from_status: current.status, to_status: to, actor: user, reason });
  return saved;
}

export async function assignDriver(base44, orderId, { driver_id, driver_name, fee_cents = 0, user = 'sistema' }) {
  const t = clients(base44);
  if (!driver_id) throw new DeliveryError('Selecione o entregador.', 'entregador_obrigatorio');
  const a = await t.Assign.create({ order_id: orderId, driver_id, driver_name, fee_cents, status: 'em_entrega', assigned_by: user });
  await t.Audit.create({ order_id: orderId, event: 'entregador_atribuido', from_status: '', to_status: '', actor: user, reason: driver_name });
  return a;
}
