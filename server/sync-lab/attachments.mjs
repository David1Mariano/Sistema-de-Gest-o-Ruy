import {validateAttachment,attachmentHash} from '../d1-lab/attachment-contract.mjs';
import {transaction,fail,digest,uuid} from '../d1-lab/core.mjs';
import {syncHash} from '../d1-lab/sync-contract.mjs';
async function principal(c,token){
 const p=(await c.query('SELECT * FROM d1_principals WHERE token_hash=$1 FOR SHARE',[digest(token||'')])).rows[0];
 if(!p?.active||p.role!=='admin')throw fail(403,'Attachment permission denied.');return p;
}
async function reference(c,p,id,entity){
 const record=(await c.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2 FOR SHARE',[p.workspace_id,id])).rows[0];
 if(!record||record.entity!==entity||record.data._deleted==='true')throw fail(403,'Attachment record unavailable.');return record;
}
export async function putAttachment(pool,token,body){
 const bytes=validateAttachment(body),hash=syncHash(body);
 return transaction(pool,async c=>{
  const p=await principal(c,token);
  // Same lock order as acceptD1, avoiding races with record deletion/version changes.
  await c.query('SELECT cursor FROM d1_central_clock WHERE singleton FOR UPDATE');
  const record=await reference(c,p,body.recordId,body.entity);
  const prior=(await c.query('SELECT * FROM d1_attachment_receipts WHERE operation_id=$1',[body.operationId])).rows[0];
  if(prior){if(prior.workspace_id!==p.workspace_id||prior.device_id!==p.device_id||prior.payload_hash!==hash)throw fail(409,'Attachment operation collision.');return {...prior.result,replay:true};}
  if(Number(record.version)!==body.recordVersion)throw fail(409,'Attachment record version changed.');
  const old=(await c.query('SELECT id FROM d1_attachment_objects WHERE workspace_id=$1 AND id=$2',[p.workspace_id,body.id])).rows[0];
  if(old)throw fail(409,'Immutable attachment identity already exists.');
  await c.query('INSERT INTO d1_attachment_objects VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspace_id,body.id,body.recordId,body.entity,body.filename,body.mediaType,body.sha256,bytes]);
  const result={id:body.id,operationId:body.operationId,workspaceId:p.workspace_id,recordId:body.recordId,sha256:body.sha256,size:bytes.length};
  await c.query('INSERT INTO d1_attachment_receipts VALUES($1,$2,$3,$4,$5)',[body.operationId,p.workspace_id,p.device_id,hash,result]);
  await c.query("INSERT INTO d1_attachment_audit(workspace_id,actor_id,object_id,action) VALUES($1,$2,$3,'upload')",[p.workspace_id,p.actor_id,body.id]);return result;
 });
}
export async function getAttachment(pool,token,id){
 if(!uuid(id))throw fail(400,'Invalid attachment identity.');
 return transaction(pool,async c=>{
  const p=await principal(c,token),row=(await c.query('SELECT * FROM d1_attachment_objects WHERE workspace_id=$1 AND id=$2',[p.workspace_id,id])).rows[0];
  if(!row)throw fail(403,'Attachment unavailable.');await reference(c,p,row.record_id,row.entity);
  if(attachmentHash(row.bytes)!==row.sha256)throw fail(503,'Stored attachment integrity failed.');
  return {id:row.id,recordId:row.record_id,entity:row.entity,filename:row.filename,mediaType:row.media_type,sha256:row.sha256,bytes:row.bytes.toString('base64')};
 });
}
export async function listAttachments(pool,token,recordId){
 if(!uuid(recordId))throw fail(400,'Invalid record identity.');
 return transaction(pool,async c=>{
  const p=await principal(c,token);
  const record=(await c.query('SELECT entity FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,recordId])).rows[0];
  if(!record)throw fail(403,'Record unavailable.');await reference(c,p,recordId,record.entity);
  return {records:(await c.query('SELECT id,record_id AS "recordId",entity,filename,media_type AS "mediaType",sha256 FROM d1_attachment_objects WHERE workspace_id=$1 AND record_id=$2 ORDER BY id LIMIT 200',[p.workspace_id,recordId])).rows};
 });
}
