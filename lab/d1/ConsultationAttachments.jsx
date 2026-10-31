import {useEffect,useState} from 'react';
import {request} from './client.mjs';
import AttachmentPreview from '@/components/rh/AttachmentPreview';

export default function ConsultationAttachments(){
 const [offset,setOffset]=useState(0),[page,setPage]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setPage(null);setError('');request('/history/attachments?offset='+offset).then(value=>{if(active)setPage(value);}).catch(()=>{if(active)setError('Não foi possível consultar os anexos, ou seu acesso não está autorizado.');});return()=>{active=false;};},[offset]);
 return <section className="mx-auto max-w-6xl space-y-4 p-4">
  <h1 className="text-2xl font-semibold">Anexos e comprovantes</h1>
  <p>Consulta dos arquivos vinculados aos registros recuperados. Os arquivos em quarentena não são disponibilizados. Envio, exclusão e alteração de vínculos estão bloqueados.</p>
  {error&&<p role="alert">{error}</p>}
  {page&&<><p role="status">{page.total} arquivo(s) autorizado(s)</p><ul className="space-y-3">{page.records.map(file=><li key={file.id} className="rounded border p-4">
   <h2 className="break-all font-semibold">{file.original_path?.split(/[\\/]/).pop()||'Comprovante recuperado'}</h2>
   <p>{file.bytes} bytes · Integridade verificada ao baixar</p>
   <AttachmentPreview record={{id:file.id,proof_url:location.origin+'/api/d1/history/attachments/'+file.id+'/download',file_name:file.original_path?.split(/[\\/]/).pop()}} label="Visualizar / imprimir"/>
   <a className="underline ml-4" href={'/api/d1/history/attachments/'+file.id+'/download'}>Baixar comprovante</a>
   <p>Registros relacionados:</p>{file.records.map(record=><p key={record.id}><a className="underline" href={record.entity==='Employee'?'/funcionarios/'+record.id:'/historico?'+new URLSearchParams({entity:record.entity,record:record.id})}>{record.entity} · {record.legacy_id}</a></p>)}
  </li>)}</ul><div className="flex gap-4"><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-30))}>Página anterior</button><button disabled={offset+30>=page.total} onClick={()=>setOffset(offset+30)}>Próxima página</button></div></>}
 </section>;
}
