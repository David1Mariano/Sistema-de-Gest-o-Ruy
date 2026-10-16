import {transaction,fail,digest,uuid} from './core.mjs';
import {record} from './entities.mjs';
export function referencesEmployee(data,id){
 if(typeof data==='string'){if(data===id)return true;try{return referencesEmployee(JSON.parse(data),id);}catch{return false;}}
 return !!data&&typeof data==='object'&&Object.values(data).some(value=>referencesEmployee(value,id));
}
export async function employeeDependencies(c,actor,id){
 const rows=(await c.query('SELECT entity,data FROM d2_catalog WHERE owner_id=$1',[actor])).rows;
 const history=(await c.query('SELECT entity,snapshot AS data FROM d1_rh_history WHERE owner_id=$1',[actor])).rows;
 const events=(await c.query("SELECT 'OperationalEvent' AS entity,data FROM d1_operation_events WHERE owner_id=$1",[actor])).rows;
 const refs=new Map();
 for(const row of [...rows,...events])if(referencesEmployee(row.data,id))refs.set(row.entity,(refs.get(row.entity)||0)+1);
 // Historical snapshots also block deletion, even after a document is cancelled.
 if(history.some(row=>referencesEmployee(row.data,id)))refs.set('RHHistory',1);
 const resumo=[...refs].map(([entity,count])=>({entity,label:entity,count}));
 const total=resumo.reduce((sum,row)=>sum+row.count,0);
 return {blocked:total>0,dependencies:Object.fromEntries(refs),total,resumo};
}
export async function employeeDeleteCheck(pool,user,id){
 if(!uuid(id))throw fail(400,'Identificador inválido.');
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
  const actor=(await c.query("SELECT id FROM lab_users WHERE id=$1 AND active AND role='admin' FOR SHARE",[user.id])).rows[0];
  if(!actor)throw fail(403,'Administrador obrigatório.');
  const row=(await c.query("SELECT id FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee'",[id,actor.id])).rows[0];
  if(!row)throw fail(404,'Colaborador indisponível.');
  return employeeDependencies(c,actor.id,id);
 });
}
export async function deleteEmployee(pool,user,deviceId,id,body,hook=async()=>{}){
 if(!uuid(id)||!uuid(body.operationId)||body.operation!=='delete'||body.confirmation!=='EXCLUIR'||!Number.isSafeInteger(body.baseVersion)||body.baseVersion<1||Object.keys(body).some(k=>!['operationId','operation','confirmation','baseVersion','data'].includes(k))||body.data&&Object.keys(body.data).length)throw fail(400,'Exclusão exige confirmação, versão e UUID.');
 const hash=digest(JSON.stringify({entity:'Employee',id,operation:'delete',baseVersion:body.baseVersion,confirmation:body.confirmation}));
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
  const actor=(await c.query("SELECT id FROM lab_users WHERE id=$1 AND active AND role='admin' FOR SHARE",[user.id])).rows[0];
  if(!actor)throw fail(403,'Administrador obrigatório.');
  const prior=(await c.query('SELECT * FROM lab_outbox WHERE operation_id=$1',[body.operationId])).rows[0];
  if(prior){if(prior.actor!==actor.id||prior.payload_hash!==hash)throw fail(409,'UUID reutilizado.');return {...prior.result,replay:true};}
  const current=(await c.query("SELECT * FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' FOR UPDATE",[id,actor.id])).rows[0];
  if(!current)throw fail(404,'Colaborador indisponível.');
  if(current.data._deleted==='true'||Number(current.version)!==body.baseVersion)throw fail(409,'Conflito de versão.');
  const dependencies=await employeeDependencies(c,actor.id,id);
  if(dependencies.blocked)throw fail(409,'Colaborador possui vínculos; exclusão bloqueada.');
  const data={...current.data,status:'inativo',_deleted:'true',_deleted_at:new Date().toISOString()};
  const row=(await c.query('UPDATE d1_records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,data])).rows[0];
  const result={record:record(row),operationId:body.operationId,replay:false,tombstone:true};
  await c.query("INSERT INTO lab_outbox(operation_id,device_id,actor,entity,record_id,operation,base_version,record_version,payload_hash,payload,result) VALUES($1,$2,$3,'Employee',$4,'delete',$5,$6,$7,$8,$9)",[body.operationId,deviceId,actor.id,id,body.baseVersion,row.version,hash,data,result]);
  await c.query("INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,'Employee:delete_tombstone',$2)",[actor.id,body.operationId]);
  await hook(c);return result;
 });
}
