import {createHash} from 'node:crypto';
import {fail} from './core.mjs';
import {historicalEntities} from './history-readonly.mjs';
import {catalogFields,projectEmployee} from './catalog-contract.mjs';
import {isDomain} from './domain-contract.mjs';
import {API_PORT,installation} from './environment.mjs';
// Adapter for NORMAL screen contracts, using a new reconciled import only.
// Imported financial effects are never replayed. No ownership is reassigned.
export function createOperationalHistory({pool,grants}){
 if(!pool||!Array.isArray(grants))throw Error('OPERATIONAL_HISTORY_CONFIGURATION_REQUIRED');
 const access=new Map();
 for(const g of grants){if(!/^[a-f0-9-]{36}$/.test(g.userId)||access.has(g.userId)||!Array.isArray(g.entities)||g.entities.some(e=>!historicalEntities.includes(e)))throw Error('OPERATIONAL_HISTORY_GRANT_INVALID');access.set(g.userId,{entities:new Set(g.entities),attachments:g.attachments===true});}
 const grant=user=>{const g=access.get(user.id);if(!g||user.role!=='admin')throw fail(403,'Consulta migrada exige administrador autorizado.');return g;};
 async function verify(){
  const r=(await pool.query("SELECT current_database() db,current_setting('port') port,current_user role,current_setting('transaction_read_only') readonly")).rows[0];
  if(!/^ruy_operational_trial_[a-f0-9]{12}$/.test(r.db)||r.port!==String(installation?.operationalCandidate?installation.dbPort:55463))throw Error('ISOLATED_OPERATIONAL_IMPORT_REQUIRED');
  if(!/^ruy_import_[a-f0-9]{16}_reader$/.test(r.role)||r.readonly!=='on')throw Error('OPERATIONAL_HISTORY_READER_REQUIRED');
  const privilege=(await pool.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('history','public') AND c.relkind IN ('r','v') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')")).rows[0];
  if(privilege.n)throw Error('OPERATIONAL_HISTORY_WRITE_PRIVILEGE_REFUSED');
  const projects=(await pool.query('SELECT DISTINCT project FROM history.batches')).rows;if(projects.length!==1||projects[0].project!=='wvcvveqdkecsoygtilop')throw Error('HISTORICAL_PROJECT_MISMATCH');
  const s=(await pool.query("SELECT count(*)::int n,count(*) FILTER(WHERE source_sha256<>r.sha256)::int bad FROM historical_import_receipts p JOIN history.records r ON r.id=p.source_id")).rows[0];
  if(s.n!==1186||s.bad)throw Error('OPERATIONAL_IMPORT_NOT_RECONCILED');
 }
 async function list(user,entity){
  const g=grant(user);
  if(!historicalEntities.includes(entity))return [];
  if(!g.entities.has(entity))throw fail(403,'Entidade migrada não autorizada.');
  const rows=(await pool.query(`SELECT r.id,r.legacy_id,r.payload,r.raw_json,
   coalesce((SELECT jsonb_object_agg(field,target_id::text) FROM history.references f WHERE f.source_id=r.id AND f.status='confirmed' AND f.target_id IS NOT NULL),'{}'::jsonb) canonical,
   (SELECT count(*)::int FROM history.references f WHERE f.source_id=r.id AND f.status='missing') missing
   FROM history.records r JOIN historical_import_receipts p ON p.source_id=r.id WHERE r.entity=$1 ORDER BY r.legacy_id`,[entity])).rows;
  const result=[];
  for(const r of rows){
   const original=JSON.parse(r.raw_json),data={...r.payload,...r.canonical};
   // Never retain legacy remote/private URLs in a screen-facing projection.
   for(const key of Object.keys(data))if(/(?:url|urls)$/i.test(key))data[key]='';
   data.storage_path='';
   if(g.attachments){const links=(await pool.query("SELECT l.field,a.id,a.metadata->>'mimetype' mime FROM history.attachment_links l JOIN history.attachments a ON a.id=l.attachment_id WHERE l.record_id=$1 AND a.state='linked' ORDER BY a.id",[r.id])).rows;for(const l of links){const field=l.field.replace(/^data[.]/,'');const target=field==='storage_path'?'proof_url':field;if(!['proof_url','invoice_url','document_url','attachment_url','photo_url','file_url'].includes(target))continue;data[target]='http://127.0.0.1:'+API_PORT+'/api/d1/migrated/attachments/'+l.id+'/download';if(l.mime)data.mime_type=l.mime;}}
   result.push(projectEmployee({...data,id:r.id,created_date:original.created_date,updated_date:original.updated_date,_version:1,_historical:true,_readOnly:true,_legacyId:r.legacy_id,_missingReferences:r.missing},user.role));
  }
  return result;
 }
 async function route(req,res,url,user,reply){
  const g=grant(user);
  if(req.method==='POST'&&!['/api/d1/logout'].includes(url.pathname))throw fail(403,'Importação em homologação: efeitos históricos e alterações bloqueados.');
  if(req.method!=='GET')return false;
  const match=url.pathname.match(/^\/api\/d1\/(entities|catalog|domain)\/([A-Za-z]+)$/);
  if(match&&match[2]==='Purchase')throw fail(503,'Compras operacionais não pertencem a esta fonte histórica.');
  if(match&&(historicalEntities.includes(match[2])||catalogFields[match[2]]||isDomain(match[2])||['Evaluation','EmployeeDocument','Schedule','TimeRecord'].includes(match[2]))) {reply(200,{records:await list(user,match[2]),historicalImport:true,readOnly:true,sourceEntityPresent:historicalEntities.includes(match[2])});return true;}
  if(url.pathname==='/api/d1/operations/state'){reply(200,{movements:await list(user,'StockMovement'),balances:[],accounts:[],businessConfirmed:false,operationalSyncEnabled:false,historicalImport:true});return true;}
  const download=url.pathname.match(/^\/api\/d1\/migrated\/attachments\/([a-f0-9-]{36})\/download$/);
  if(download){
   if(!g.attachments)throw fail(403,'Anexos não autorizados.');
   const f=(await pool.query("SELECT a.body,a.sha256,a.bytes::text FROM history.attachments a WHERE a.id=$1 AND a.state='linked' AND EXISTS(SELECT 1 FROM history.attachment_links l JOIN history.records r ON r.id=l.record_id WHERE l.attachment_id=a.id AND r.entity=ANY($2::text[]))",[download[1],[...g.entities]])).rows[0];
   if(!f)throw fail(404,'Anexo indisponível.');
   if(f.body.length!==Number(f.bytes)||createHash('sha256').update(f.body).digest('hex')!==f.sha256)throw fail(503,'Integridade não confirmada.');
   const type=f.body.subarray(0,5).toString()==='%PDF-'?'application/pdf':f.body.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':f.body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':f.body.subarray(0,4).toString()==='RIFF'&&f.body.subarray(8,12).toString()==='WEBP'?'image/webp':null;
   if(!type)throw fail(503,'Tipo do anexo não confirmado.');
   res.writeHead(200,{'Content-Type':type,'Content-Length':f.body.length,'Content-Disposition':'attachment; filename="comprovante-'+download[1]+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-SHA256':f.sha256});res.end(f.body);return true;
  }
  return false;
 }
 return {verify,list,route};
}
