import {useEffect,useState} from 'react';
import {Cloud,CheckCircle2,CloudOff,LoaderCircle} from 'lucide-react';
import {request} from './client.mjs';
import {syncState} from './sync-state.mjs';
const labels={unknown:'Nuvem: estado desconhecido',pending:'Nuvem: alterações pendentes',syncing:'Nuvem: sincronizando',error:'Nuvem: falha',confirmed:'Nuvem: operações confirmadas'};
const colors={unknown:'text-slate-500',pending:'text-amber-600',syncing:'text-blue-600',error:'text-red-600',confirmed:'text-green-600'};
export default function SyncStatus(){
 const [value,setValue]=useState(null),[open,setOpen]=useState(false);
 useEffect(()=>{
  let live=true;
  const refresh=()=>request('/sync-status').then(s=>{if(live)setValue(s);}).catch(()=>{if(live)setValue(null);});
  refresh();const interval=setInterval(refresh,10000);window.addEventListener('d1-changed',refresh);
  return()=>{live=false;clearInterval(interval);window.removeEventListener('d1-changed',refresh);};
 },[]);
 const state=syncState(value),Icon=state==='syncing'?LoaderCircle:state==='confirmed'?CheckCircle2:state==='error'?CloudOff:Cloud;
 return <div className="relative">
  <button type="button" className={'rounded-xl p-2 '+colors[state]} aria-label={labels[state]} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Icon className={'h-5 w-5 '+(state==='syncing'?'animate-spin':'')}/></button>
  {open&&<div role="status" className="absolute right-0 top-10 w-80 rounded-xl border bg-card p-4 text-sm text-card-foreground shadow-lg">
   <strong>{labels[state]}</strong><p>Pendências: {value?.pending??'desconhecidas'}</p><p>Última confirmação: {value?.lastSyncAt?new Date(value.lastSyncAt).toLocaleString('pt-BR'):'nenhuma'}</p>
   {!!value?.pendingBusiness&&<p>Operações críticas aguardando reconciliação: {value.pendingBusiness}</p>}
   {value?.businessConfirmed&&<p>Efeitos de estoque e financeiro conferidos na central de testes. Sincronização operacional continua desativada.</p>}
   <p>{value?.lastError||'Sincronização operacional desativada neste laboratório.'}</p><hr className="my-2"/>
   {value?.enabled&&<><p>Destino: somente central de testes local.</p><button type="button" className="my-2 underline" onClick={async()=>{setValue(v=>({...v,sending:1,lastError:null}));try{setValue(await request('/sync-now',{}));window.dispatchEvent(new Event('d1-changed'));}catch{setValue(v=>({...v,sending:0,lastError:'Não foi possível sincronizar com a central de testes.'}));}}}>Sincronizar central de testes</button></>}
   <strong>Backup — mecanismo independente</strong><p>{value?.backup?.lastError||(value?.backup?.createdAt?'Cópia local: '+new Date(value.backup.createdAt).toLocaleString('pt-BR'):'Backup ainda não verificado')}</p><p>Proteção contra perda do computador: não concluída.</p>
  </div>}
 </div>;
}
