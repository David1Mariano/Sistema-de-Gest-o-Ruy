import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route,Navigate} from 'react-router-dom';
import Setores from '@/pages/Setores';
import Funcoes from '@/pages/Funcoes';
import Funcionarios from '@/pages/Funcionarios';
import Configuracoes from '@/pages/Configuracoes';
import Estoque from '@/pages/Estoque';
import Producao from '@/pages/Producao';
import Financeiro from '@/pages/Financeiro';
import ReceitasFinanceiras from '@/pages/ReceitasFinanceiras';
import RelatorioFinanceiro from '@/pages/RelatorioFinanceiro';
import Layout from '@/components/Layout';
import {ThemeProvider,useTheme} from '@/lib/theme/ThemeProvider';
import {setCurrentUser} from '@/lib/currentUserStore';
import {D1Auth} from './auth';
import {request,setSession,localDomain} from './client.mjs';
import ConsumptionControls from './ConsumptionControls';
import '@/index.css';
localDomain.ConsumptionControls=ConsumptionControls;
function App(){
 const [session,update]=useState(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(0);
 const {alternar}=useTheme();
 const adopt=value=>{setSession(value);update(value);setCurrentUser(value?{...value.user,full_name:'Operador fictício D1'}:null);};
 useEffect(()=>{request('/me').then(adopt).catch(()=>{}).finally(()=>setReady(true));},[]);
 useEffect(()=>{const listener=e=>setError(e.detail);window.addEventListener('d1-error',listener);return()=>window.removeEventListener('d1-error',listener);},[]);
 useEffect(()=>{if(!session)return;const refresh=()=>request('/pending').then(r=>setPending(r.total)).catch(e=>setError(e.message));refresh();window.addEventListener('d1-changed',refresh);return()=>window.removeEventListener('d1-changed',refresh);},[session]);
 if(!ready)return <p>Carregando sessão local...</p>;
 if(!session)return <form className="mx-auto mt-12 max-w-md space-y-4 rounded-xl border bg-card p-6" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{adopt(await request('/login',{login:f.get('login'),password:f.get('password')}));setError('');}catch(err){setError(err.message);}}}>
  <h1 className="text-xl font-semibold">Laboratório D1 — acesso local</h1><p>Somente conta fictícia previamente criada. Sem vínculo com produção.</p>
  <label className="block">E-mail fictício<input className="block w-full border p-2 text-black" name="login" type="email" required autoComplete="username"/></label>
  <label className="block">Senha local<input className="block w-full border p-2 text-black" name="password" type="password" required autoComplete="current-password"/></label><button className="rounded bg-amber-500 px-4 py-2" type="submit">Entrar</button>{error&&<p role="alert">{error}</p>}
 </form>;
 return <D1Auth.Provider value={{user:{...session.user,full_name:'Operador fictício D1'},logout:async()=>{await request('/logout',{});adopt(null);}}}>
  <div className="border-b border-amber-500 bg-amber-100 p-2 text-sm text-amber-950" role="status">LAB D1 · Somente dados fictícios · Sincronização real DESATIVADA · {pending} alteração(ões) pendente(s) · Perfil {session.user.role} <button className="underline ml-3" onClick={alternar}>Alternar claro/escuro</button></div>
  {error&&<div role="alert" className="border border-red-500 bg-red-100 p-3 text-red-950">{error}<button className="ml-3 underline" onClick={()=>setError('')}>Fechar aviso</button></div>}
  <Routes><Route element={<Layout/>}><Route path="/setores" element={<Setores/>}/><Route path="/funcoes" element={<Funcoes/>}/><Route path="/funcionarios" element={<Funcionarios/>}/><Route path="/configuracoes" element={<Configuracoes/>}/><Route path="/estoque" element={<Estoque/>}/><Route path="/producao" element={<Producao/>}/><Route path="/financeiro" element={<><p className="rounded border p-3">Laboratório: documentos financeiros locais não executam pagamentos externos. Lotes, vales/RH, fechamento global e anexos privados aguardam integração e homologação; comandos não portados são recusados.</p><Financeiro/></>}/><Route path="/ReceitasFinanceiras" element={<ReceitasFinanceiras/>}/><Route path="/RelatorioFinanceiro" element={<RelatorioFinanceiro/>}/><Route path="/receitas-financeiras" element={<ReceitasFinanceiras/>}/><Route path="/relatorio-financeiro" element={<RelatorioFinanceiro/>}/><Route path="/" element={<Navigate to="/setores" replace/>}/><Route path="*" element={<p>Esta tela aguarda integração offline validada. <a href="/setores">Voltar a Setores</a></p>}/></Route></Routes>
 </D1Auth.Provider>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider><BrowserRouter><App/></BrowserRouter></ThemeProvider>);
