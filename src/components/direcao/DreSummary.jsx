const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function DreSummary({ metrics }) {
  const rows = [
    ['Receita bruta', metrics.grossRevenueMonth, 'text-foreground'],
    ['(-) Descontos e taxas', metrics.deductionsMonth, 'text-destructive'],
    ['(=) Receita líquida', metrics.revenueMonth, 'text-emerald-600'],
    ['(-) Despesas operacionais', metrics.expenseMonth, 'text-destructive'],
  ];
  const margin = metrics.revenueMonth ? (metrics.resultMonth / metrics.revenueMonth) * 100 : 0;
  return <section className="rounded-xl border bg-card p-5"><div className="mb-4"><h2 className="font-semibold">DRE gerencial</h2><p className="mt-1 text-xs text-muted-foreground">Resultado simplificado do mês atual</p></div><div className="divide-y">{rows.map(([label, value, tone]) => <div key={label} className="flex justify-between gap-3 py-2.5 text-sm"><span className="text-muted-foreground">{label}</span><strong className={tone}>{money(value)}</strong></div>)}</div><div className="mt-2 flex items-end justify-between rounded-lg bg-muted p-3"><div><p className="text-sm font-medium">Resultado gerencial</p><p className="text-xs text-muted-foreground">Margem de {margin.toFixed(1)}%</p></div><strong className={`text-lg ${metrics.resultMonth >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>{money(metrics.resultMonth)}</strong></div></section>;
}