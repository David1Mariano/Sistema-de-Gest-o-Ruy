import {useEffect,useRef,useState} from 'react';
import {base44} from '@/api/base44Client';
const omitted=new Set(['id','proof_url','invoice_url','document_url','file_url','photo_url','attachment_url','storage_path','file_name','mime_type','file_size','created_date','updated_date','created_at','updated_at','expense_id']);
const fingerprint=value=>JSON.stringify(Object.fromEntries(Object.entries(value||{}).filter(([k])=>!omitted.has(k)&&!k.startsWith('_')).sort(([a],[b])=>a.localeCompare(b))));
export function useInlineCentralFiles({open,editing,entity,initial}){
 const transport=base44.localDomain?.attachments,saved=useRef(null),pending=useRef(new Map()),baseline=useRef(''),[status,setStatus]=useState({});
 useEffect(()=>{saved.current=editing||null;pending.current=new Map();baseline.current=fingerprint(initial);setStatus({});},[open,editing]);
 return {enabled:!!transport,status,needsBusinessSave:value=>!saved.current?.id||fingerprint(value)!==baseline.current,async select(file,field,setForm){
  if(!transport)throw Error('Envio central indisponível neste perfil.');
  if(!saved.current?.id){await transport.inspect(file);pending.current.set(field,file);setStatus(s=>({...s,[field]:'Selecionado: '+file.name+'. Envio pendente até salvar o cadastro.'}));return {pending:true};}
  const r=await transport.upload({file,recordId:saved.current.id,recordVersion:saved.current._version||1,entity,field});setForm(v=>({...v,[field]:r.file_url,_attachmentFields:{...v._attachmentFields,[field]:r.metadata}}));setStatus(s=>({...s,[field]:'Confirmado na central: '+file.name}));return r;
 },async persist(value,save){const fp=fingerprint(value);if(!saved.current?.id||fp!==baseline.current){if(saved.current?._readOnly)throw Error('Registro histórico em consulta: dados operacionais preservados.');const r=await save(saved.current);saved.current=r.expense||r;baseline.current=fp;}
  for(const [field,file] of pending.current){await transport.upload({file,recordId:saved.current.id,recordVersion:saved.current._version||1,entity,field});pending.current.delete(field);setStatus(s=>({...s,[field]:'Confirmado na central: '+file.name}));}return saved.current;
 }};
}
