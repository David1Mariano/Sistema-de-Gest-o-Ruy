import {useEffect,useState} from 'react';
import Direcao from '@/pages/Direcao';
import SocialWorkspace from '@/components/social/SocialWorkspace';
import {request} from './client.mjs';
const socialClient={snapshot:()=>request('/social/snapshot'),draftReply:async()=>{throw Error('Envio externo não configurado.');},approveAndReply:async()=>{throw Error('Envio externo não autorizado.');}};
export function DirectionPanel(){
 const [state,setState]=useState(null),[error,setError]=useState(false);
 useEffect(()=>{request('/modules/status').then(setState).catch(()=>setError(true));},[]);
 if(error)return <p role="alert">Não foi possível autorizar o Painel da Direção.</p>;
 return state?<Direcao sourceCapabilities={state.sources} historical={state.historical}/>:<p role="status">Consultando fontes autorizadas…</p>;
}
export function SocialPanel(){
 // The original presentation is retained; all data comes from the local server.
 return <SocialWorkspace permissions={{view:true,report:true,reply:false,approve_ai:false,configure:false}} client={socialClient}/>;
}
