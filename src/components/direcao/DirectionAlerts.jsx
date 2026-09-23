import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, CalendarClock, Factory, ReceiptText } from 'lucide-react';

const groups = (metrics) => [
  { label: 'Contas vencidas', count: metrics.overdue.length, detail: 'Exigem regularização', icon: ReceiptText, path: '/relatorios/financeiro', tone: 'text-destructive' },
  { label: 'Estoque crítico', count: metrics.lowStock.length, detail: 'Itens no mínimo ou abaixo', icon: Boxes, path: '/estoque', tone: 'text-amber-600' },
  { label: 'Produção pendente', count: metrics.productionPending.length, detail: 'Ordens de hoje não iniciadas', icon: Factory, path: '/producao', tone: 'text-amber-600' },
  { label: 'Experiência vencendo', count: metrics.experienceEnding.length, detail: 'Próximos 15 dias', icon: CalendarClock, path: '/funcionarios', tone: 'text-sky-600' },
];

export default function DirectionAlerts({ metrics }) {
  const alerts = groups(metrics);
  const total = alerts.reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div><h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />Alertas da direção</h2><p className="mt-1 text-xs text-muted-foreground">Pontos que precisam de atenção</p></div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{total}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {alerts.map(({ label, count, detail, icon: Icon, path, tone }) => <Link key={label} to={path} className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60"><div className="rounded-lg bg-muted p-2"><Icon className={`h-4 w-4 ${tone}`} /></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{detail}</p></div><strong className={tone}>{count}</strong></Link>)}
      </div>
    </section>
  );
}