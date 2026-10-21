import {useEffect,useState} from 'react';
import Home from '@/pages/Home';
import StatCard from '@/components/shared/StatCard';
import {Users,Briefcase,Wallet,Receipt} from 'lucide-react';
import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip} from 'recharts';
import {base44} from './client.mjs';
export default function Dashboard({attendanceAvailable=false}){
 const [data,setData]=useState({}),[failed,setFailed]=useState([]);
 useEffect(()=>{let active=true;for(const entity of ['Employee','Sector','JobRole','FinancialExpense','EmployeePayment'])base44.entities[entity].list('-created_date',100000).then(records=>{if(active)setData(d=>({...d,[entity]:records}));}).catch(()=>{if(active)setFailed(d=>[...d,entity]);});return()=>{active=false;};},[]);
 const count=e=>failed.includes(e)?'Indisponível':data[e]?.length??'Consultando…';
 const graph=['FinancialExpense','EmployeePayment'].filter(e=>Array.isArray(data[e])).map(e=>({name:e==='FinancialExpense'?'Despesas':'Pagamentos',registros:data[e].length}));
 return <Home title="Dashboard" attendanceAvailable={attendanceAvailable} summary={<div className="space-y-4"><p className="text-sm text-muted-foreground">Registros consultados na API local. Contagens históricas não representam saldo atual ou valores a pagar.</p><div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><StatCard label="Colaboradores" value={count('Employee')} icon={Users} tone="amber"/><StatCard label="Setores" value={count('Sector')} icon={Briefcase}/><StatCard label="Despesas registradas" value={count('FinancialExpense')} icon={Receipt}/><StatCard label="Pagamentos registrados" value={count('EmployeePayment')} icon={Wallet}/></div>{graph.length>0&&<div className="rounded-2xl border bg-card p-5"><h2 className="font-semibold">Documentos financeiros preservados</h2><div className="h-48" role="img" aria-label={graph.map(r=>`${r.name}: ${r.registros} registros`).join('; ')}><ResponsiveContainer width="100%" height="100%"><BarChart data={graph}><XAxis dataKey="name"/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="registros" fill="#d97706"/></BarChart></ResponsiveContainer></div></div>}</div>}/>;
}
