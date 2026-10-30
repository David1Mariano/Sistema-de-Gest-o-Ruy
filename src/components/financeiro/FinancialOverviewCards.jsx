import { Wallet, Users, Bike, Package, BadgeDollarSign, Receipt, AlertTriangle } from 'lucide-react';
import Stat from './FinancialStat';
import { dashboardValue } from '../../lib/financialDashboard.js';
import { formatExpenseAmount } from '../../lib/dailyExpenses.js';

export default function FinancialOverviewCards({ stats, sourceStates }) {
  const cardValue = (value, alias = 'expenses', money = true) => dashboardValue(value, [alias], sourceStates, money ? formatExpenseAmount : String);
  return (<div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Saídas pagas" value={cardValue(stats.paid)} icon={Wallet}/>
        <Stat label="Pagamentos de pessoas" value={cardValue(stats.personnel)} icon={Users}/>
        <Stat label="Diárias de motoboy" value={cardValue(stats.motoboy, 'payments')} icon={Bike}/>
        <Stat label="Insumos" value={cardValue(stats.inputs)} icon={Package}/>
        <Stat label="Vales/adiantamentos" value={cardValue(stats.advances)} icon={BadgeDollarSign}/>
        <Stat label="Pendentes" value={cardValue(stats.pending)} icon={Receipt} danger={stats.pending>0}/>
        <Stat label="Pagos sem comprovante" value={cardValue(stats.noProof, 'expenses', false)} icon={AlertTriangle} danger={stats.noProof>0}/>
        <Stat label="Lançamentos no período" value={cardValue(stats.periodCount, 'expenses', false)} icon={Receipt}/>
      </div>);
}
