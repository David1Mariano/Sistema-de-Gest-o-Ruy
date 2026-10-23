import {fail,uuid} from './core.mjs';
import {calculatePayroll} from './payroll-calculation.mjs';
import {syncHash} from './sync-contract.mjs';
export {isPayroll} from './payroll-contract.mjs';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export async function preparePayroll({c,actor,body,old,data}){
 if(!uuid(data.employee_id))throw fail(400,'Colaborador obrigatório para a folha.');
 if(old&&data.employee_id!==old.employee_id)throw fail(409,'Folha não pode ser transferida.');
 if(!(await c.query("SELECT id FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' AND coalesce(data->>'_deleted','false')<>'true' FOR SHARE",[data.employee_id,actor.id])).rowCount)throw fail(403,'Colaborador fora do escopo da folha.');
 if(body.entity==='PayrollPolicy'){
  if(!data.name?.trim()||!['ativo','inativo'].includes(data.status))throw fail(400,'Identifique e configure a política da folha.');
  try{calculatePayroll(data,{units:0,absence_units:0,overtime_minutes:0,bonus_cents:0});}catch{throw fail(400,'Política de cálculo inválida; nenhuma regra legal é presumida.');}return data;
 }
 if(old?.status==='fechado')throw fail(409,'Cálculo fechado exige reabertura explícita e auditada.');
 data.reopen_reason=old?.reopen_reason||'';data.reopened_by=old?.reopened_by||'';
 if(!uuid(data.policy_id)||!validDate(data.reference_start)||!validDate(data.reference_end)||data.reference_start>data.reference_end)throw fail(400,'Política e período válidos são obrigatórios.');
 const days=(Date.parse(data.reference_end)-Date.parse(data.reference_start))/86400000+1;if(days>366||!Number.isInteger(data.units)||data.units>days)throw fail(400,'Unidades fora do período.');
 const row=(await c.query("SELECT id,version,data FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity='PayrollPolicy' FOR SHARE",[data.policy_id,actor.id])).rows[0],policy=row&&JSON.parse(row.data.payload_json);
 if(!policy||policy.employee_id!==data.employee_id||policy.status!=='ativo')throw fail(409,'Política não corresponde ao colaborador.');
 const sources=[],cents=[],selected=[];
 for(const [field,entity,statuses] of [['vale_ids','Vale',['pendente']],['consumption_ids','Consumption',['registrado']]]){
  if(!Array.isArray(data[field])||data[field].length>20||new Set(data[field]).size!==data[field].length||data[field].some(id=>!uuid(id)))throw fail(400,'Seleção de descontos inválida.');
  for(const id of data[field]){const r=(await c.query('SELECT id,version,data FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity=$3 FOR UPDATE',[id,actor.id,entity])).rows[0],payload=r&&JSON.parse(r.data.payload_json);
   if(!payload||payload.employee_id!==data.employee_id||!statuses.includes(payload.status)||payload.date>data.reference_end||!Number.isFinite(payload.amount)||payload.amount<0||Math.abs(payload.amount*100-Math.round(payload.amount*100))>1e-6)throw fail(409,'Desconto indisponível para esta folha.');
   selected.push(id);cents.push(Math.round(payload.amount*100));sources.push({id,entity,version:Number(r.version)});
  }
 }
 let calculation;try{calculation={...calculatePayroll(policy,data,cents),policyVersion:Number(row.version),sources};}catch{throw fail(400,'Revise as unidades, regras e descontos; total não aprovado.');}
 const fingerprint=syncHash(calculation);data.calculation={...calculation,fingerprint};
 if(body.action==='confirm'){
  if(!old||old.status!=='rascunho'||body.token!==old.calculation?.fingerprint||fingerprint!==old.calculation.fingerprint)throw fail(409,'Fontes ou regras alteradas; recalcule antes de fechar.');
  const runs=(await c.query("SELECT id,data FROM d2_catalog WHERE owner_id=$1 AND entity='PayrollRun' AND id<>$2",[actor.id,body.id])).rows.map(r=>JSON.parse(r.data.payload_json));
  if(runs.some(r=>r.status==='fechado'&&r.employee_id===data.employee_id&&(r.reference_start<=data.reference_end&&data.reference_start<=r.reference_end||[...(r.vale_ids||[]),...(r.consumption_ids||[])].some(id=>selected.includes(id)))))throw fail(409,'Período ou desconto já incluído em folha fechada.');
  data.status='fechado';
 }else{if(data.status!=='rascunho')throw fail(400,'Crie e confira o rascunho antes do fechamento.');data.status='rascunho';}
 return data;
}
