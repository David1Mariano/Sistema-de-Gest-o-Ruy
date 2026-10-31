import {useEffect,useState} from 'react';
import {useAuth} from '@/lib/AuthContext';
import AttachmentPreview from '@/components/rh/AttachmentPreview';
import {verifiedPdfDocument} from '@/components/rh/PdfPages';
import {base44,request} from './client.mjs';
const entities={Employee:'Colaborador',EmployeePayment:'Pagamento',Vale:'Vale',FinancialExpense:'Despesa',AccountsPayable:'Conta a pagar',Revenue:'Recebimento',DailyProduction:'Produção diária'};
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
export default function AttachmentsCentral(){
 const {user,operationalMode=false}=useAuth(),params=new URLSearchParams(location.search);
 const [entity,setEntity]=useState(entities[params.get('entity')]?params.get('entity'):'Employee'),[records,setRecords]=useState([]),[recordId,setRecord]=useState(params.get('record')||''),[files,setFiles]=useState([]),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{if(user?.role!=='admin')return;let active=true;setRecords([]);setFiles([]);
  void(async()=>{const current=await base44.entities[entity].list('-created_date',2000),historical=[];for(let offset=0;offset<3000;offset+=30){const page=await request('/history/records?'+new URLSearchParams({entity,offset:String(offset)}));historical.push(...page.records.map(r=>({id:r.id,name:r.label,_version:1,_historical:true})));if(offset+30>=page.total)break;}if(active)setRecords([...current,...historical.filter(r=>!current.some(c=>c.id===r.id))]);})().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[entity,user?.role]);
 useEffect(()=>{if(!recordId||user?.role!=='admin')return;let active=true;const load=()=>request('/attachments/remote?record='+recordId).then(v=>{if(active)setFiles(v.records);}).catch(e=>{if(active)setError(e.message);});void load();const timer=setInterval(load,5000);return()=>{active=false;clearInterval(timer);};},[recordId,user?.role]);
 async function upload(event){event.preventDefault();setBusy(true);setError('');setMessage('');try{
  const record=records.find(r=>r.id===recordId);if(!record||!file)throw Error('Selecione o registro salvo e o PDF.');if(!operationalMode)throw Error('Este cliente está em consulta. Atualize o aplicativo antes de enviar.');
  if(!file.size||file.size>15*1024*1024)throw Error('Selecione um arquivo de até 15 MiB.');
  const mediaType=({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain'})[file.name.split('.').at(-1).toLowerCase()];if(!mediaType)throw Error('Selecione PDF, PNG, JPG, WEBP ou TXT.');
  const bytes=new Uint8Array(await file.arrayBuffer());if(mediaType==='application/pdf'){const doc=await verifiedPdfDocument(bytes.slice());await doc.destroy();}const sha256=await hash(bytes);
  const duplicate=files.find(f=>f.sha256===sha256);if(duplicate){setMessage('Este conteúdo já está vinculado ao registro. Nenhuma cópia foi criada.');return;}
  const key='ruy-pdf-intent:'+user.id+':'+recordId+':'+sha256;
  const intent=JSON.parse(localStorage.getItem(key)||'null')||{id:crypto.randomUUID(),operationId:crypto.randomUUID(),recordVersion:record._version||1};localStorage.setItem(key,JSON.stringify(intent));
  const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  await request('/attachments',{...intent,recordId,entity,filename:file.name,mediaType,sha256,bytes:btoa(chunks.join(''))});
  localStorage.removeItem(key);setFiles((await request('/attachments/remote?record='+recordId)).records);setMessage('PDF confirmado na central. Disponível para os demais clientes autorizados.');
 }catch(e){setError(e.message||'Envio não confirmado. O arquivo original permanece no seu computador.');}finally{setBusy(false);}}
 if(user?.role!=='admin')return <p role="alert">Você não tem permissão para consultar ou anexar comprovantes.</p>;
 return <section className="mx-auto max-w-5xl space-y-4 p-4"><h1 className="text-2xl font-semibold">Anexos PDF</h1><a href="/anexos-historicos" className="underline">Todos os comprovantes recuperados</a>
  <p>Arquivos vinculados ao registro, armazenados na central. Anexar um documento não altera pagamentos, vales ou saldos. Para um cadastro novo, salve o registro antes de anexar.</p>
  {error&&<p role="alert" className="rounded border border-red-500 p-3">{error}</p>}{message&&<p role="status">{message}</p>}
  <form onSubmit={upload} className="space-y-3 rounded border p-4">
   <label className="block">Tipo de registro<select aria-label="Tipo de registro" value={entity} disabled={busy} onChange={e=>{setEntity(e.target.value);setRecord('');setError('');}} className="block w-full rounded border p-2">{Object.entries(entities).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label className="block">Registro<select aria-label="Registro" value={recordId} required disabled={busy} onChange={e=>{setRecord(e.target.value);setFiles([]);setError('');}} className="block w-full rounded border p-2"><option value="">Selecione</option>{records.map(r=><option key={r.id} value={r.id}>{r.name||r.description||r.id}{r._historical?' · Histórico preservado':''}</option>)}</select></label>
   <label className="block">PDF ou arquivo<input aria-label="Anexar PDF" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" disabled={busy||!operationalMode} onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
   <button type="submit" disabled={busy||!recordId||!file||!operationalMode} className="rounded border px-4 py-2">{busy?'Enviando — aguardando confirmação…':'Anexar PDF à central'}</button>
  </form>
  <ul className="space-y-3">{files.map(f=>{const name=f.filename?.split(/[\\/]/).pop()||'Comprovante recuperado',url='/api/d1/attachments/'+f.id+'/download';return <li key={f.id} className="rounded border p-3" data-attachment-id={f.id}><strong>{name}</strong><p>{f.historical?'Recuperado · vínculo histórico confirmado':'Confirmado na central'} · {f.size||'—'} bytes</p><p>Data: {f.uploadedAt?new Date(f.uploadedAt).toLocaleString('pt-BR'):'Não informada na origem'} · Vínculo: {entities[entity]} / {recordId}</p><div className="flex gap-4"><AttachmentPreview record={{id:f.id,proof_url:location.origin+url,file_name:name}} label="Visualizar / imprimir"/><a className="underline" href={url} download={name}>Baixar</a></div></li>;})}</ul>
  {recordId&&!files.length&&<p>Nenhum arquivo confirmado para este registro.</p>}
 </section>;
}
