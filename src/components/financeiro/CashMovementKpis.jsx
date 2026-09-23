import { ArrowDownToLine, ArrowUpFromLine, Scale, ShieldCheck } from 'lucide-react';
import { cashMoney } from '@/lib/cashMovementUtils';
const cards = (t) => [
  ['Entradas totais', cashMoney(t.entries), ArrowDownToLine, 'text-cash-positive', 'border-l-cash-positive'],
  ['Saídas / sangrias', cashMoney(t.exits), ArrowUpFromLine, 'text-cash-alert', 'border-l-cash-alert'],
  ['Saldo calculado', cashMoney(t.balance), Scale, 'text-cash-text', 'border-l-cash-secondary'],
  ['Divergências / alertas', t.divergent ? `${t.divergent} · ${cashMoney(t.difference)}` : 'Tudo conferido', ShieldCheck, t.divergent ? 'text-cash-alert' : 'text-cash-positive', t.divergent ? 'border-l-cash-alert' : 'border-l-cash-positive'],
];
export default function CashMovementKpis({ totals }) {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards(totals).map(([label, value, Icon, tone, edge]) => <div key={label} className={`rounded-cash border border-cash-border border-l-4 bg-cash-card p-4 ${edge}`}><div className="flex items-start justify-between gap-2"><div><p className="font-body text-xs font-medium uppercase tracking-wide text-cash-secondary">{label}</p><p className={`mt-2 font-display text-xl font-bold tabular-nums ${tone}`}>{value}</p></div><Icon className={`h-5 w-5 ${tone}`} /></div></div>)}</div>;
}