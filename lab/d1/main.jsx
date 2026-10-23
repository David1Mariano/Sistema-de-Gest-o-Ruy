import AccountAccess from './AccountAccess';
import AccountAdministration from './AccountAdministration';
import Dashboard from './Dashboard';
import {DirectionPanel,SocialPanel} from './ModulePanels';
import Advertencias from '@/pages/Advertencias';
import OcorrenciasFrequencia from '@/pages/OcorrenciasFrequencia';
import {windowsNavigation} from './navigation.mjs';
import RH from '@/pages/RH';
import Auditoria from '@/pages/Auditoria';
import Vales from '@/pages/Vales';
import Consumo from '@/pages/Consumo';
import LedgerReview from './LedgerReview';
import History from './History';
import Delivery from './Delivery';
import Reconciliation from './Reconciliation';
import Attachments from './Attachments';
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Routes,Route} from 'react-router-dom';
import Setores from '@/pages/Setores';
import Funcoes from '@/pages/Funcoes';
import Funcionarios from '@/pages/Funcionarios';
import FichaColaborador from '@/pages/FichaColaborador';
import Ponto from '@/pages/Ponto';
import Escalas from '@/pages/Escalas';
import Payroll from './Payroll';
import Purchases from './Purchases';
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
 const [session,update]=useState(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(0),[individual,setIndividual]=useState(false),[attendance,setAttendance]=useState(false),[payroll,setPayroll]=useState(false),[purchases,setPurchases]=useState(false);
 const {alternar}=useTheme();
 const adopt=value=>{setSession(value);update(value);setCurrentUser(value?{...value.user,full_name:value?.user.full_name||'Operador fictício D1'}:null);};
 useEffect(()=>{const expired=()=>adopt(null);window.addEventListener('d1-session-expired',expired);return()=>window.removeEventListener('d1-session-expired',expired);},[]);
 useEffect(()=>{request('/account/config').then(v=>setIndividual(v.enabled===true)).catch(()=>{});},[]);
 useEffect(()=>{setAttendance(false);setPayroll(false);if(session?.user.role==='admin'&&!session.historyOnly&&!session.operationalHistoryPreview)request('/attendance/status').then(v=>{setAttendance(v.enabled===true);setPayroll(v.payrollCalculationEnabled===true);}).catch(()=>{});},[session]);
 useEffect(()=>{setPurchases(false);if(session?.user.role==='admin'&&!session.historyOnly&&!session.operationalHistoryPreview)request('/modules/status').then(v=>setPurchases(v.purchaseReceipt===true)).catch(()=>{});},[session]);
 useEffect(()=>{request('/me').then(adopt).catch(()=>{}).finally(()=>setReady(true));},[]);
 useEffect(()=>{const listener=e=>setError(e.detail);window.addEventListener('d1-error',listener);return()=>window.removeEventListener('d1-error',listener);},[]);
 useEffect(()=>{if(!session||session.historyOnly)return;const refresh=()=>request('/pending').then(r=>setPending(r.total)).catch(e=>setError(e.message));refresh();window.addEventListener('d1-changed',refresh);return()=>window.removeEventListener('d1-changed',refresh);},[session]);
 if(!ready)return <p>Carregando sessão local...</p>;
 if(!session&&individual)return <AccountAccess adopt={adopt}/>;
 if(!session)return <form className="mx-auto mt-12 max-w-md space-y-4 rounded-xl border bg-card p-6" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{adopt(await request('/login',{login:f.get('login'),password:f.get('password')}));setError('');}catch(err){setError(err.message);}}}>
  <h1 className="text-xl font-semibold">Laboratório D1 — acesso local</h1><p>Somente conta fictícia previamente criada. Sem vínculo com produção.</p>
  <label className="block">E-mail fictício<input className="block w-full border p-2 text-black" name="login" type="email" required autoComplete="username"/></label>
  <label className="block">Senha local<input className="block w-full border p-2 text-black" name="password" type="password" required autoComplete="current-password"/></label><button className="rounded bg-amber-500 px-4 py-2" type="submit">Entrar</button>{error&&<p role="alert">{error}</p>}
 </form>;
 if(session.historyOnly)return <><div className="border-b p-2">Perfil histórico separado <button className="underline ml-3" onClick={async()=>{await request('/logout',{});adopt(null);}}>Sair</button></div><History/></>;
 return <D1Auth.Provider value={{navigationGroups:windowsNavigation({attendance,payroll,purchases,role:session.user.role}),user:{...session.user,full_name:session.user.full_name||'Operador fictício D1'},logout:async()=>{await request('/logout',{});adopt(null);}}}>
  <div className="border-b border-amber-500 bg-amber-100 p-2 text-sm text-amber-950" role="status">{session.operationalHistoryPreview?'DADOS RECUPERADOS · Banco isolado · Conferência nas telas normais · Alterações bloqueadas':'LAB D1 · Somente dados fictícios'} · Sincronização real DESATIVADA · {pending} alteração(ões) pendente(s) · Perfil {session.user.role} <button className="underline ml-3" onClick={alternar}>Alternar claro/escuro</button></div>
  {error&&<div role="alert" className="border border-red-500 bg-red-100 p-3 text-red-950">{error}<button className="ml-3 underline" onClick={()=>setError('')}>Fechar aviso</button></div>}
  <Routes><Route element={<Layout/>}><Route path="/compras" element={purchases?<Purchases/>:<p>Compras não habilitadas neste perfil.</p>}/><Route path="/direcao" element={session.user.role==='admin'?<DirectionPanel/>:<p>Acesso restrito.</p>}/><Route path="/redes-sociais" element={session.user.role==='admin'?<SocialPanel/>:<p>Acesso restrito.</p>}/><Route path="/advertencias" element={<Advertencias readOnly={!!session.operationalHistoryPreview||session.user.role!=='admin'}/>}/><Route path="/ocorrencias" element={<OcorrenciasFrequencia readOnly={!!session.operationalHistoryPreview||session.user.role!=='admin'}/>}/><Route path="/rh" element={<RH/>}/><Route path="/vales" element={<Vales/>}/><Route path="/consumo" element={<Consumo/>}/><Route path="/auditoria" element={session.user.role==='admin'?<Auditoria/>:<p>Acesso restrito.</p>}/><Route path="/caixa" element={<LedgerReview/>}/><Route path="/receitas" element={<ReceitasFinanceiras/>}/><Route path="/relatorios" element={<RelatorioFinanceiro/>}/><Route path="/gastos-diarios" element={<Financeiro/>}/><Route path="/folha" element={payroll?<Payroll/>:<p>Folha ainda nao habilitada neste banco.</p>}/><Route path="/ponto" element={attendance?<Ponto/>:<p>Jornada ainda nao habilitada neste banco; nenhum registro foi criado.</p>}/><Route path="/escalas" element={attendance?<Escalas/>:<p>Escalas ainda nao habilitadas neste banco.</p>}/><Route path="/acessos" element={<AccountAdministration/>}/><Route path="/Dashboard" element={<Dashboard attendanceAvailable={attendance}/>}/><Route path="/delivery-lab" element={<Delivery/>}/><Route path="/contas-estornos" element={<LedgerReview/>}/><Route path="/conflitos" element={<Reconciliation/>}/><Route path="/anexos" element={<Attachments/>}/><Route path="/setores" element={<Setores/>}/><Route path="/funcoes" element={<Funcoes/>}/><Route path="/funcionarios" element={<Funcionarios/>}/>{session.operationalHistoryPreview&&<Route path="/funcionarios/:id" element={<FichaColaborador/>}/>}<Route path="/configuracoes" element={<Configuracoes/>}/><Route path="/estoque" element={<Estoque/>}/><Route path="/producao" element={<Producao/>}/><Route path="/financeiro" element={<><p className="rounded border p-3">Laboratório: documentos financeiros locais não executam pagamentos externos. Lotes, vales/RH, fechamento global e anexos privados aguardam integração e homologação; comandos não portados são recusados.</p><Financeiro/></>}/><Route path="/ReceitasFinanceiras" element={<ReceitasFinanceiras/>}/><Route path="/RelatorioFinanceiro" element={<RelatorioFinanceiro/>}/><Route path="/receitas-financeiras" element={<ReceitasFinanceiras/>}/><Route path="/relatorio-financeiro" element={<RelatorioFinanceiro/>}/><Route path="/" element={<Dashboard attendanceAvailable={attendance}/>}/><Route path="*" element={<p>Esta tela aguarda integração offline validada. <a href="/">Voltar ao Dashboard</a></p>}/></Route></Routes>
 </D1Auth.Provider>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider><BrowserRouter><App/></BrowserRouter></ThemeProvider>);
