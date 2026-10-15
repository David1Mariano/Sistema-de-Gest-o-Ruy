// Delivery — dinheiro em CENTAVOS inteiros (nunca float).
// Tela pt-BR com virgula; estado/banco = inteiro. Faturamento != caixa.
export function toCents(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
export function fromCents(c) { return (Number(c) || 0) / 100; }
export function brl(c) {
  return fromCents(c).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function sumCents(arr) { return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0); }
export function pctCents(base, pct) { return Math.round(((Number(base) || 0) * (Number(pct) || 0)) / 100); }
