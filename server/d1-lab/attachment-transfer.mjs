import {randomUUID} from 'node:crypto';
import {transaction,fail,uuid} from './core.mjs';
import {validateAttachment,attachmentHash} from './attachment-contract.mjs';
import {syncHash} from './sync-contract.mjs';
async function authorize(c,actor,recordId,entity){
 const user=(await c.query('SELECT active,role FROM lab_users WHERE id=$1 FOR SHARE',[actor])).rows[0];
 if(!user?.active||user.role!=='admin')throw fail(403,'Attachment permission denied.');
 const table=entity==='Employee'?'d1_records':'d2_catalog';
 const record=(await c.query(`SELECT * FROM ${table} WHERE owner_id=$1 AND id=$2 AND entity=$3 FOR SHARE`,[actor,recordId,entity])).rows[0];
 if(!record||record.data._deleted==='true')throw fail(403,'Attachment outside local permission.');return record;
}
export async function enqueueAttachment(pool,actor,body){
 validateAttachment(body);const hash=syncHash(body);
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor]);
  const record=await authorize(c,actor,body.recordId,body.entity);
  const prior=(await c.query('SELECT * FROM d1_attachment_queue WHERE operation_id=$1 OR(actor=$2 AND id=$3)',[body.operationId,actor,body.id])).rows[0];
  if(prior){if(prior.actor!==actor||prior.payload_hash!==hash)throw fail(409,'Attachment identity collision.');return {id:body.id,state:prior.state,replay:true};}
  if(Number(record.version)!==body.recordVersion)throw fail(409,'Attachment record version changed.');
  await c.query("INSERT INTO d1_attachment_queue VALUES($1,$2,$3,$4,$5,'pending',NULL)",[actor,body.id,body.operationId,body,hash]);return {id:body.id,state:'pending'};
 });
}
export async function transferAttachment(pool,actor,id,{token,request}){
 if(!uuid(id))throw fail(400,'Invalid attachment identity.');
 const row=(await pool.query('SELECT * FROM d1_attachment_queue WHERE actor=$1 AND id=$2',[actor,id])).rows[0];
 if(!row)throw fail(403,'Attachment outside local permission.');
 await transaction(pool,c=>authorize(c,actor,row.body.recordId,row.body.entity));
 if(row.state==='acknowledged')return row.receipt;
 if(row.state!=='pending')throw fail(409,'Attachment requires explicit review.');
 const binding=(await pool.query('SELECT workspace_id FROM d1_sync_binding WHERE actor=$1',[actor])).rows[0];
 if(!binding)throw fail(403,'Attachment device not provisioned.');
 try{
  const receipt=await request(token,'/attachments/'+id,row.body);
  if(receipt.workspaceId!==binding.workspace_id||receipt.id!==id||receipt.operationId!==row.operation_id||receipt.recordId!==row.body.recordId||receipt.sha256!==row.body.sha256||receipt.size!==Buffer.from(row.body.bytes,'base64').length)throw fail(503,'Invalid attachment receipt.');
  await pool.query("UPDATE d1_attachment_queue SET state='acknowledged',receipt=$3 WHERE actor=$1 AND id=$2 AND payload_hash=$4",[actor,id,receipt,row.payload_hash]);return receipt;
 }catch(error){
  if(error.status===409||error.status===403||error.status===400)await pool.query('UPDATE d1_attachment_queue SET state=$3 WHERE actor=$1 AND id=$2 AND state=\'pending\'',[actor,id,error.status===409?'conflict':'rejected']);
  throw error;
 }
}
export async function fetchAttachment(pool,actor,id,{token,request}){
 if(!uuid(id))throw fail(400,'Invalid attachment identity.');
 const result=await request(token,'/attachments/'+id);
 if(result.id!==id)throw fail(503,'Attachment response identity mismatch.');
 return transaction(pool,async c=>{
  const record=await authorize(c,actor,result.recordId,result.entity);
  const bytes=validateAttachment({...result,operationId:randomUUID(),recordVersion:Number(record.version)});
  const old=(await c.query('SELECT sha256 FROM d1_attachment_cache WHERE actor=$1 AND id=$2 FOR UPDATE',[actor,id])).rows[0];
  if(old&&old.sha256!==result.sha256)throw fail(409,'Immutable cached attachment changed.');
  await c.query('INSERT INTO d1_attachment_cache VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(actor,id) DO NOTHING',[actor,id,result.recordId,result.entity,result.sha256,bytes]);return result;
 });
}
export async function readCachedAttachment(pool,actor,id){
 if(!uuid(id))throw fail(400,'Invalid attachment identity.');
 return transaction(pool,async c=>{
  const row=(await c.query('SELECT * FROM d1_attachment_cache WHERE actor=$1 AND id=$2',[actor,id])).rows[0];
  if(!row)throw fail(403,'Attachment unavailable locally.');await authorize(c,actor,row.record_id,row.entity);
  if(attachmentHash(row.bytes)!==row.sha256)throw fail(503,'Cached attachment corruption.');return row.bytes;
 });
}
