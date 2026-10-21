import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {request} from './client.mjs';
export default function Dashboard(){
 const [counts,setCounts]=useState(null),[error,setError]=useState(false);
 useEffect(()=>{let active=true;Promise.all([request('/entities/Employee'),request('/entities/Sector'),request('/entities/JobRole')]).then(rows=>{if(active)setCounts(rows.map(r=>r.records.length));}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
 return <section className="space-y-4"><h1 className="text-2xl font-semibold">Dashboard</h1><p>Resumo dos cadastros acessíveis à sua conta nesta instalação. Não representa conciliação financeira ou saldo de estoque.</p>{error?<p role="alert">Não foi possível consultar os indicadores.</p>:counts?<dl className="flex gap-8">{['Colaboradores','Setores','Funções'].map((name,i)=><div key={name}><dt>{name}</dt><dd>{counts[i]}</dd></div>)}</dl>:<p>Consultando indicadores…</p>}<nav className="flex flex-wrap gap-4">{[['/funcionarios','Colaboradores'],['/estoque','Estoque'],['/producao','Produção'],['/financeiro','Financeiro'],['/anexos','Anexos'],['/delivery-lab','Delivery'],['/acessos','Acessos individuais']].map(([to,label])=><Link key={to} className="underline" to={to}>{label}</Link>)}</nav></section>;
}
