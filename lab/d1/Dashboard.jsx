import {useEffect,useState} from 'react';
import Home from '@/pages/Home';
import StatCard from '@/components/shared/StatCard';
import {Users,Briefcase,Wallet,Receipt} from 'lucide-react';
import {base44} from './client.mjs';
export default function Dashboard({attendanceAvailable=false}){
 const [data,setData]=useState({}),[failed,setFailed]=useState([]);
 useEffect(()=>{let active=true;for(const entity of ['Employee','Sector','JobRole','FinancialExpense','EmployeePayment'])base44.entities[entity].list('-created_date',100000).then(records=>{if(active)setData(d=>({...d,[entity]:records}));}).catch(()=>{if(active)setFailed(d=>[...d,entity]);});return()=>{active=false;};},[]);
 const count=e=>failed.includes(e)?'Indisponível':data[e]?.length??'Consultando…';
 return <Home title="Dashboard" attendanceAvailable={attendanceAvailable} summary={<div className="space-y-4"><p className="text-sm text-muted-foreground">Registros consultados na API local. Contagens históricas não representam saldo atual ou valores a pagar.</p><div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><StatCard label="Colaboradores" value={count('Employee')} icon={Users} tone="amber"/><StatCard label="Setores" value={count('Sector')} icon={Briefcase}/><StatCard label="Despesas registradas" value={count('FinancialExpense')} icon={Receipt}/><StatCard label="Pagamentos registrados" value={count('EmployeePayment')} icon={Wallet}/></div></div>}/>;
}
