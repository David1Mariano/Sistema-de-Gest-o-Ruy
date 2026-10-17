import {useState} from 'react';
import {request} from './client.mjs';
import {useAuth} from '@/lib/AuthContext';
export default function Reconciliation(){
 const {user}=useAuth();const [plan,setPlan]=useState(null),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function run(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);setPlan(null);setConfirmed(false);}finally{setBusy(false);}}
 if(user?.role!=='admin')return <p role="alert">Revisão restrita ao administrador autorizado.</p>;
 return <section className="mx-auto max-w-4xl space-y-4 p-4"><h1 className="text-2xl font-semibold">Revisar conflitos</h1>
 <p>Compare as propostas com a central. Aceitar a central retira as propostas indicadas da fila e restaura as projeções locais. O histórico e as propostas ficam arquivados para consulta; nenhuma atualização é mesclada automaticamente.</p>
 <p>Reenvie operações pendentes antes de preparar o plano. Depois da revisão, alterações que desejar manter devem ser cadastradas novamente sobre as versões atuais.</p>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 <button disabled={busy} className="underline" onClick={()=>void run(async()=>{setPlan(await request('/reconciliation/plan'));setConfirmed(false);setMessage('');})}>Preparar revisão</button>
 {plan&&<><p>Versão da central: {plan.head}. Propostas retiradas: {plan.operations.length}.</p><details><summary>Propostas preservadas e estado da central</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap">{JSON.stringify({propostas:plan.operations,central:plan.centralRecords},null,2)}</pre></details>
 <label className="block">Motivo da decisão<input aria-label="Motivo da reconciliação" className="block w-full rounded border p-2" value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label>
 <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Revisei todas as propostas e autorizo retirá-las, mantendo o arquivo de auditoria.</label>
 <button disabled={busy||!confirmed||reason.trim().length<8} className="rounded border p-2" onClick={()=>void run(async()=>{const result=await request('/reconciliation/apply',{operationId:crypto.randomUUID(),decision:'accept-central',planHash:plan.hash,reason});setPlan(null);setMessage('Revisão registrada: '+result.id+'. Recarregue as telas antes de editar.');window.dispatchEvent(new Event('d1-changed'));})}>Aceitar central e arquivar propostas</button></>}
 </section>;
}
