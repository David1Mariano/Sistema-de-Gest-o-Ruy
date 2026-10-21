import {createHash} from 'node:crypto';
import {fail} from './core.mjs';

export const historicalEntities=Object.freeze(['Employee','Sector','JobRole','FinancialExpense','EmployeePayment','Vale','Consumption','Absence','Warning','InventoryItem','StockMovement','ExpenseCategory','AccountsPayable','FechamentoCaixa','AuditLog']);
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const allowedParameters=(url,keys)=>{for(const key of url.searchParams.keys())if(!keys.includes(key))throw fail(400,'Filtro histórico inválido.');};
export function createHistoryReader({pool,grants}){
 if(!pool||!Array.isArray(grants))throw Error('HISTORY_CONFIGURATION_REQUIRED');
 const permissions=new Map();
 for(const g of grants){
  if(!idPattern.test(g.userId)||permissions.has(g.userId)||!Array.isArray(g.entities)||g.entities.some(e=>!historicalEntities.includes(e)))throw Error('HISTORY_GRANT_INVALID');
  permissions.set(g.userId,{entities:new Set(g.entities),audit:g.audit===true,attachments:g.attachments===true});
 }
 let closing=false;
 async function verify(){
  const state=(await pool.query("SELECT current_setting('transaction_read_only') readonly,current_user role,current_database() database")).rows[0];
  if(state.readonly!=='on'||!/^ruy_history_.*reader$/.test(state.role))throw Error('HISTORY_READER_REQUIRED');
  const dangerous=(await pool.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('history','historical_view') AND c.relkind IN ('r','v') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')")).rows[0];
  if(dangerous.n)throw Error('HISTORY_WRITE_PRIVILEGE_REFUSED');
  await pool.query('SELECT project FROM historical_view.source_info');
 }
 function grant(user){if(closing)throw fail(503,'Consulta histórica indisponível.');const g=permissions.get(user.id);if(!g)throw fail(403,'Usuário sem acesso ao histórico.');return g;}
 function entities(user){const g=grant(user);return [...g.entities].filter(e=>e!=='AuditLog'||g.audit&&user.role==='admin');}
 function authorize(user,entity){if(!historicalEntities.includes(entity))throw fail(400,'Entidade histórica inválida.');if(!entities(user).includes(entity))throw fail(403,'Consulta histórica não autorizada.');}
 async function record(user,id){
  grant(user);if(!idPattern.test(id))throw fail(400,'Identificador histórico inválido.');
  const row=(await pool.query(`SELECT id,entity,legacy_id,original_created_date,original_updated_date,data::text AS data_text,
   (SELECT jsonb_agg(jsonb_build_object('name',e.key,'value',e.value,'kind',jsonb_typeof(data->e.key)) ORDER BY e.key) FROM jsonb_each_text(data) e) fields
   FROM historical_view.records WHERE id=$1`,[id])).rows[0];
  if(!row)throw fail(404,'Registro histórico não encontrado.');authorize(user,row.entity);return row;
 }
 async function route(req,res,url,user,reply){
  const base='/api/d1/history';if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return false;
  grant(user);if(req.method!=='GET')throw fail(405,'Histórico permite somente consulta.');
  if(url.pathname===base+'/status'){
   allowedParameters(url,[]);const allowed=entities(user);
   const counts=(await pool.query('SELECT entity,count(*)::int total FROM historical_view.records WHERE entity=ANY($1::text[]) GROUP BY entity ORDER BY entity',[allowed])).rows;
   reply(200,{title:'Histórico Recuperado — Supabase',readOnly:true,entities:counts,attachmentsAllowed:grant(user).attachments,auditAllowed:allowed.includes('AuditLog')});return true;
  }
  if(url.pathname===base+'/records'){
   allowedParameters(url,['entity','search','status','offset']);const entity=url.searchParams.get('entity');authorize(user,entity);
   const search=url.searchParams.get('search')||'',status=url.searchParams.get('status')||'',offsetText=url.searchParams.get('offset')||'0';
   if(search.length>120||status.length>60||!/^\d{1,7}$/.test(offsetText))throw fail(400,'Filtro histórico inválido.');
   const offset=Number(offsetText),term='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
   const args=[entity,term,status];
   const where="entity=$1 AND (legacy_id ILIKE $2 ESCAPE '\\' OR data::text ILIKE $2 ESCAPE '\\') AND ($3='' OR data->>'status'=$3)";
   const total=(await pool.query('SELECT count(*)::int total FROM historical_view.records WHERE '+where,args)).rows[0].total;
   const rows=(await pool.query("SELECT id,entity,legacy_id,original_created_date,original_updated_date,coalesce(data->>'name',data->>'description',data->>'employee_name',legacy_id) label,data->>'date' original_date,data->>'status' status,data->>'amount' amount,data->>'net_amount' net_amount FROM historical_view.records WHERE "+where+' ORDER BY legacy_id COLLATE "C" LIMIT 30 OFFSET $4',[...args,offset])).rows;
   reply(200,{records:rows,total,offset,limit:30,readOnly:true});return true;
  }
  const totals=url.pathname===base+'/totals';
  if(totals){
   allowedParameters(url,['entity']);const entity=url.searchParams.get('entity');authorize(user,entity);
   const values=(await pool.query("SELECT data->>'status' status,e.key field,count(*)::int count,sum(e.value::numeric)::text total FROM historical_view.records r CROSS JOIN LATERAL jsonb_each_text(r.data) e WHERE entity=$1 AND e.key IN ('amount','net_amount','gross_amount','current_stock','quantity') AND e.value ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' GROUP BY data->>'status',e.key ORDER BY status,field",[entity])).rows;
   reply(200,{totals:values,readOnly:true,notice:'Somas de valores originais por campo e estado; não representam saldo conciliado nem geram lançamentos.'});return true;
  }
  const detail=url.pathname.match(/^\/api\/d1\/history\/records\/([a-f0-9-]+)$/);
  if(detail){
   allowedParameters(url,[]);const row=await record(user,detail[1]);
   const exceptions=(await pool.query('SELECT field,target_entity,target_legacy_id,status FROM historical_view.exceptions WHERE source_id=$1',[row.id])).rows;
   const files=grant(user).attachments?(await pool.query("SELECT a.id,a.legacy_id,a.original_path,a.sha256,a.bytes::text FROM historical_view.attachments a JOIN historical_view.attachment_links l ON l.attachment_id=a.id WHERE l.record_id=$1 AND a.state='linked' ORDER BY a.id",[row.id])).rows:[];
   const related=row.entity==='Employee'?(await pool.query("SELECT id,entity,legacy_id,data->>'date' original_date,data->>'status' status FROM historical_view.records WHERE entity=ANY($1::text[]) AND data->>'employee_id'=$2 ORDER BY entity,legacy_id LIMIT 200",[entities(user).filter(e=>e!=='AuditLog'),row.legacy_id])).rows:[];
   reply(200,{record:row,exceptions,attachments:files,related,readOnly:true});return true;
  }
  const download=url.pathname.match(/^\/api\/d1\/history\/attachments\/([a-f0-9-]+)\/download$/);
  if(download){
   allowedParameters(url,[]);if(!grant(user).attachments)throw fail(403,'Consulta de anexo não autorizada.');if(!idPattern.test(download[1]))throw fail(400,'Identificador de anexo inválido.');
   const f=(await pool.query("SELECT a.id,a.sha256,a.bytes::text,c.body FROM historical_view.attachments a JOIN historical_view.attachment_content c ON c.id=a.id WHERE a.id=$1 AND a.state='linked' AND EXISTS(SELECT 1 FROM historical_view.attachment_links l JOIN historical_view.records r ON r.id=l.record_id WHERE l.attachment_id=a.id AND r.entity=ANY($2::text[]))",[download[1],entities(user)])).rows[0];
   if(!f)throw fail(404,'Anexo não disponível para consulta.');
   if(f.body.length!==Number(f.bytes)||createHash('sha256').update(f.body).digest('hex')!==f.sha256)throw fail(503,'Integridade do anexo não confirmada.');
   const extension=f.body.subarray(0,5).toString()==='%PDF-'?'pdf':f.body.subarray(0,3).equals(Buffer.from([255,216,255]))?'jpg':f.body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':f.body.subarray(0,4).toString()==='RIFF'&&f.body.subarray(8,12).toString()==='WEBP'?'webp':null;
   if(!extension)throw fail(503,'Tipo do anexo não confirmado.');
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="historico-'+f.id+'.'+extension+'"','Content-Length':f.body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-SHA256':f.sha256});res.end(f.body);return true;
  }
  throw fail(404,'Consulta histórica inexistente.');
 }
 return {verify,route,close:async()=>{closing=true;await pool.end();}};
}
