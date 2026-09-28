// Valores em centavos. Informação ausente continua null, nunca vira zero.
export const moneyOrUnknown = cents => cents == null ? 'Não disponível' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function summarizeDelivery(rows) {
  const unique = [...new Map(rows.map(row => [`${row.platform}:${row.merchant_id}:${row.external_id}`, row])).values()];
  const completed = unique.filter(row => row.data.status === 'concluded');
  const sum = field => !completed.length || completed.some(row => row.data.money[field] == null) ? null : completed.reduce((n, row) => n + row.data.money[field], 0);
  const total = sum('customer_total');
  return { orders: unique.length, completed: completed.length, cancelled: unique.filter(r => r.data.status === 'cancelled').length,
    gross: sum('gross'), discounts: sum('discounts'), fees: sum('fees'), net: sum('net'), customerTotal: total,
    average: total == null || !completed.length ? null : Math.round(total / completed.length) };
}
