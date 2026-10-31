import {createHash} from 'node:crypto';
const fields=['proof_url','invoice_url','document_url','photo_url','file_url','attachment_url'];
const sha=b=>createHash('sha256').update(b).digest('hex');
function identity(record,field,digest){const b=createHash('sha1').update(Buffer.from('75c7b9b86d064bf189d14e566b45c050','hex')).update('RUY-EMBEDDED/1|'+record+'|'+field+'|'+digest).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
export async function recoveredEmbeddedIndex(pool){
 const rows=(await pool.query('SELECT id,entity,legacy_id,payload,raw_json,sha256 FROM history.records ORDER BY id')).rows;
 const held=new Set((await pool.query("SELECT sha256 FROM history.attachments WHERE state<>'linked'")).rows.map(r=>r.sha256));
 const files=new Map(),byRecord=new Map(),pending=[];
 for(const r of rows){if(sha(Buffer.from(r.raw_json))!==r.sha256)throw Error('ORIGINAL_RECORD_INTEGRITY_FAILED');const original=JSON.parse(r.raw_json);for(const field of fields){const value=r.payload[field];if(typeof value!=='string'||!value.startsWith('data:'))continue;if((original.data?.[field]??original[field])!==value)throw Error('ORIGINAL_ATTACHMENT_FIELD_MISMATCH');
  const match=value.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([\s\S]+)$/i);if(!match){pending.push({record:r.id,field,reason:'unsupported-inline-type'});continue;}
  const encoded=match[2].replace(/\s/g,''),bytes=Buffer.from(encoded,'base64'),type=match[1].toLowerCase(),digest=sha(bytes);
  const valid=bytes.length>0&&bytes.length<=30*1024*1024&&bytes.toString('base64')===encoded&&(type==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-'&&bytes.subarray(-4096).includes(Buffer.from('%%EOF')):type==='image/jpeg'?bytes.subarray(0,3).toString('hex')==='ffd8ff'&&bytes.subarray(-4096).includes(Buffer.from([255,217])):type==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&bytes.subarray(-4096).includes(Buffer.from('IEND')):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP');
  if(!valid||held.has(digest)){pending.push({record:r.id,field,reason:held.has(digest)?'quarantine-hash':'invalid-inline-content'});continue;}
  const id=identity(r.id,field,digest),ext=({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[type];
  const file={id,recordId:r.id,entity:r.entity,legacyId:r.legacy_id,field,filename:r.entity+'-'+r.legacy_id+'-'+field+'.'+ext,mediaType:type,sha256:digest,body:bytes,size:bytes.length,historical:true,embedded:true};files.set(id,file);if(!byRecord.has(r.id))byRecord.set(r.id,[]);byRecord.get(r.id).push(file);
 }}
 return {files,pending,forRecord:id=>byRecord.get(id)||[]};
}
