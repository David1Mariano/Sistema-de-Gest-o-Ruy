import {useEffect,useState} from 'react';
import {base44,getSession} from './client.mjs';
export default function RhDetails({entity,form,setForm,editing}){
 const [payments,setPayments]=useState([]),[history,setHistory]=useState([]),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;
  Promise.all([base44.entities.EmployeePayment.list('-payment_date',1000),editing?.id?base44.localDomain.rhHistory(entity,editing.id):{records:[]}])
   .then(([items,result])=>{if(live){setPayments(items);setHistory(result.records);setError('');}})
   .catch(e=>{if(live)setError(e.message);});
  return()=>{live=false;};
 },[entity,editing?.id]);
 const deducted=form.status===(entity==='Vale'?'descontado':'cobrado');
 const options=payments.filter(p=>p.employee_id===form.employee_id&&p.status==='pago'&&p.discount_amount>0&&p.source_device_id===getSession()?.deviceId&&!['vale','adiantamento'].includes(p.payment_type));
 return <div className="col-span-2 space-y-2 text-sm">
  <p className="text-xs text-muted-foreground">{entity==='Vale'?'Vale concedido: lançamento pendente de desconto.':'Consumo lançado: registrado; cobrado indica desconto de folha; liberado indica dispensa de cobrança.'} Este registro não executa pagamento, movimentação de caixa ou estoque.</p>
  {editing&&!base44.localDomain.canEditRh(editing)&&<p>Documento recebido de outro dispositivo: somente consulta; alterações exigem reconciliação na origem.</p>}
  {deducted&&<label className="block">Pagamento com desconto já previsto
   <select aria-label="Pagamento do desconto" className="w-full rounded border bg-background p-2" value={form.deduction_payment_id||''} disabled={!!editing?.deduction_payment_id} onChange={e=>{const p=payments.find(p=>p.id===e.target.value);setForm(f=>({...f,deduction_payment_id:p?.id||'',deduction_payment_version:p?._version}));}}>
    <option value="">Selecione a folha do colaborador</option>{options.map(p=><option key={p.id} value={p.id}>{p.payment_date} · desconto R$ {Number(p.discount_amount).toFixed(2)}</option>)}
   </select><span className="text-xs">O vínculo utiliza o desconto existente; não soma outra despesa. Itens descontados exigem estorno homologado para cancelamento.</span>
  </label>}
  {error&&<p role="alert">Histórico/pagamentos indisponíveis: {error}</p>}
  {!!editing?.id&&<details><summary>Histórico de alterações ({history.length})</summary><ul className="space-y-1">{history.map(h=><li key={h.operation_id}>Versão {h.record_version} · {h.snapshot.status} · R$ {Number(h.snapshot.amount).toFixed(2)} · {new Date(h.created_at).toLocaleString('pt-BR')} · Usuário {h.actor_id} · Dispositivo {h.device_id}</li>)}</ul></details>}
 </div>;
}
