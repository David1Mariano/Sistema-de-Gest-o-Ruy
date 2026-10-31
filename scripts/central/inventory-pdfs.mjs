// Read-only inventory. Exports verified copies to the protected private profile.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {json,openDpapi,project} from '../homologacao/common.mjs';
import {historyManifest} from '../../server/central/history.mjs';
const loc=await json(path.join(project,'artifacts/consulta-ativacao-20261029/location.json'));
const config=await json(path.join(loc.profile,'operational.json'));
const secret=await openDpapi(path.join(loc.profile,'operational.dpapi'));
const pool=new pg.Pool({...config.history.database,password:secret.historyPassword,options:'-c default_transaction_read_only=on',max:1});
try{
 const manifest=await historyManifest(pool);
 if(manifest.records!==1186||manifest.attachments!==59||manifest.datasetSha256!==config.history.datasetSha256)throw Error('PRESERVED_HISTORY_MISMATCH');
 const directory=path.join(loc.profile,'pdf-review-20261030');await fs.mkdir(directory,{recursive:true});
 const rows=(await pool.query(`SELECT a.id,a.body,a.sha256,a.bytes::text,a.state,
  (SELECT count(*)::int FROM history.attachment_links l WHERE l.attachment_id=a.id) links,
  (SELECT array_agg(DISTINCT r.entity) FROM history.attachment_links l JOIN history.records r ON r.id=l.record_id WHERE l.attachment_id=a.id) entities
  FROM history.attachments a ORDER BY a.id`)).rows;
 const files=[];
 for(const r of rows){const pdf=r.body.subarray(0,5).toString()==='%PDF-';if(createHash('sha256').update(r.body).digest('hex')!==r.sha256||r.body.length!==Number(r.bytes))throw Error('ATTACHMENT_HASH_MISMATCH');
  if(pdf){const target=path.join(directory,r.id+'.pdf');try{await fs.writeFile(target,r.body,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(createHash('sha256').update(await fs.readFile(target)).digest('hex')!==r.sha256)throw Error('EXPORTED_COPY_MISMATCH');}}
  files.push({id:r.id,sha256:r.sha256,bytes:Number(r.bytes),state:r.state,pdf,links:r.links,entities:r.entities||[]});
 }
 const refs=(await pool.query(`SELECT count(*)::int records_with_file_references FROM history.records WHERE raw_json ~* '(supabase|storage_path|proof_url|invoice_url|document_url|attachment_url|file_url)'`)).rows[0];
 const result={at:new Date().toISOString(),readOnly:true,originalBytesChanged:false,manifest,privateDirectory:directory,pdfs:files.filter(f=>f.pdf).length,linkedPdfs:files.filter(f=>f.pdf&&f.state==='linked').length,quarantinedPdfs:files.filter(f=>f.pdf&&f.state!=='linked').length,linked:files.filter(f=>f.state==='linked').length,quarantined:files.filter(f=>f.state!=='linked').length,referenceInventory:refs,externalStorageCompletenessProven:false,files};
 await fs.writeFile(path.join(project,'artifacts/consulta-ativacao-20261029/pdf-inventory.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,files:undefined}));
}finally{await pool.end();}
