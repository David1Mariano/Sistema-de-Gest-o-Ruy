import {useEffect,useState} from 'react';
import {request} from './client.mjs';
import {notify} from '@/lib/notificationStore';
export default function SharedConnection(){
 const [state,setState]=useState(null);
 useEffect(()=>{let active=true,head=null;
  const refresh=async()=>{try{const next=await request('/sync-status');if(!active)return;setState(next);if(head!==null&&next.cursor!==head)window.dispatchEvent(new Event('d1-changed'));head=next.cursor;notify({id:'central-connection',message:next.connection==='online'?'Conectado à central compartilhada. Alterações são confirmadas pelo servidor.':'Central sem confirmação de conexão. Escritas ficam bloqueadas até reconectar.',kind:next.connection==='online'?'info':'warning'});}catch{if(active)setState({connection:'offline',stale:true});}};
  void refresh();const timer=setInterval(refresh,2000);return()=>{active=false;clearInterval(timer);};
 },[]);
 if(state?.connection==='online'&&!state.stale&&!state.conflicts)return null;
 return <div role="status" className="border-b bg-amber-100 p-2 text-sm text-amber-950">
  {state?.operationalSyncEnabled?'Compartilhado — operação central':state?.consultationOnly?'Compartilhado — consulta dos dados recuperados':'Compartilhado — homologação sintética'} · {state?.connection==='online'?'Conectado à fonte central':'Sem confirmação da conexão'}
  {state?.stale?' · Dados possivelmente desatualizados; alterações bloqueadas':''}
  {' · Última consulta: '}{state?.lastSyncAt?new Date(state.lastSyncAt).toLocaleString('pt-BR'):'aguardando'}
  {state?.conflicts>0?' · Há conflito: confira a versão central antes de reenviar.':''}
  {state?.consultationOnly?' · Pagamentos, descontos e movimentações estão bloqueados.':' · Operações de estoque, folha, compras, produção e Delivery exigem confirmação central online.'}
 </div>;
}
