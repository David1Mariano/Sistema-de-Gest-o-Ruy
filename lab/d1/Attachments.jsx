import {useEffect,useState} from 'react';
import {useAuth} from '@/lib/AuthContext';
import {base44,request} from './client.mjs';
const entities={Employee:'Colaborador',FinancialExpense:'Despesa',EmployeePayment:'Pagamento',AccountsPayable:'Conta a pagar',DailyProduction:'Produção diária'};
const labels={pending:'Pendente de envio',acknowledged:'Confirmado na central de testes',cached:'Disponível offline',remote:'Disponível na central',conflict:'Conflito — revisão necessária',rejected:'Recusado — revisão necessária'};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
export default function Attachments(){
 const {user}=useAuth();
 const [entity,setEntity]=useState('Employee'),[records,setRecords]=useState([]),[recordId,setRecord]=useState(''),[files,setFiles]=useState([]),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[preview,setPreview]=useState(null);
 const refresh=async()=>setFiles((await request('/attachments')).records);
 useEffect(()=>{if(user?.role!=='admin')return;let active=true;setRecord('');setRecords([]);setPreview(null);base44.entities[entity].list('-created_date',200).then(rows=>{if(active)setRecords(rows);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[entity,user?.role]);
 useEffect(()=>{if(user?.role==='admin')refresh().catch(e=>setError(e.message));},[user?.role]);
 async function run(fn){setBusy(true);setError('');setMessage('');try{await fn();}catch(e){setError(e.message||'Não foi possível concluir. O arquivo permanece preservado.');}finally{setBusy(false);}}
 if(user?.role!=='admin')return <p role="alert">Anexos exigem administrador local autorizado.</p>;
 const rows=files.filter(item=>item.entity===entity&&(!recordId||item.recordId===recordId));
 return <section className="mx-auto space-y-4 p-4" style={{maxWidth:1000}}>
  <h1 className="text-2xl font-semibold">Anexos</h1><p>Vincule arquivos fictícios a registros já salvos. Envio e busca são manuais; arquivos na fila continuam disponíveis sem conexão.</p>
  {error&&<p role="alert" className="rounded border border-red-500 p-3">{error}</p>}{message&&<p role="status">{message}</p>}
  <form className="space-y-3 rounded border p-4" onSubmit={event=>{event.preventDefault();void run(async()=>{
   const record=records.find(item=>item.id===recordId);if(!record||!file)throw Error('Selecione um registro e um arquivo.');
   if(!file.size||file.size>524288)throw Error('O arquivo deve ter até 512 KiB e não pode estar vazio.');
   if(!/^FICTICIO-[a-zA-Z0-9_-]+\.(pdf|png|jpg|webp|txt)$/.test(file.name))throw Error('Use nome FICTICIO-arquivo.pdf, .png, .jpg, .webp ou .txt.');
   const bytes=new Uint8Array(await file.arrayBuffer()),sha256=await hash(bytes);
   const existing=files.find(item=>item.recordId===recordId&&item.sha256===sha256&&item.filename===file.name);
   if(existing){setMessage('Este arquivo já está vinculado. Use o mesmo item para reenviar.');return;}
   const key='ruy-attachment-intent:'+user.id+':'+recordId+':'+sha256+':'+file.name;
   const intent=JSON.parse(sessionStorage.getItem(key)||'null')||{id:crypto.randomUUID(),operationId:crypto.randomUUID()};sessionStorage.setItem(key,JSON.stringify(intent));
   const mediaType=({txt:'text/plain',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',webp:'image/webp'})[file.name.split('.').at(-1)];
   let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
   await request('/attachments',{...intent,recordId,recordVersion:record._version,entity,filename:file.name,mediaType,sha256,bytes:btoa(binary)});
   sessionStorage.removeItem(key);await refresh();setMessage('Arquivo salvo na fila local. O envio ainda não foi confirmado.');window.dispatchEvent(new Event('d1-changed'));
  });}}>
   <label className="block">Tipo de registro<select aria-label="Tipo de registro" value={entity} onChange={e=>setEntity(e.target.value)} disabled={busy} className="block w-full rounded border p-2">{Object.entries(entities).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="block">Registro<select aria-label="Registro" required value={recordId} onChange={e=>{setRecord(e.target.value);setPreview(null);}} disabled={busy} className="block w-full rounded border p-2"><option value="">Selecione</option>{records.map(item=><option key={item.id} value={item.id}>{item.name||item.description||item.product_name||item.id}</option>)}</select></label>
   <label className="block">Arquivo fictício<input aria-label="Arquivo fictício" type="file" accept=".pdf,.png,.jpg,.webp,.txt" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)} className="block"/></label>
   <button disabled={busy||!recordId||!file} className="rounded border px-4 py-2" type="submit">Salvar anexo na fila</button>
  </form>
  <div className="flex gap-3"><button disabled={busy} onClick={()=>void run(refresh)} className="underline">Atualizar lista local</button><button disabled={busy||!recordId} className="underline" onClick={()=>void run(async()=>{
   const remote=(await request('/attachments/remote?record='+recordId)).records;setFiles(current=>[...current,...remote.filter(item=>!current.some(local=>local.id===item.id)).map(item=>({...item,state:'remote'}))]);setMessage('Lista da central de testes consultada.');
  })}>Consultar central</button></div>
  <ul className="space-y-3">{rows.map(item=><li key={item.id} data-attachment-id={item.id} className="rounded border p-3">
   <strong>{item.filename}</strong><p>{labels[item.state]||'Estado desconhecido'}</p>
   <div className="flex gap-3">
    {item.state!=='remote'&&<button disabled={busy} className="underline" aria-label={'Abrir '+item.filename} onClick={()=>void run(async()=>{
     const value=await request('/attachments/'+item.id),bytes=Uint8Array.from(atob(value.bytes),character=>character.charCodeAt(0));if(value.id!==item.id||await hash(bytes)!==item.sha256)throw Error('Falha de integridade: arquivo não aberto.');setPreview({...value,text:value.mediaType==='text/plain'?new TextDecoder().decode(bytes):null});
    })}>Abrir</button>}
    {item.state==='pending'&&<button disabled={busy} className="underline" aria-label={'Enviar '+item.filename} onClick={()=>void run(async()=>{await request('/attachments/'+item.id+'/send',{});await refresh();setMessage('Recibo de envio confirmado na central de testes.');window.dispatchEvent(new Event('d1-changed'));})}>Enviar / tentar novamente</button>}
    {['remote','acknowledged','cached'].includes(item.state)&&<button disabled={busy} className="underline" aria-label={'Buscar '+item.filename} onClick={()=>void run(async()=>{await request('/attachments/'+item.id+'/fetch',{});await refresh();setMessage('Arquivo verificado e disponível offline.');})}>Buscar cópia offline</button>}
   </div>
  </li>)}</ul>{!rows.length&&<p>Nenhum anexo local para a seleção.</p>}
  {preview&&<div role="dialog" aria-label="Visualizar anexo" aria-modal="true" className="rounded border bg-card p-4" style={{maxHeight:'70vh',overflow:'auto'}}>
   <h2>{preview.filename}</h2>{preview.text!==null?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{preview.text}</pre>:preview.mediaType.startsWith('image/')?<img alt={preview.filename} src={'data:'+preview.mediaType+';base64,'+preview.bytes} style={{maxWidth:'100%'}}/>:<p>PDF verificado. Baixe a cópia para abrir no leitor autorizado.</p>}
   <a className="underline mr-4" download={preview.filename} href={'/api/d1/attachments/'+preview.id+'/download'}>Baixar cópia verificada</a><button onClick={()=>setPreview(null)}>Fechar anexo</button>
  </div>}
 </section>;
}
