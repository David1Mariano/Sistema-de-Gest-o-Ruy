import {createHash} from 'node:crypto';
import {fail,uuid} from '../d1-lab/core.mjs';
import {historicalEntities} from '../d1-lab/history-readonly.mjs';
import {recoveredEmbeddedIndex} from './embedded-attachments.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const masters=new Set(['Employee','Sector','JobRole','InventoryItem','ExpenseCategory']);
export async function historyManifest(pool){
 const c=await pool.connect();try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const records=(await c.query('SELECT id,entity,raw_json,sha256 FROM history.records ORDER BY id')).rows;
  const files=(await c.query('SELECT id,body,bytes::text,sha256,state FROM history.attachments ORDER BY id')).rows;
  if(records.some(r=>sha(Buffer.from(r.raw_json))!==r.sha256)||files.some(r=>r.body.length!==Number(r.bytes)||sha(r.body)!==r.sha256))throw Error('HISTORY_INTEGRITY_FAILED');
  const datasetSha256=sha(JSON.stringify({records:records.map(({id,entity,sha256})=>({id,entity,sha256})),attachments:files.map(({id,sha256,state})=>({id,sha256,state}))}));
  await c.query('COMMIT');return {datasetSha256,records:records.length,attachments:files.length};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function createCentralHistory({pool,central,profile}){
 const state=(await pool.query("SELECT current_database() db,current_setting('port') port,current_user role,current_setting('transaction_read_only') ro")).rows[0];
 if(state.db!==profile.history.database.database||state.port!==String(profile.database.port)||state.role!==profile.history.database.user||state.ro!=='on')throw Error('READ_ONLY_HISTORY_REQUIRED');
 const unsafe=(await pool.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('history','public') AND c.relkind IN ('r','v') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')")).rows[0].n;
 if(unsafe)throw Error('HISTORY_WRITE_PRIVILEGES_REFUSED');
 const manifest=await historyManifest(pool);
 const embedded=await recoveredEmbeddedIndex(pool);
 if(Object.keys(manifest).some(k=>manifest[k]!==profile.history[k]))throw Error('HISTORY_MANIFEST_MISMATCH');
 const grants=new Map();for(const g of profile.history.grants){if(!uuid(g.userId)||!Array.isArray(g.entities)||g.entities.some(e=>!historicalEntities.includes(e))||grants.has(g.userId))throw Error('HISTORY_GRANTS_INVALID');grants.set(g.userId,g);}
 async function binding(p){const r=(await central.query('SELECT * FROM central_history_binding WHERE workspace_id=$1',[p.workspace_id])).rows[0];if(!r||r.dataset_sha256!==manifest.datasetSha256||r.records!==manifest.records||r.attachments!==manifest.attachments)throw fail(503,'Historical binding unavailable.');}
 async function grant(p){await binding(p);const g=grants.get(p.actor_id);if(p.role!=='admin'||!g)return null;return g;}
 const cached=new Map();
 async function list(p){
  const g=await grant(p);if(!g)return [];
  const key=p.actor_id+':'+p.role;if(cached.has(key))return structuredClone(cached.get(key));
  const rows=(await pool.query(`SELECT r.id,r.entity,r.payload,r.raw_json,r.legacy_id,
   coalesce((SELECT jsonb_object_agg(field,target_id::text) FROM history.references f WHERE f.source_id=r.id AND f.status='confirmed' AND f.target_id IS NOT NULL),'{}'::jsonb) canonical,
   (SELECT count(*)::int FROM history.references f WHERE f.source_id=r.id AND f.status='missing') missing
   FROM history.records r WHERE entity=ANY($1::text[]) ORDER BY entity,id`,[g.entities])).rows;
  const links=g.attachments?(await pool.query("SELECT l.record_id,l.field,a.id FROM history.attachment_links l JOIN history.attachments a ON a.id=l.attachment_id WHERE a.state='linked' ORDER BY a.id")).rows:[];
  const result=[];
  for(const r of rows){
   const original=JSON.parse(r.raw_json),data={...r.payload,...Object.fromEntries(Object.entries(r.canonical).map(([field,id])=>[field.replace(/^data\./,''),id]))};for(const key of Object.keys(data))if(/(?:url|urls)$/i.test(key))data[key]='';data.storage_path='';
   for(const l of links.filter(l=>l.record_id===r.id)){const field=l.field.replace(/^data\./,'');if(['storage_path','proof_url','invoice_url','document_url','attachment_url','photo_url','file_url'].includes(field))data[field==='storage_path'?'proof_url':field]='/api/d1/attachments/'+l.id+'/download';}
   for(const file of g.attachments?embedded.forRecord(r.id):[]){if(!data[file.field]){data[file.field]='/api/d1/attachments/'+file.id+'/download';data._attachmentFields={...data._attachmentFields,[file.field]:{id:file.id,filename:file.filename,mediaType:file.mediaType,size:file.size}};}}
   const review=embedded.pending.filter(f=>f.record===r.id);if(review.length)data._attachmentReviewPending=review.map(f=>f.field);
   if(r.entity==='AuditLog'){delete data.old_value;delete data.new_value;data._originalDetailAvailable=true;}
   const value={...data,id:r.id,created_date:original.created_date,updated_date:original.updated_date,_historical:true,_readOnly:true,_legacyId:r.legacy_id,_missingReferences:r.missing};
   result.push({id:r.id,entity:r.entity,version:1,data:masters.has(r.entity)?value:{name:'FICTICIO Historico '+r.id,payload_json:JSON.stringify(value),status:value.status||'ativo'}});
  }
  cached.set(key,structuredClone(result));return result;
 }
 async function immutable(p,ids){
  await binding(p);if(!ids.length)return;
  if(ids.some(id=>embedded.files.has(id)))throw fail(409,'Historical attachment identity is immutable.');
  if(ids.some(id=>!uuid(id)))throw fail(400,'Invalid historical identifier.');
  if((await pool.query('SELECT 1 FROM history.attachments WHERE id=ANY($1::uuid[]) LIMIT 1',[ids])).rowCount)throw fail(409,'Historical attachment identity is immutable.');
  const rows=(await pool.query('SELECT id,entity FROM history.records WHERE id=ANY($1::uuid[])',[ids])).rows;
  // Historical financial/stock effects are never replayed. A copied working
  // master may be edited through its normal versioned command.
  for(const r of rows){if(!masters.has(r.entity)||(await central.query('SELECT 1 FROM d1_central_records WHERE workspace_id=$1 AND id=$2 AND entity=$3',[p.workspace_id,r.id,r.entity])).rowCount!==1)throw fail(409,'Historical record is read-only.');}
 }
 async function attachment(p,id){
  const g=await grant(p);if(!g?.attachments)throw fail(403,'Historical attachments unauthorized.');
  const inline=embedded.files.get(id);if(inline){if(!g.entities.includes(inline.entity))throw fail(403,'Historical attachments unauthorized.');if(sha(inline.body)!==inline.sha256)throw fail(503,'Historical attachment integrity failed.');return {id,filename:inline.filename,mediaType:inline.mediaType,sha256:inline.sha256,bytes:inline.body.toString('base64'),historical:true};}
  const row=(await pool.query("SELECT a.id,a.body,a.sha256,a.bytes::text,a.original_path FROM history.attachments a WHERE id=$1 AND state='linked' AND EXISTS(SELECT 1 FROM history.attachment_links l JOIN history.records r ON r.id=l.record_id WHERE l.attachment_id=a.id AND r.entity=ANY($2::text[]))",[id,g.entities])).rows[0];
  if(!row)return null;
  if(row.body.length!==Number(row.bytes)||sha(row.body)!==row.sha256)throw fail(503,'Historical attachment integrity failed.');
  const ext=row.body.subarray(0,5).toString()==='%PDF-'?'pdf':row.body.subarray(0,3).toString('hex')==='ffd8ff'?'jpg':row.body.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':row.body.subarray(0,4).toString()==='RIFF'&&row.body.subarray(8,12).toString()==='WEBP'?'webp':null;
  if(!ext)throw fail(503,'Historical attachment media refused.');
  // Frozen rc.1 client requires this transport alias. Original metadata and
  // bytes remain untouched in the read-only source.
  return {id,filename:'FICTICIO-historico-'+id+'.'+ext,originalFilename:row.original_path?.split(/[\\/]/).pop(),mediaType:{pdf:'application/pdf',jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[ext],sha256:row.sha256,bytes:row.body.toString('base64'),historical:true};
 }
 async function attachments(p,recordId){const g=await grant(p);if(!g?.attachments)return [];const direct=(await pool.query("SELECT a.id,a.sha256,r.entity,l.record_id AS \"recordId\",a.original_path AS filename,a.bytes::text AS size,true AS historical,r.payload->>'date' AS \"uploadedAt\" FROM history.attachments a JOIN history.attachment_links l ON l.attachment_id=a.id JOIN history.records r ON r.id=l.record_id WHERE l.record_id=$1 AND a.state='linked' AND r.entity=ANY($2::text[]) ORDER BY a.id",[recordId,g.entities])).rows;return [...direct,...embedded.forRecord(recordId).filter(f=>g.entities.includes(f.entity)).map(f=>({id:f.id,recordId:f.recordId,entity:f.entity,filename:f.filename,mediaType:f.mediaType,sha256:f.sha256,size:f.size,historical:true}))];}
 async function attachmentReference(p,id,entity){const g=await grant(p);if(!g?.attachments)throw fail(403,'Historical attachments unauthorized.');const r=(await pool.query('SELECT id,entity FROM history.records WHERE id=$1 AND entity=ANY($2::text[])',[id,g.entities])).rows[0];if(!r||entity&&r.entity!==entity)throw fail(403,'Attachment record unavailable.');return {...r,version:1,historical:true,datasetSha256:manifest.datasetSha256};}
 async function attachmentDuplicate(p,recordId,digest){const a=(await attachments(p,recordId)).find(a=>a.sha256===digest);return a?{...a,datasetSha256:manifest.datasetSha256}:null;}
 return {manifest,list,immutable,attachment,attachments,attachmentReference,attachmentDuplicate};
}
