import {useEffect,useState} from 'react';
import Direcao from '@/pages/Direcao';
import SocialWorkspace from '@/components/social/SocialWorkspace';
import {request} from './client.mjs';
import ConsultationModule from './ConsultationModule';
const socialClient={snapshot:()=>request('/social/snapshot'),draftReply:async()=>{throw Error('Envio externo não configurado.');},approveAndReply:async()=>{throw Error('Envio externo não autorizado.');}};
export function DirectionPanel({consultationOnly=false}){
 const [state,setState]=useState(null),[error,setError]=useState(false);
 useEffect(()=>{const load=consultationOnly?request('/history/status').then(value=>({historical:true,sources:Object.fromEntries(value.entities.map(item=>[item.entity,true]))})):request('/modules/status');load.then(setState).catch(()=>setError(true));},[consultationOnly]);
 if(error)return <p role="alert">Não foi possível autorizar o Painel da Direção.</p>;
 return state?<Direcao sourceCapabilities={state.sources} historical={state.historical}/>:<p role="status">Consultando fontes autorizadas…</p>;
}
export function SocialPanel({consultationOnly=false}){
 // The original presentation is retained; all data comes from the local server.
 return consultationOnly?<ConsultationModule title="Redes Sociais"/>:<SocialWorkspace permissions={{view:true,report:true,reply:false,approve_ai:false,configure:false}} client={socialClient}/>;
}
