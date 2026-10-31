import {useEffect,useState} from 'react';
import Home from '@/pages/Home';
import StatCard from '@/components/shared/StatCard';
import {Users,Briefcase,Wallet,Receipt} from 'lucide-react';
import {base44} from './client.mjs';
import {buildFinancialDashboard} from '@/lib/financialDashboard';
import {formatExpenseAmount} from '@/lib/dailyExpenses';
export default function Dashboard({attendanceAvailable=false}){
 const [data,setData]=useState({}),[failed,setFailed]=useState([]);
 useEffect(()=>{let active=true;const refresh=()=>{setFailed([]);for(const entity of ['Employee','Sector','JobRole','FinancialExpense','AccountsPayable','EmployeePayment'])base44.entities[entity].list('-created_date',100000).then(records=>{if(active)setData(d=>({...d,[entity]:records}));}).catch(()=>{if(active)setFailed(d=>[...d,entity]);});};refresh();window.addEventListener('d1-changed',refresh);return()=>{active=false;window.removeEventListener('d1-changed',refresh);};},[]);
 const count=e=>failed.includes(e)?'Indisponível':data[e]?.length??'Consultando…';
 const totals=buildFinancialDashboard({expenses:data.FinancialExpense,payables:data.AccountsPayable}),financial=k=>['FinancialExpense','AccountsPayable'].some(e=>failed.includes(e))?'Indisponível':!data.FinancialExpense||!data.AccountsPayable?'Consultando…':formatExpenseAmount(totals[k]);
 return <Home title="Dashboard" attendanceAvailable={attendanceAvailable} summary={<div className="space-y-4"><p className="text-sm text-muted-foreground">Documentos da central, sem duplicar gastos e contas vinculadas. Valores previstos e pagos não representam saldo de abertura de caixa ou banco.</p><div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><StatCard label="Colaboradores" value={count('Employee')} icon={Users} tone="amber"/><StatCard label="Setores" value={count('Sector')} icon={Briefcase}/><StatCard label="Despesas registradas" value={count('FinancialExpense')} icon={Receipt}/><StatCard label="Pagamentos registrados" value={count('EmployeePayment')} icon={Wallet}/><StatCard label="Despesas previstas" value={financial('total')} icon={Receipt}/><StatCard label="Obrigações pendentes" value={financial('pending')} icon={Wallet}/><StatCard label="Despesas pagas" value={financial('paid')} icon={Wallet}/></div></div>}/>;
}
