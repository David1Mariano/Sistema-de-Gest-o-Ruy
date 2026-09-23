import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useUserRole } from '@/lib/useUserRole';
import { buildDirectionMetrics } from '@/lib/directionMetrics';
import DirectionMetric from '@/components/direcao/DirectionMetric';
import DirectionAlerts from '@/components/direcao/DirectionAlerts';
import DirectionChannels from '@/components/direcao/DirectionChannels';
import CashProjection from '@/components/direcao/CashProjection';
import DreSummary from '@/components/direcao/DreSummary';
import DirectionCashFlow from '@/components/direcao/DirectionCashFlow';
import { BadgeDollarSign, Banknote, TrendingUp, UserCheck, UserX, WalletCards } from 'lucide-react';

const empty = { revenues: [], expenses: [], payables: [], receivables: [], accounts: [], inventory: [], absences: [], orders: [], employees: [], payments: [], cashMovements: [], sangrias: [], cashCloses: [] };
const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Direcao() {
  const { isAdmin } = useUserRole();
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(true);
  const load = () => Promise.all(['Revenue', 'FinancialExpense', 'AccountsPayable', 'AccountsReceivable', 'FinancialAccount', 'InventoryItem', 'Absence', 'ProductionOrder', 'Employee', 'EmployeePayment', 'CashMovement', 'Sangria', 'FechamentoCaixa'].map((name) => base44.entities[name].list('-created_date', 1500))).then((values) => { setData(Object.fromEntries(Object.keys(empty).map((key, index) => [key, values[index]]))); setLoading(false); });
  useEffect(() => { if (!isAdmin) return undefined; load(); const unsubscribe = base44.entities.CashMovement.subscribe(() => load()); return unsubscribe; }, [isAdmin]);
  const metrics = useMemo(() => buildDirectionMetrics(data), [data]);
  if (!isAdmin) return <div className="rounded-xl border bg-card p-10 text-center"><h1 className="text-xl font-semibold">Acesso restrito</h1><p className="mt-2 text-muted-foreground">O Painel da Direção exige permissão de administrador.</p></div>;
  if (loading) return <div className="py-20 text-center text-muted-foreground">Carregando visão executiva...</div>;
  return <div className="space-y-5"><header><p className="text-sm text-muted-foreground">Visão consolidada em tempo real</p><h1 className="text-2xl font-semibold tracking-tight">Painel da Direção</h1></header><DirectionCashFlow movements={data.cashMovements} revenues={data.revenues} sangrias={data.sangrias} closes={data.cashCloses}/><section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Hoje</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><DirectionMetric label="Receita líquida" value={money(metrics.revenueToday)} detail="Receitas registradas hoje" icon={BadgeDollarSign} tone="text-emerald-600"/><DirectionMetric label="Despesas" value={money(metrics.expenseToday)} detail="Gastos registrados hoje" icon={WalletCards} tone="text-destructive"/><DirectionMetric label="Saldo do dia" value={money(metrics.balanceToday)} detail="Receitas menos despesas" icon={TrendingUp} tone={metrics.balanceToday >= 0 ? 'text-emerald-600' : 'text-destructive'}/><DirectionMetric label="Faltas e ocorrências" value={metrics.absencesToday.length} detail={`${metrics.activeEmployees} colaboradores ativos`} icon={UserX} tone={metrics.absencesToday.length ? 'text-amber-600' : 'text-emerald-600'}/></div></section><section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Mês atual</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><DirectionMetric label="Receita acumulada" value={money(metrics.revenueMonth)} detail="Receita líquida do mês" icon={Banknote} tone="text-emerald-600"/><DirectionMetric label="Despesas acumuladas" value={money(metrics.expenseMonth)} detail="Gastos do mês" icon={WalletCards} tone="text-destructive"/><DirectionMetric label="Resultado estimado" value={money(metrics.resultMonth)} detail="Antes de ajustes contábeis" icon={TrendingUp} tone={metrics.resultMonth >= 0 ? 'text-emerald-600' : 'text-destructive'}/><DirectionMetric label="Custo com pessoal" value={money(metrics.peopleCost)} detail="Pagamentos no mês" icon={UserCheck} tone="text-sky-600"/></div></section><div className="grid gap-5 lg:grid-cols-2"><CashProjection metrics={metrics}/><DreSummary metrics={metrics}/><DirectionAlerts metrics={metrics}/><DirectionChannels channels={metrics.channels}/></div></div>;
}