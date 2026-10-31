// Read-only history presentation; original bytes/IDs never change.
import {createHash} from 'node:crypto';
const fail=(status,message)=>Object.assign(Error(message),{status});
const hash=b=>createHash('sha256').update(b).digest('hex');
const chunkSize=128*1024;
const fields={FinancialExpense:['amount'],EmployeePayment:['gross_amount','discount_amount','net_amount'],AccountsPayable:['amount'],Vale:['amount'],Consumption:['amount'],FechamentoCaixa:['opening_fund','counted_cash','expected_cash','difference']};
export function historicalCents(value){
 if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value))return null;
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^[-+]/,'').split('.');if(/[1-9]/.test(fraction.slice(2)))return null;return (negative?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.slice(0,2).padEnd(2,'0')));
}
export function createConsultationHistory({pool,allowed,grant}){
 function entity(p,value){if(!allowed(p).includes(value))throw fail(403,'Entidade histórica não autorizada.');return value;}
 const full=p=>{if(p.role!=='admin')throw fail(403,'Detalhe original restrito ao administrador autorizado.');};
 async function record(p,id){full(p);const r=(await pool.query('SELECT id,entity,legacy_id,raw_json,sha256,payload FROM history.records WHERE id=$1',[id])).rows[0];if(!r||!allowed(p).includes(r.entity))throw fail(404,'Registro histórico indisponível.');if(hash(Buffer.from(r.raw_json))!==r.sha256)throw fail(503,'Integridade histórica recusada.');return r;}
 async function financial(p){
  full(p);const entities=allowed(p).filter(e=>Object.hasOwn(fields,e));
  const columns=[...new Set(Object.values(fields).flat())];
  const rows=(await pool.query(`SELECT entity,payload->>'status' status,${columns.map(f=>`payload->>'${f}' "${f}"`).join(',')} FROM history.records WHERE entity=ANY($1::text[]) ORDER BY entity,id`,[entities])).rows;
  const groups=new Map();for(const row of rows){const key=row.entity+'|'+(row.status??'');let group=groups.get(key);if(!group){group={entity:row.entity,status:row.status,records:0,values:Object.fromEntries(fields[row.entity].map(field=>[field,{field,cents:0n,valid:0,missing:0,invalid:0}]))};groups.set(key,group);}group.records++;
   for(const [field,value] of Object.entries(group.values)){if(row[field]===null){value.missing++;continue;}const cents=historicalCents(row[field]);if(cents===null){value.invalid++;continue;}value.cents+=cents;value.valid++;}}
  return {readOnly:true,scope:'Todos os períodos recuperados; documentos não reprocessados',currentBalances:{status:'unknown',cashCents:null,bankCents:null,stockOpeningApproved:false},doNotSumAcrossEntities:true,records:rows.length,pendingVales:rows.filter(r=>r.entity==='Vale'&&r.status==='pendente').length,groups:[...groups.values()].map(g=>({...g,values:Object.values(g.values).map(v=>({...v,cents:v.valid&&!v.invalid&&!v.missing?v.cents.toString():null}))})),notice:'Pagamentos e despesas podem representar o mesmo desembolso. Somas históricas não são saldos atuais. Vales pendentes não geram descontos.'};
 }
 async function route(p,input){
  if(typeof input!=='string'||!input.startsWith('/history/')||input.includes('#')||input.includes('\\'))throw fail(400,'Consulta histórica inválida.');
  const url=new URL(input,'http://127.0.0.1');
  function parameters(names){for(const k of url.searchParams.keys())if(!names.includes(k)||url.searchParams.getAll(k).length!==1)throw fail(400,'Filtro histórico inválido.');}
  if(url.pathname==='/history/status'){parameters([]);const entities=allowed(p);return {readOnly:true,entities:(await pool.query('SELECT entity,count(*)::int total FROM history.records WHERE entity=ANY($1::text[]) GROUP BY entity ORDER BY entity',[entities])).rows,attachmentsAllowed:p.role==='admin'&&grant(p).attachments===true,auditAllowed:entities.includes('AuditLog')};}
  if(url.pathname==='/history/attachments-for-record'){
   parameters(['record']);full(p);if(grant(p).attachments!==true)throw fail(403,'Anexos não autorizados.');const id=url.searchParams.get('record');if(!/^[a-f0-9-]{36}$/.test(id||''))throw fail(400,'Registro inválido.');
   const entities=allowed(p);const records=(await pool.query(`SELECT DISTINCT a.id,a.original_path AS filename,a.bytes::text AS size,a.sha256,r.id AS "recordId",r.entity,r.legacy_id AS "legacyId",coalesce(r.payload->>'payment_date',r.payload->>'date',r.raw_json::jsonb->>'created_date') AS "sourceDate"
    FROM history.attachments a JOIN history.attachment_links l ON l.attachment_id=a.id JOIN history.records r ON r.id=l.record_id
    WHERE a.state='linked' AND r.entity=ANY($2::text[]) AND (r.id=$1 OR EXISTS(
     SELECT 1 FROM history.references f JOIN history.records owner ON owner.id=f.target_id
     WHERE f.source_id=r.id AND f.target_id=$1 AND f.status='confirmed' AND owner.entity='Employee'
      AND f.field IN('employee_id','data.employee_id'))) ORDER BY r.entity,r.id,a.id`,[id,entities])).rows;
   return {readOnly:true,records:records.map(r=>({...r,historical:true,url:'/api/d1/attachments/'+r.id+'/download'}))};
  }
  if(url.pathname==='/history/attachments'){
   parameters(['offset']);full(p);if(grant(p).attachments!==true)throw fail(403,'Anexos não autorizados.');const offset=url.searchParams.get('offset')||'0';if(!/^\d{1,7}$/.test(offset))throw fail(400,'Página inválida.');const entities=allowed(p);
   const total=(await pool.query("SELECT count(DISTINCT a.id)::int n FROM history.attachments a JOIN history.attachment_links l ON l.attachment_id=a.id JOIN history.records r ON r.id=l.record_id WHERE a.state='linked' AND r.entity=ANY($1::text[])",[entities])).rows[0].n;
   const records=(await pool.query("SELECT a.id,a.original_path,a.bytes::text,a.sha256,json_agg(json_build_object('id',r.id,'entity',r.entity,'legacy_id',r.legacy_id) ORDER BY r.id) AS records FROM history.attachments a JOIN history.attachment_links l ON l.attachment_id=a.id JOIN history.records r ON r.id=l.record_id WHERE a.state='linked' AND r.entity=ANY($1::text[]) GROUP BY a.id,a.original_path,a.bytes,a.sha256 ORDER BY a.id LIMIT 30 OFFSET $2",[entities,Number(offset)])).rows;
   return {readOnly:true,total,offset:Number(offset),records};
  }
  if(url.pathname==='/history/financial-summary'){parameters([]);return financial(p);}
  if(url.pathname==='/history/records'){
   parameters(['entity','search','status','offset']);const e=entity(p,url.searchParams.get('entity')),search=url.searchParams.get('search')||'',status=url.searchParams.get('status')||'',offset=url.searchParams.get('offset')||'0';
   if(search.length>120||status.length>60||!/^\d{1,7}$/.test(offset))throw fail(400,'Filtro histórico inválido.');
   const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%',args=[e,pattern,status];
   // Search only visible labels/IDs, never hidden CPF/banking/audit snapshots.
   const where="entity=$1 AND (legacy_id ILIKE $2 OR coalesce(payload->>'name',payload->>'employee_name',payload->>'description',payload->>'entity_type','') ILIKE $2) AND ($3='' OR payload->>'status'=$3)";
   const total=(await pool.query('SELECT count(*)::int n FROM history.records WHERE '+where,args)).rows[0].n;
   const rows=(await pool.query("SELECT id,entity,legacy_id,coalesce(payload->>'name',payload->>'employee_name',payload->>'description',payload->>'entity_type',legacy_id) label,coalesce(payload->>'date',payload->>'payment_date') original_date,raw_json::jsonb->>'created_date' original_created_date,payload->>'status' status,payload->>'amount' amount,payload->>'net_amount' net_amount FROM history.records WHERE "+where+' ORDER BY legacy_id,id LIMIT 30 OFFSET $4',[...args,Number(offset)])).rows;
   return {readOnly:true,total,offset:Number(offset),records:p.role==='admin'?rows:rows.map(({amount:_amount,net_amount:_net,...r})=>r)};
  }
  if(url.pathname==='/history/totals'){parameters(['entity']);const e=entity(p,url.searchParams.get('entity'));if(p.role!=='admin'||!fields[e])return {totals:[],readOnly:true};const data=await financial(p);return {totals:data.groups.filter(g=>g.entity===e).flatMap(g=>g.values.map(v=>({...v,status:g.status,totalCents:v.cents,total:v.cents===null?null:formatDecimal(v.cents),count:g.records}))),readOnly:true,currentBalances:data.currentBalances};}
  const detail=url.pathname.match(/^\/history\/records\/([a-f0-9-]{36})$/);
  if(detail){parameters([]);const r=await record(p,detail[1]),raw=JSON.parse(r.raw_json),bytes=Buffer.byteLength(r.raw_json);
   const exceptions=(await pool.query("SELECT field,target_entity,target_legacy_id,status FROM history.references WHERE source_id=$1 AND status='missing'",[r.id])).rows;
   const attachments=grant(p).attachments?(await pool.query("SELECT a.id,a.original_path,a.sha256,a.bytes::text FROM history.attachments a JOIN history.attachment_links l ON l.attachment_id=a.id WHERE l.record_id=$1 AND a.state='linked' ORDER BY a.id",[r.id])).rows:[];
   const related=(await pool.query("SELECT DISTINCT t.id,t.entity,t.legacy_id FROM history.references f JOIN history.records t ON t.id=CASE WHEN f.source_id=$1 THEN f.target_id ELSE f.source_id END WHERE (f.source_id=$1 OR f.target_id=$1) AND f.status='confirmed' AND t.entity=ANY($2::text[]) ORDER BY t.entity,t.id LIMIT 200",[r.id,allowed(p)])).rows;
   return {readOnly:true,record:{id:r.id,entity:r.entity,legacy_id:r.legacy_id,original_created_date:raw.created_date,original_updated_date:raw.updated_date,data_text:null,fields:[]},original:{bytes,sha256:r.sha256,chunkSize,chunks:Math.ceil(bytes/chunkSize)},exceptions,attachments,related};
  }
  const chunk=url.pathname.match(/^\/history\/records\/([a-f0-9-]{36})\/chunks$/);
  if(chunk){parameters(['offset']);const offset=url.searchParams.get('offset');if(!/^\d{1,9}$/.test(offset||''))throw fail(400,'Deslocamento inválido.');const r=await record(p,chunk[1]),raw=Buffer.from(r.raw_json),start=Number(offset);if(start>=raw.length||start%chunkSize!==0)throw fail(400,'Bloco histórico inválido.');const b=raw.subarray(start,start+chunkSize);return {id:r.id,offset:start,bytes:b.toString('base64'),length:b.length,totalBytes:raw.length,sha256:r.sha256,done:start+b.length===raw.length};}
  throw fail(404,'Rota histórica inexistente.');
 }
 return {route,financial};
}
function formatDecimal(cents){const n=BigInt(cents),a=n<0n?-n:n;return (n<0n?'-':'')+(a/100n).toString()+'.'+(a%100n).toString().padStart(2,'0');}
