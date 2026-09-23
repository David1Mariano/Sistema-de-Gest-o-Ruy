import { ArrowDownRight, ArrowUpRight, Landmark } from 'lucide-react';
const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CashProjection({ metrics }) {
  const rows = [
    { label: 'Saldo atual', value: metrics.currentBalance, icon: Landmark, tone: 'text-foreground' },
    { label: 'Entradas previstas', value: metrics.receivable30, icon: ArrowUpRight, tone: 'text-emerald-600' },
    { label: 'Saídas previstas', value: metrics.payable30, icon: ArrowDownRight, tone: 'text-destructive' },
  ];
  return <section className="rounded-xl border bg-card p-5"><div className="mb-4"><h2 className="font-semibold">Fluxo de caixa projetado</h2><p className="mt-1 text-xs text-muted-foreground">Previsão para os próximos 30 dias</p></div><div className="space-y-3">{rows.map(({ label, value, icon: Icon, tone }) => <div key={label} className="flex items-center justify-between rounded-lg bg-muted/60 p-3"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className={`h-4 w-4 ${tone}`}/>{label}</span><strong className={tone}>{money(value)}</strong></div>)}</div><div className="mt-4 flex items-center justify-between border-t pt-4"><span className="font-medium">Saldo projetado</span><strong className={`text-lg ${metrics.projectedBalance >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>{money(metrics.projectedBalance)}</strong></div></section>;
}