import {validateAttachment,attachmentHash} from '../d1-lab/attachment-contract.mjs';
import {transaction,fail,digest,uuid} from '../d1-lab/core.mjs';
import {syncHash} from '../d1-lab/sync-contract.mjs';
async function principal(c,token){
 const p=(await c.query('SELECT * FROM d1_principals WHERE token_hash=$1 FOR SHARE',[digest(token||'')])).rows[0];
 if(!p?.active||p.role!=='admin')throw fail(403,'Attachment permission denied.');return p;
}
async function reference(c,p,id,entity,historicalReference){
 const record=(await c.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2 FOR SHARE',[p.workspace_id,id])).rows[0];
 if(!record&&historicalReference)return historicalReference(id,entity);
 if(!record||entity&&record.entity!==entity||record.data._deleted==='true')throw fail(403,'Attachment record unavailable.');return record;
}
export async function putAttachment(pool,token,body,{authorizeSession=null,historicalReference=null,historicalDuplicate=null}={}){
 const bytes=validateAttachment(body),hash=syncHash(body);
 return transaction(pool,async c=>{
  await c.query('SELECT cursor FROM d1_central_clock WHERE singleton FOR UPDATE');
  const p=await principal(c,token);
  if(authorizeSession)await authorizeSession(c);
  const record=await reference(c,p,body.recordId,body.entity,historicalReference);
  const prior=(await c.query('SELECT * FROM d1_attachment_receipts WHERE operation_id=$1',[body.operationId])).rows[0];
  if(prior){if(prior.workspace_id!==p.workspace_id||prior.device_id!==p.device_id||prior.payload_hash!==hash)throw fail(409,'Attachment operation collision.');return {...prior.result,replay:true};}
  if(Number(record.version)!==body.recordVersion)throw fail(409,'Attachment record version changed.');
  if(historicalReference)await c.query('INSERT INTO d1_attachment_targets(workspace_id,record_id,entity,live_record_id,history_dataset) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[p.workspace_id,body.recordId,body.entity,record.historical?null:body.recordId,record.datasetSha256||null]);
  const bind=async(objectId,historicalDataset=null)=>{if(body.field)await c.query('INSERT INTO d1_attachment_bindings(workspace_id,operation_id,record_id,field,object_id,live_object_id,history_dataset,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspace_id,body.operationId,body.recordId,body.field,objectId,historicalDataset?null:objectId,historicalDataset,p.actor_id]);};
  const duplicate=(await c.query('SELECT id FROM d1_attachment_objects WHERE workspace_id=$1 AND record_id=$2 AND sha256=$3 ORDER BY id LIMIT 1',[p.workspace_id,body.recordId,body.sha256])).rows[0]||await historicalDuplicate?.(body.recordId,body.sha256);
  if(duplicate){await bind(duplicate.id,duplicate.historical?duplicate.datasetSha256:null);const result={id:duplicate.id,operationId:body.operationId,recordId:body.recordId,sha256:body.sha256,size:bytes.length,deduplicated:true};await c.query('INSERT INTO d1_attachment_receipts VALUES($1,$2,$3,$4,$5)',[body.operationId,p.workspace_id,p.device_id,hash,result]);return result;}
  const old=(await c.query('SELECT id FROM d1_attachment_objects WHERE workspace_id=$1 AND id=$2',[p.workspace_id,body.id])).rows[0];
  if(old)throw fail(409,'Immutable attachment identity already exists.');
  if(historicalReference)await c.query('INSERT INTO d1_attachment_targets(workspace_id,record_id,entity,live_record_id,history_dataset) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[p.workspace_id,body.recordId,body.entity,record.historical?null:body.recordId,record.datasetSha256||null]);
  await c.query('INSERT INTO d1_attachment_objects VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspace_id,body.id,body.recordId,body.entity,body.filename,body.mediaType,body.sha256,bytes]);
  await bind(body.id);
  const result={id:body.id,operationId:body.operationId,workspaceId:p.workspace_id,recordId:body.recordId,sha256:body.sha256,size:bytes.length};
  await c.query('INSERT INTO d1_attachment_receipts VALUES($1,$2,$3,$4,$5)',[body.operationId,p.workspace_id,p.device_id,hash,result]);
  await c.query("INSERT INTO d1_attachment_audit(workspace_id,actor_id,object_id,action) VALUES($1,$2,$3,'upload')",[p.workspace_id,p.actor_id,body.id]);return result;
 }).catch(error=>{if(error.status)throw error;throw Object.assign(fail(503,'Falha de armazenamento central. O envio não foi confirmado.'),{code:'ATTACHMENT_STORAGE_FAILED'});});
}
export async function getAttachment(pool,token,id,{historicalReference=null}={}){
 if(!uuid(id))throw fail(400,'Invalid attachment identity.');
 return transaction(pool,async c=>{
  const p=await principal(c,token),row=(await c.query('SELECT * FROM d1_attachment_objects WHERE workspace_id=$1 AND id=$2',[p.workspace_id,id])).rows[0];
  if(!row)throw fail(403,'Attachment unavailable.');await reference(c,p,row.record_id,row.entity,historicalReference);
  if(attachmentHash(row.bytes)!==row.sha256)throw fail(503,'Stored attachment integrity failed.');
  return {id:row.id,recordId:row.record_id,entity:row.entity,filename:row.filename,mediaType:row.media_type,sha256:row.sha256,bytes:row.bytes.toString('base64')};
 });
}
export async function listAttachments(pool,token,recordId,{historicalReference=null}={}){
 if(!uuid(recordId))throw fail(400,'Invalid record identity.');
 return transaction(pool,async c=>{
  const p=await principal(c,token);
  await reference(c,p,recordId,null,historicalReference);
  return {records:(await c.query(`SELECT o.id,o.record_id AS "recordId",o.entity,o.filename,o.media_type AS "mediaType",o.sha256,octet_length(o.bytes) size,
   (SELECT min(created_at) FROM d1_attachment_audit a WHERE a.workspace_id=o.workspace_id AND a.object_id=o.id AND action='upload') AS "uploadedAt"
   FROM d1_attachment_objects o WHERE workspace_id=$1 AND record_id=$2 ORDER BY id LIMIT 200`,[p.workspace_id,recordId])).rows};
 });
}
