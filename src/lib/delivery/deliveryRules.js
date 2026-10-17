// Regras PURAS do Delivery (rodam no Node e no browser, sem banco).
// Referencias: phojie (maquina de estados), beepbite (canais plugaveis),
// roshanx0 (funil QR/bills). Nenhum codigo copiado.
import { sumCents, pctCents } from './money.js';

export const ORDER_STATUS = {
  NOVO: 'novo', PREPARO: 'preparo', EXPEDICAO: 'expedicao',
  ENTREGUE: 'entregue', RECEBIDO: 'recebido', CANCELADO: 'cancelado',
};
export const STATUS_LABEL = {
  novo: 'Novo', preparo: 'Em preparo', expedicao: 'Em expedição',
  entregue: 'Entregue', recebido: 'Recebido', cancelado: 'Cancelado',
};
const FLOW = {
  novo: ['preparo', 'cancelado'], preparo: ['expedicao', 'cancelado'],
  expedicao: ['entregue', 'cancelado'], entregue: ['recebido'],
  recebido: [], cancelado: [],
};
export function canTransition(from, to) { return (FLOW[from] || []).includes(to); }

export const CHANNELS = {
  balcao: 'Balcão', retirada: 'Retirada', local: 'Consumo local',
  whatsapp: 'WhatsApp', ifood: 'iFood', food99: '99Food',
};
export const CHANNEL_FEE_PCT = { ifood: 27, food99: 18, whatsapp: 0, balcao: 0, retirada: 0, local: 0 };

export class DeliveryError extends Error {
  constructor(message, code) { super(message); this.name = 'DeliveryError'; this.code = code || 'delivery_invalido'; }
}

// Totais em centavos: bruto - desconto + entrega - taxas = liquido estimado.
export function totalsOf({ items = [], discount_cents = 0, delivery_fee_cents = 0, channel = 'balcao', pay_fee_cents = 0 }) {
  const gross = sumCents(items.map((i) => (Number(i.qty) || 0) * (Number(i.unit_price_cents) || 0)));
  const platform = pctCents(gross, CHANNEL_FEE_PCT[channel] || 0);
  const net = gross - (Number(discount_cents) || 0) + (Number(delivery_fee_cents) || 0) - platform - (Number(pay_fee_cents) || 0);
  return { gross_cents: gross, discount_cents, delivery_fee_cents, platform_fee_cents: platform, pay_fee_cents, net_cents: net };
}

export function validateOrder({ customer_name, items, channel, fulfillment }) {
  if (!customer_name || !String(customer_name).trim()) throw new DeliveryError('Informe o cliente.', 'cliente_obrigatorio');
  if (!Array.isArray(items) || !items.length) throw new DeliveryError('Adicione ao menos 1 item.', 'itens_obrigatorios');
  for (const i of items) {
    if (!i.product_name || !(Number(i.qty) > 0) || !(Number(i.unit_price_cents) >= 0))
      throw new DeliveryError('Item inválido: nome, qtd > 0 e preço >= 0.', 'item_invalido');
  }
  if (!CHANNELS[channel]) throw new DeliveryError('Canal inválido.', 'canal_invalido');
  if (!['entrega', 'retirada', 'local'].includes(fulfillment)) throw new DeliveryError('Modalidade inválida.', 'modalidade_invalida');
  return true;
}

// Preço sugerido p/ cobrir taxa do canal sem alterar preço real automaticamente.
export function suggestedPrice(base_cents, channel) {
  const pct = CHANNEL_FEE_PCT[channel] || 0;
  if (!pct) return Number(base_cents) || 0;
  return Math.ceil((Number(base_cents) || 0) / (1 - pct / 100));
}

export function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 10) return '•••';
  return `(${d.slice(0, 2)}) ••••-${d.slice(-4)}`;
}
