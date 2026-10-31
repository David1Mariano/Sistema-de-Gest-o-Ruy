import {useEffect,useState} from 'react';
import {request} from './client.mjs';
import History from './History';

export default function ConsultationModule({title,entities=[]}){
 const [status,setStatus]=useState(null),[error,setError]=useState('');
 const names=entities.join('|');
 useEffect(()=>{let active=true;request('/history/status').then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('Consulta indisponível ou não autorizada.');});return()=>{active=false;};},[names]);
 const found=status?.entities.find(item=>entities.includes(item.entity)&&item.total>0);
 if(found)return <History initialEntity={found.entity} onlyEntity title={title}/>;
 return <section className="mx-auto max-w-5xl space-y-4 p-4"><h1 className="text-2xl font-semibold">{title}</h1><p>Modo de consulta: nenhuma movimentação, cálculo, pagamento ou novo cadastro será executado.</p>{error?<p role="alert">{error}</p>:status?<><p>Não há registros desta categoria no conjunto recuperado publicado para este perfil. Isso não confirma a completude de outras fontes ou períodos.</p><a className="underline" href="/historico">Consultar todos os registros recuperados autorizados</a></>:<p>Consultando a central…</p>}</section>;
}
