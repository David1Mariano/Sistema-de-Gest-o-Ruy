import {digest,fail,uuid,transaction} from '../local-lab/core.mjs';
export {digest,fail,uuid,transaction};
export function payloadHash(command){return digest(JSON.stringify({operationId:command.operationId,recordId:command.recordId,operation:command.operation,baseVersion:command.baseVersion??null,deviceId:command.deviceId,actorId:command.actorId,workspaceId:command.workspaceId,data:{code:command.data?.code,name:command.data?.name}}));}
export function validateCommand(c){
 if(![c.operationId,c.recordId,c.deviceId,c.actorId,c.workspaceId].every(uuid)||!['create','update'].includes(c.operation))throw fail(400,'Contrato inválido.');
 if(c.operation==='create'?c.baseVersion!=null:!Number.isSafeInteger(c.baseVersion)||c.baseVersion<1)throw fail(400,'Versão inválida.');
 if(!c.data||Object.keys(c.data).some(k=>!['code','name'].includes(k))||!/^TEST-[A-Z0-9-]{3,40}$/.test(c.data.code)||typeof c.data.name!=='string'||!c.data.name.startsWith('FICTICIO ')||c.data.name.length>120)throw fail(400,'Somente fixture fictícia permitida.');
}
export async function localSave(pool,identity,body){
 const command={...body,deviceId:identity.deviceId,actorId:identity.actorId,workspaceId:identity.workspaceId};validateCommand(command);
 const hash=payloadHash(command);
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(1808401)');
  const prior=(await c.query('SELECT * FROM outbox WHERE operation_id=$1',[command.operationId])).rows[0];
  if(prior){if(prior.payload_hash!==hash)throw fail(409,'Operação reutilizada.');return {replay:true,operationId:command.operationId};}
  const record=(await c.query('SELECT * FROM records WHERE id=$1 FOR UPDATE',[command.recordId])).rows[0];
  if((await c.query("SELECT 1 FROM outbox WHERE record_id=$1 AND state<>'acknowledged'",[command.recordId])).rowCount)throw fail(409,'Resolver operação local pendente antes de nova edição.');
  if(command.operation==='create'){
   if(record)throw fail(409,'Registro já existe.');
   await c.query('INSERT INTO records VALUES($1,$2,1,NULL,true)',[command.recordId,command.data]);
  }else{
   if(!record||Number(record.remote_version)!==command.baseVersion||record.dirty)throw fail(409,'Versão local divergente.');
   await c.query('UPDATE records SET data=$2,local_version=local_version+1,dirty=true WHERE id=$1',[command.recordId,command.data]);
  }
  await c.query('INSERT INTO outbox(operation_id,record_id,operation,base_version,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6)',[command.operationId,command.recordId,command.operation,command.baseVersion??null,command,hash]);
  return {operationId:command.operationId,state:'pending'};
 });
}
export async function principal(pool,token,write=false){
 const p=(await pool.query('SELECT * FROM principals WHERE token_hash=$1',[digest(token||'')])).rows[0];
 if(!p?.active||!(write?p.can_write:p.can_read))throw fail(403,'Permissão central negada.');return p;
}
export async function accept(pool,token,command){
 validateCommand(command);
 return transaction(pool,async c=>{
  const p=(await c.query('SELECT * FROM principals WHERE token_hash=$1',[digest(token||'')])).rows[0];
  if(!p?.active||!p.can_write||command.deviceId!==p.device_id||command.actorId!==p.actor_id||command.workspaceId!==p.workspace_id)throw fail(403,'Identidade/permissão central recusada.');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[command.operationId]);
  const hash=payloadHash(command),old=(await c.query('SELECT * FROM receipts WHERE operation_id=$1',[command.operationId])).rows[0];
  if(old){if(old.payload_hash!==hash||old.device_id!==p.device_id)throw fail(409,'Identificador já utilizado.');return {...old.result,duplicated:true};}
  // Contador transacional mantido até COMMIT: cursor não pula commits fora de ordem.
  await c.query('SELECT cursor FROM change_clock WHERE singleton FOR UPDATE');
  const row=(await c.query('SELECT * FROM records WHERE id=$1',[command.recordId])).rows[0];
  if(row&&row.workspace_id!==p.workspace_id)throw fail(403,'Registro fora do escopo.');
  if(command.operation==='create'?!!row:!row||Number(row.version)!==command.baseVersion){const e=fail(409,'Conflito de versão.');e.remote=row?{id:row.id,version:Number(row.version),data:row.data}:null;throw e;}
  const version=row?Number(row.version)+1:1;
  if(row)await c.query('UPDATE records SET data=$2,version=$3 WHERE id=$1',[command.recordId,command.data,version]);
  else await c.query('INSERT INTO records VALUES($1,$2,$3,$4)',[command.recordId,p.workspace_id,command.data,version]);
  const cursor=Number((await c.query('UPDATE change_clock SET cursor=cursor+1 WHERE singleton RETURNING cursor')).rows[0].cursor);
  const result={operationId:command.operationId,recordId:command.recordId,version,cursor,confirmedAt:new Date().toISOString(),data:command.data};
  await c.query('INSERT INTO receipts(operation_id,device_id,actor_id,workspace_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[command.operationId,p.device_id,p.actor_id,p.workspace_id,hash,result]);
  await c.query('INSERT INTO changes VALUES($1,$2,$3,$4,$5,$6,$7)',[cursor,command.operationId,p.device_id,p.workspace_id,command.recordId,version,command.data]);
  return result;
 });
}
export async function status(pool){
 const state=(await pool.query('SELECT * FROM sync_state WHERE singleton')).rows[0];
 const counts=(await pool.query("SELECT count(*) FILTER(WHERE state='pending')::int pending,count(*) FILTER(WHERE state='sending')::int sending,count(*) FILTER(WHERE state='acknowledged')::int acknowledged,count(*) FILTER(WHERE state='conflict')::int conflicts,count(*) FILTER(WHERE state='rejected')::int rejected FROM outbox")).rows[0];
 const inbox=(await pool.query('SELECT count(*)::int received FROM inbox')).rows[0];
 const cloudState=counts.sending?'syncing':counts.conflicts||counts.rejected||state.last_error?'error':counts.pending?'pending':state.last_sync_at?'confirmed':'unknown';
 return {...counts,...inbox,cursor:Number(state.cursor),lastSyncAt:state.last_sync_at,lastError:state.last_error,cloudState,filesState:'not-implemented',backupState:'not-validated'};
}
