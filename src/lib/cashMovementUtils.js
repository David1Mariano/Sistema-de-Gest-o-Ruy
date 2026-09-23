export const cashToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const cashMoney = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const cashDate = (value) => value ? String(value).slice(0, 10).split('-').reverse().join('/') : '—';
export const sourceLabels = { caixa_1: 'Caixa 1', caixa_2: 'Caixa 2', delivery: 'Delivery' };
export const channelLabels = { loja: 'Loja', ifood: 'iFood', '99food': '99Food', brendi: 'Brendi', delivery_proprio: 'Delivery próprio' };
export const statusLabels = { em_preenchimento: 'Em preenchimento', conferido: 'Conferido', divergente: 'Divergente' };
export const entryTotal = (row) => ['cash', 'pix', 'debit', 'credit', 'voucher'].reduce((sum, key) => sum + Number(row?.[key] || 0), 0);
export const exitTotal = (row) => Number(row?.withdrawals || 0) + Number(row?.expenses || 0);
export const movementTotals = (rows) => rows.reduce((acc, row) => ({ entries: acc.entries + entryTotal(row), exits: acc.exits + exitTotal(row), balance: acc.balance + Number(row.expected_balance || 0), difference: acc.difference + Number(row.difference || 0), divergent: acc.divergent + (row.status === 'divergente' ? 1 : 0) }), { entries: 0, exits: 0, balance: 0, difference: 0, divergent: 0 });