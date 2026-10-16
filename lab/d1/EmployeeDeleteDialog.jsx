import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from './dialog.jsx';
import {checkEmployeeDependencies} from './employee-delete.mjs';
export default function EmployeeDeleteDialog({open,employee,onClose,onConfirm}){
 const [check,setCheck]=useState(null),[word,setWord]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;setCheck(null);setWord('');setError('');if(open&&employee?.id)checkEmployeeDependencies(employee.id).then(value=>{if(active)setCheck(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[open,employee?.id]);
 return <Dialog open={open} onOpenChange={value=>{if(!value&&!busy)onClose();}}><DialogContent><DialogHeader><DialogTitle>Excluir cadastro local</DialogTitle></DialogHeader>
  <p>A exclusão retira o cadastro das consultas. Registro, histórico e auditoria serão preservados; a marca será enviada apenas à central de laboratório autorizada.</p>
  <p>{employee?.name}</p>
  {!check&&!error&&<p>Verificando vínculos no servidor...</p>}
  {check?.blocked&&<p role="alert">Exclusão bloqueada: existem {check.total} vínculo(s). Nenhum histórico será apagado.</p>}
  {check&&!check.blocked&&<label>Digite EXCLUIR<input aria-label="Confirmação da exclusão" value={word} onChange={e=>setWord(e.target.value)} className="block border p-2"/></label>}
  {error&&<p role="alert">{error}</p>}
  <button onClick={onClose} disabled={busy}>Cancelar</button>
  <button disabled={busy||!check||check.blocked||word!=='EXCLUIR'} onClick={async()=>{setBusy(true);try{await onConfirm(employee);}catch(e){setError(e.message);}finally{setBusy(false);}}}>{busy?'Excluindo...':'Confirmar exclusão local'}</button>
 </DialogContent></Dialog>;
}
