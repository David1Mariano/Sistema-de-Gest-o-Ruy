// Blocos compartilhados da pagina Delivery (KPIs, tabelas, CSV/PDF).
import { brl } from './money.js';

export function kpisOf(orders) {
  const ok = orders.filter((o) => o.status !== 'cancelado');
  const gross = ok.reduce((a, o) => a + (o.gross_cents || 0), 0);
  const net = ok.reduce((a, o) => a + (o.net_cents || 0), 0);
  const canc = orders.filter((o) => o.status === 'cancelado').length;
  return {
    faturamento: gross, liquido: net, pedidos: orders.length,
    ticket: ok.length ? Math.round(gross / ok.length) : 0, cancelados: canc,
  };
}

export function downloadCsv(filename, header, lines) {
  const rows = [header, ...lines];
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}

export function printSection(title) {
  document.title = title; window.print();
}

export const Kpi = ({ label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
    {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
  </div>
);

export const fmtBrl = (c) => brl(c);
