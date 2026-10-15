// Seed SINTETICO de laboratorio (nunca dados reais). Para a pagina Delivery
// funcionar sem backend: pedidos, clientes, entregadores, taxas e cardapio demo.
export const DEMO_MENU = [
  { id: 'm1', name: 'Caldo de cana 500ml', base_cents: 800, cost_cents: 250 },
  { id: 'm2', name: 'Pastel de carne', base_cents: 1200, cost_cents: 480 },
  { id: 'm3', name: 'Coxinha', base_cents: 900, cost_cents: 320 },
  { id: 'm4', name: 'Suco natural 400ml', base_cents: 1000, cost_cents: 350 },
];
export const DEMO_DRIVERS = [
  { id: 'd1', name: 'Carlos Motoboy', phone: '11988887777', fee_cents: 600, status: 'disponivel', deliveries: 128 },
  { id: 'd2', name: 'Ana Entregadora', phone: '11977776666', fee_cents: 600, status: 'disponivel', deliveries: 96 },
  { id: 'd3', name: 'João Freelancer', phone: '11966665555', fee_cents: 700, status: 'indisponivel', deliveries: 41 },
];
const C = (id, day, channel, status, items, extra = {}) => {
  const gross = items.reduce((a, i) => a + i.qty * i.unit_price_cents, 0);
  return {
    id, created_date: `2026-10-${String(day).padStart(2, '0')}T12:00:00`, channel, status,
    customer_name: extra.customer || 'Cliente Demo', fulfillment: 'entrega',
    payment_method: extra.pay || 'pix', gross_cents: gross,
    discount_cents: extra.discount || 0, delivery_fee_cents: 500,
    platform_fee_cents: channel === 'ifood' ? Math.round(gross * 0.27) : 0,
    net_cents: gross - (extra.discount || 0) + 500 - (channel === 'ifood' ? Math.round(gross * 0.27) : 0),
    items, driver: extra.driver || '',
  };
};
export const DEMO_ORDERS = [
  C('p1', 15, 'ifood', 'entregue', [{ product_name: 'Caldo de cana 500ml', qty: 2, unit_price_cents: 1010 }], { customer: 'Maria Silva', pay: 'cartao_credito' }),
  C('p2', 15, 'whatsapp', 'preparo', [{ product_name: 'Pastel de carne', qty: 3, unit_price_cents: 1200 }], { customer: 'José Souza', pay: 'pix', driver: 'Carlos Motoboy' }),
  C('p3', 14, 'balcao', 'recebido', [{ product_name: 'Coxinha', qty: 5, unit_price_cents: 900 }], { customer: 'Ana Lima', pay: 'dinheiro' }),
  C('p4', 14, 'food99', 'cancelado', [{ product_name: 'Suco natural 400ml', qty: 1, unit_price_cents: 1180 }], { customer: 'Paulo Rocha', pay: 'pix' }),
  C('p5', 13, 'whatsapp', 'entregue', [{ product_name: 'Caldo de cana 500ml', qty: 4, unit_price_cents: 800 }], { customer: 'Maria Silva', pay: 'pix', driver: 'Ana Entregadora' }),
  C('p6', 12, 'ifood', 'recebido', [{ product_name: 'Pastel de carne', qty: 2, unit_price_cents: 1520 }], { customer: 'Lúcia Prado', pay: 'cartao_debito' }),
];
export const DEMO_CUSTOMERS = [
  { id: 'c1', name: 'Maria Silva', phone: '11999990001', orders: 14, total_cents: 38200 },
  { id: 'c2', name: 'José Souza', phone: '11999990002', orders: 6, total_cents: 14100 },
  { id: 'c3', name: 'Ana Lima', phone: '11999990003', orders: 3, total_cents: 4500 },
];
