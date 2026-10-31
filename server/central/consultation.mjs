// Read-only adapter for the existing rc.3 session/snapshot contract.
// Authentication is delegated to the existing identity/session provider; this
// module has no registration, membership creation or business mutation path.
import http from 'node:http';
import {createHash} from 'node:crypto';
import {projectEmployee} from '../d1-lab/catalog-contract.mjs';
import {historicalEntities} from '../d1-lab/history-readonly.mjs';
import {createConsultationHistory} from './consultation-history.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const error=(status,message)=>Object.assign(Error(message),{status});
const masters=new Set(['Employee','Sector','JobRole','InventoryItem','ExpenseCategory']);
const viewerEntities=new Set(['Employee','Sector','JobRole']);
const media=b=>b.subarray(0,5).toString()==='%PDF-'?'pdf':b.subarray(0,3).toString('hex')==='ffd8ff'?'jpg':b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'?'png':b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'?'webp':null;

export async function createConsultationSource({workingPool,historyPool,workspaceId,grants}){
 if(!uuid(workspaceId)||!Array.isArray(grants))throw Error('EXPLICIT_EXISTING_WORKSPACE_AND_GRANTS_REQUIRED');
 const permissions=new Map();for(const g of grants){if(!uuid(g.userId)||permissions.has(g.userId)||!Array.isArray(g.entities)||g.entities.some(e=>!historicalEntities.includes(e)))throw Error('INVALID_CONSULTATION_GRANT');permissions.set(g.userId,g);}
 for(const pool of [workingPool,historyPool]){
  const state=(await pool.query("SELECT current_database() db,current_setting('port') port,current_setting('transaction_read_only') ro,current_user role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
  if(!/^ruy_private_import_(work|history)_[a-f0-9]{16}$/.test(state.db)||state.port!=='55483'||state.ro!=='on'||!/^ruy_consult_[a-f0-9]{16}_reader$/.test(state.role)||state.rolsuper||state.rolbypassrls||state.rolcreatedb||state.rolcreaterole)throw Error('RESTRICTED_PRIVATE_READER_REQUIRED');
  if((await pool.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','history','import_control') AND c.relkind IN ('r','v') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')")).rows[0].n)throw Error('BUSINESS_WRITE_PERMISSION_REFUSED');
  if((await pool.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','history','import_control') AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')")).rows[0].n||(await pool.query("SELECT has_database_privilege(current_database(),'CREATE,TEMP') bad")).rows[0].bad)throw Error('INDIRECT_WRITE_PERMISSION_REFUSED');
 }
 function scope(p){const g=permissions.get(p.actor_id);if(p.workspace_id!==workspaceId||!g||!['admin','viewer','writer'].includes(p.role)||g.role&&g.role!==p.role)throw error(403,'Consulta não autorizada.');return g;}
 function allowed(p){const g=scope(p);return g.entities.filter(e=>(p.role==='admin'||viewerEntities.has(e))&&(e!=='AuditLog'||p.role==='admin'&&g.audit===true));}
 const historical=createConsultationHistory({pool:historyPool,allowed,grant:scope});
 async function snapshot(p){
  const entities=allowed(p),records=(await historyPool.query('SELECT id,entity,legacy_id,payload,raw_json FROM history.records WHERE entity=ANY($1::text[]) ORDER BY entity,id',[entities])).rows;
  const working=(await workingPool.query('SELECT id,entity,data,version::text FROM d1_records UNION ALL SELECT id,entity,data,version::text FROM d2_catalog')).rows;
  const overlay=new Map(working.map(r=>[r.id,r]));
  const refs=(await historyPool.query("SELECT source_id,field,target_id FROM history.references WHERE status='confirmed' AND target_id IS NOT NULL")).rows;
  const holds=(await workingPool.query('SELECT record_id,reason FROM import_control.record_holds ORDER BY record_id,reason')).rows;
  const links=scope(p).attachments&&p.role==='admin'?(await historyPool.query("SELECT l.*,r.entity FROM history.attachment_links l JOIN history.attachments a ON a.id=l.attachment_id JOIN history.records r ON r.id=l.record_id WHERE a.state='linked' AND r.entity=ANY($1::text[])",[entities])).rows:[];
  const projected=records.map(r=>{
   const original=JSON.parse(r.raw_json),live=overlay.get(r.id),data={...r.payload,...(live?.data||{})};
   for(const ref of refs.filter(v=>v.source_id===r.id))data[ref.field.replace(/^data\./,'')]=ref.target_id;
   for(const key of Object.keys(data))if(/(?:url|urls)$/i.test(key))data[key]='';data.storage_path='';
   for(const link of links.filter(v=>v.record_id===r.id)){const field=link.field.replace(/^data\./,'');if(['storage_path','proof_url','invoice_url','document_url','attachment_url','photo_url','file_url'].includes(field))data[field==='storage_path'?'proof_url':field]='/api/d1/attachments/'+link.attachment_id+'/download';}
   const pending=holds.filter(v=>v.record_id===r.id).map(v=>v.reason);
   if(r.entity==='InventoryItem'&&pending.includes('STOCK_CLASSIFICATION_AND_OPENING_PENDING')){data.name='[PENDENTE DE CLASSIFICAÇÃO] '+(data.name||'Item');data.observation=(data.observation?data.observation+'\n':'')+'Quantidade histórica, não aprovada como saldo operacional.';}
   if(r.entity==='AuditLog'){
    // Large old/new snapshots remain intact in the archive/detail route. They
    // cannot fit the frozen rc.3 main-process 2 MiB snapshot response limit.
    delete data.old_value;delete data.new_value;data._originalDetailAvailable=true;
   }
   let value={...data,id:r.id,created_date:original.created_date,updated_date:original.updated_date,_historical:true,_readOnly:true,_legacyId:r.legacy_id,_reviewPending:pending,_openingApproved:false};
   if(r.entity==='Employee')value=projectEmployee(value,p.role);
   return {id:r.id,entity:r.entity,version:Number(live?.version||1),data:masters.has(r.entity)?value:{name:String(value.name||value.description||r.entity+' '+r.legacy_id).slice(0,120),payload_json:JSON.stringify(value),status:value.status||'ativo'}};
  });
  const result={head:0,records:projected,complete:true,consultationOnly:true,operationalEnabled:false,openingBalancesApproved:false,business:p.role==='admin'?{protocol:'D1BUS/1',workspaceId,head:0,complete:true,stock:[],accounts:[],movements:[],entries:[],settlements:[],reversals:[],consultationOnly:true,openingBalancesKnown:false}:undefined};
  if(Buffer.byteLength(JSON.stringify(result))>2*1024*1024)throw error(503,'Consulta excede o limite do cliente rc.3.');return result;
 }
 async function attachment(p,id){
  if(p.role!=='admin'||!scope(p).attachments)throw error(403,'Anexo não autorizado.');
  const row=(await historyPool.query("SELECT a.id,a.body,a.bytes::text,a.sha256 FROM history.attachments a WHERE a.id=$1 AND a.state='linked' AND EXISTS(SELECT 1 FROM history.attachment_links l JOIN history.records r ON r.id=l.record_id WHERE l.attachment_id=a.id AND r.entity=ANY($2::text[]))",[id,allowed(p)])).rows[0];
  if(!row)throw error(404,'Anexo indisponível.');const ext=media(row.body);if(!ext||row.body.length!==Number(row.bytes)||sha(row.body)!==row.sha256)throw error(503,'Integridade do anexo recusada.');
  // The alias is required by the frozen client's attachment validator. It does
  // not rename source objects or imply that their contents are fictitious.
  return {id:row.id,filename:'FICTICIO-historico-'+row.id+'.'+ext,mediaType:{pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[ext],sha256:row.sha256,bytes:row.body.toString('base64'),historical:true,consultationOnly:true};
 }
 async function attachments(p,id){if(p.role!=='admin'||!scope(p).attachments)throw error(403,'Anexos não autorizados.');return {records:(await historyPool.query("SELECT a.id,a.sha256,l.record_id AS \"recordId\",r.entity FROM history.attachments a JOIN history.attachment_links l ON l.attachment_id=a.id JOIN history.records r ON r.id=l.record_id WHERE l.record_id=$1 AND a.state='linked' AND r.entity=ANY($2::text[]) ORDER BY a.id",[id,allowed(p)])).rows};}
 async function detail(p,id){const row=(await historyPool.query('SELECT id,entity,legacy_id,raw_json FROM history.records WHERE id=$1',[id])).rows[0];if(!row||!allowed(p).includes(row.entity))throw error(404,'Registro indisponível.');if(p.role!=='admin')throw error(403,'Detalhe original restrito.');return {...row,consultationOnly:true};}
 async function query(p,route){
  scope(p);if(typeof route==='string'&&route.startsWith('/history/'))return historical.route(p,route);
  if(p.role!=='admin')throw error(403,'Consulta restrita.');
  if(/^\/domain\/history\/(Vale|Consumption)\/[a-f0-9-]{36}$/.test(route||''))return {records:[],consultationOnly:true,notice:'Histórico original preservado na auditoria; não houve novo processamento.'};
  throw error(405,'Cálculo, liquidação e reprocessamento não estão disponíveis na consulta.');
 }
 return {snapshot,attachment,attachments,detail,query,authorize:scope};
}

export function createConsultationApi({source,authentication,audit=()=>{}}){
 if(!source||!authentication||!['login','authorize','logout'].every(k=>typeof authentication[k]==='function'))throw Error('EXISTING_SESSION_PROVIDER_REQUIRED');
 const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   if(req.headers.host!=='127.0.0.1:'+server.address().port||req.headers.origin||req.headers.cookie)throw error(403,'Transporte central obrigatório.');
   if(req.headers['x-ruy-sync-contract']!=='RUY-SHARED-LAB/1')throw error(409,'Contrato incompatível.');
   const url=new URL(req.url,'http://127.0.0.1');let body;
   const login=req.method==='POST'&&url.pathname==='/api/local/d1/session/login'&&!url.search;
   const logout=req.method==='POST'&&url.pathname==='/api/local/d1/session/logout'&&!url.search;
   const query=req.method==='POST'&&url.pathname==='/api/local/d1/domain-query'&&!url.search;
   if(req.method!=='GET'&&!login&&!logout&&!query){audit({action:'consultation_write_refused',route:'business-write'});throw error(405,'Dados importados em consulta: alterações bloqueadas.');}
   if(login||logout||query){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw error(415,'JSON obrigatório.');let size=0;const chunks=[];for await(const b of req){size+=b.length;if(size>4096)throw error(413,'Limite excedido.');chunks.push(b);}try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw error(400,'JSON inválido.');}}
   if(req.method==='GET'&&req.url==='/api/local/d1/connection')return reply(200,{available:true,consultationOnly:true,operationalEnabled:false});
   if(login){const session=await authentication.login(null,body||{},{address:req.headers['x-ruy-client-address']||req.socket.remoteAddress});try{source.authorize({actor_id:session.userId,workspace_id:session.workspaceId,role:session.role});}catch(e){await authentication.logout(null,session.token).catch(()=>{});throw e;}return reply(200,session);}
   const token=req.headers['x-ruy-user-session'];const principal=await authentication.authorize(null,token);source.authorize(principal);
   if(logout)return reply(200,await authentication.logout(null,token));
   if(query)return reply(200,await source.query(principal,body?.route));
   if(req.method==='GET'&&req.url==='/api/local/d1/state')return reply(200,await source.snapshot(principal));
   if(req.method==='GET'&&req.url==='/api/local/d1/capabilities')return reply(200,{protocol:'D1LAB/1',contract:'RUY-SHARED-LAB/1',mode:'private-consultation',consultationOnly:true,operationalEnabled:false,individualCentralLogin:true,deviceAuthentication:'user-session',criticalOffline:false,payrollPayments:false,stockConsumption:false,manualFinancialCommands:false,manualFinancialReversal:false,deliveryReceipts:false});
   if(req.method==='GET'&&url.pathname==='/api/local/d1/attachments'&&/^\?record=[a-f0-9-]{36}$/.test(url.search))return reply(200,await source.attachments(principal,url.searchParams.get('record')));
   const attachment=url.pathname.match(/^\/api\/local\/d1\/attachments\/([a-f0-9-]{36})$/);if(req.method==='GET'&&attachment&&!url.search)return reply(200,await source.attachment(principal,attachment[1]));
   const detail=url.pathname.match(/^\/api\/local\/d1\/history\/([a-f0-9-]{36})$/);if(req.method==='GET'&&detail&&!url.search)return reply(200,await source.detail(principal,detail[1]));
   if(req.method==='GET'&&url.pathname==='/api/local/d1/changes'&&/^\?cursor=\d+$/.test(url.search))return reply(200,{records:[],changes:[],head:0,consultationOnly:true});
   throw error(404,'Rota de consulta indisponível.');
  }catch(e){reply([400,401,403,404,405,409,413,415,429,503].includes(e.status)?e.status:503,{error:e.status?e.message:'Consulta privada indisponível.'});}
 });server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
