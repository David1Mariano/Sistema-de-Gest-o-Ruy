import {withinCentral} from '../central/context.mjs';
import http from 'node:http';
import {installation} from '../d1-lab/environment.mjs';
import {fail} from '../d1-lab/core.mjs';
import {acceptD1,changesD1} from './d1-central.mjs';
import {sharedSessions} from './shared-sessions.mjs';
import {sharedCapabilities,sharedCommandPolicy} from './shared-policy.mjs';
import {putAttachment,getAttachment,listAttachments} from './attachments.mjs';
import {sharedSnapshot} from './shared-snapshot.mjs';
import {onlineOperation} from './shared-online-command.mjs';
import {sharedDomainCommand} from './shared-domain-command.mjs';
import {sharedCatalogCommand} from './shared-catalog-command.mjs';
import {executeSharedDomain,sharedDomainQuery} from './shared-execution.mjs';
import {sharedAccounts} from './shared-accounts.mjs';
export async function createSharedLabServer({pool,identity}){
 if(process.env.RUY_SHARED_LAB!=='1'||installation?.id!=='final-dev-20261021')throw Error('Isolated shared laboratory required');
 const actual=(await pool.query("SELECT current_database() db,current_setting('port') port")).rows[0];
 if(!/^ruy_d1_rc_[a-f0-9]{16}$/.test(actual.db)||actual.port!==String(installation.dbPort))throw Error('Fresh synthetic database required');
 return createSharedApi({pool,identity,port:installation.gatewayPort});
}
export function createSharedApi({pool,identity,port=0,context=null,history=null,writable=async()=>true,authentication=null,policy=null}){
 const auth=authentication||sharedSessions(pool,identity);
 const server=http.createServer((req,res)=>withinCentral(context,async()=>{
  const actualPort=server.address()?.port||port;
  const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
  try{
   if(req.headers.host!==`127.0.0.1:${actualPort}`||req.headers.origin||req.headers.cookie)throw fail(403,'Server transport required.');
   if(req.headers['x-ruy-sync-contract']!==sharedCapabilities.contract)throw fail(409,'Unsupported synchronization contract.');
   if(req.method==='GET'&&req.url==='/api/local/d1/connection')return reply(200,{available:true,...policy?.connection});
   const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],session=req.headers['x-ruy-user-session'];
   const url=new URL(req.url,`http://127.0.0.1:${actualPort}`);let body;
   if(['POST','PUT'].includes(req.method)){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON required.');
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(req.method==='PUT'&&url.pathname.startsWith('/api/local/d1/attachments/')?22*1024*1024:1024*1024))throw fail(413,'Request limit.');chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail(400,'Invalid JSON.');}
   }
   if(req.method==='POST'&&url.pathname==='/api/local/d1/session/login'&&!url.search)return reply(200,await auth.login(token,body||{},{address:req.headers['x-ruy-client-address']||req.socket.remoteAddress}));
   const principal=await auth.authorize(token,session);
   if(policy)await policy.authorize(principal);
   if(['POST','PUT'].includes(req.method)&&url.pathname!=='/api/local/d1/session/logout'){
    if(!await writable())throw fail(503,'Central maintenance.');
    if(policy)await policy.beforeWrite(principal,url.pathname,body,req.headers['x-ruy-client-release']);
    if(history){const ids=new Set();const visit=v=>{if(typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v))ids.add(v);else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(body);if(req.method==='PUT'&&url.pathname.startsWith('/api/local/d1/attachments/')&&history.attachmentReference)ids.delete(body.recordId);if(ids.size>1000)throw fail(413,'Identifier limit.');await history.immutable(principal,[...ids]);}
   }
   if(req.method==='POST'&&url.pathname==='/api/local/d1/session/logout')return reply(200,await auth.logout(token,session));
   if(req.method==='GET'&&url.pathname==='/api/local/d1/capabilities')return reply(200,{...sharedCapabilities,...(context?{mode:context.lab?'controlled-synthetic-validation':'controlled-central',operationalEnabled:true}:{}),role:principal.role});
   if(req.method==='GET'&&url.pathname==='/api/local/d1/state'&&!url.search){const snapshot=await sharedSnapshot(pool,token,session,auth,{history});return reply(200,policy?await policy.snapshot(principal,snapshot,req.headers['x-ruy-client-release']):snapshot);}
   if(req.method==='POST'&&url.pathname==='/api/local/d1/domain-command'&&!url.search){
    const row=(await pool.query('SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[principal.workspace_id,body?.id])).rows[0],d=row?.data?.payload_json?JSON.parse(row.data.payload_json):{};
    const linked=d.settlement_id||d.payroll_run_id||d.delivery_order_id||d.accounts_payable_id||d.linked_payment_id;
    return reply(200,await (!linked&&['FinancialExpense','Revenue','FinancialAccount','CostCenter'].includes(body?.entity)?sharedDomainCommand(pool,token,session,auth,body):executeSharedDomain(pool,token,session,auth,body)));
   }
   if(req.method==='POST'&&url.pathname==='/api/local/d1/domain-query'&&!url.search)return reply(200,policy&&body?.route?.startsWith('/history/')?await policy.query(principal,body.route):await sharedDomainQuery(pool,token,session,auth,body?.route));
   if(req.method==='POST'&&url.pathname==='/api/local/d1/account'&&!url.search)return reply(200,await sharedAccounts(pool,identity,auth,token,session,body));
   if(req.method==='POST'&&url.pathname==='/api/local/d1/catalog-command'&&!url.search)return reply(200,await sharedCatalogCommand(pool,token,session,auth,body));
   if(req.method==='POST'&&url.pathname==='/api/local/d1/operation'&&!url.search)return reply(200,await acceptD1(pool,session,onlineOperation(principal,body),{business:true,authorizeSession:c=>auth.authorize(token,session,c,true)}));
   if(req.method==='GET'&&url.pathname==='/api/local/d1/changes'&&/^\?cursor=\d+$/.test(url.search))return reply(200,await changesD1(pool,session,Number(url.searchParams.get('cursor')),{business:true,readProjection:true}));
   if(req.method==='POST'&&url.pathname==='/api/local/d1/push'&&!url.search){sharedCommandPolicy(body);return reply(200,await acceptD1(pool,session,body,{business:true,authorizeSession:c=>auth.authorize(token,session,c,true)}));}
   const object=url.pathname.match(/^\/api\/local\/d1\/attachments\/([a-f0-9-]{36})$/);
   if(req.method==='GET'&&url.pathname==='/api/local/d1/attachments'&&/^\?record=[a-f0-9-]{36}$/.test(url.search)){const id=url.searchParams.get('record');const archived=history?await history.attachments(principal,id):[];let live;try{live=await listAttachments(pool,session,id,{historicalReference:history?.attachmentReference?(record,entity)=>history.attachmentReference(principal,record,entity):null});}catch(error){if(!archived.length||error.status!==403)throw error;live={records:[]};}return reply(200,{records:[...archived,...live.records]});}
   if(object&&!url.search&&req.method==='GET'){
    try{return reply(200,await getAttachment(pool,session,object[1],{historicalReference:history?.attachmentReference?(record,entity)=>history.attachmentReference(principal,record,entity):null}));}catch(e){if(!history||e.status!==403)throw e;}
    const archived=await history.attachment(principal,object[1]);if(!archived)throw fail(404,'Attachment unavailable.');return reply(200,archived);
   }
   if(object&&!url.search&&req.method==='PUT'&&body?.id===object[1])return reply(200,await putAttachment(pool,session,body,{authorizeSession:c=>auth.authorize(token,session,c,true),historicalReference:history?.attachmentReference?(record,entity)=>history.attachmentReference(principal,record,entity):null,historicalDuplicate:history?.attachmentDuplicate?(record,hash)=>history.attachmentDuplicate(principal,record,hash):null}));
      // POS routes
   if(url.pathname.startsWith('/api/pos/'))return posRoutes(pool,req,res,url,body);
   throw fail(404,'Unknown shared route.');
  }catch(caught){let error=caught;if(error.code==='P0001'&&['RUY_FINANCIAL_OPENING_REQUIRED','RUY_STOCK_CLASSIFICATION_REQUIRED'].includes(error.message))error=Object.assign(fail(422,error.message==='RUY_FINANCIAL_OPENING_REQUIRED'?'LiquidaÃ§Ã£o bloqueada: saldo de abertura da conta ainda nÃ£o confirmado. Documentos pendentes podem ser cadastrados.':'MovimentaÃ§Ã£o bloqueada: item de estoque pendente de classificaÃ§Ã£o e saldo inicial.'),{code:error.message});const status=[400,401,403,404,405,409,413,415,422,429].includes(error.status)?error.status:503,code=['ATTACHMENT_STORAGE_FAILED','RUY_FINANCIAL_OPENING_REQUIRED','RUY_STOCK_CLASSIFICATION_REQUIRED'].includes(error.code)?error.code:({400:'VALIDATION_FAILED',401:'SESSION_INVALID',403:'ACCESS_DENIED',409:'CENTRAL_CONFLICT',413:'CONTENT_TOO_LARGE',422:'BUSINESS_RULE_BLOCKED',429:'RATE_LIMITED',503:'CENTRAL_UNAVAILABLE'}[status]||'REQUEST_REFUSED');if(policy?.rejected)await policy.rejected({route:req.url?.split('?')[0],status,code}).catch(()=>{});if(process.env.RUY_SHARED_DIAGNOSTICS==='1')console.error(error);reply(status,{error:policy&&error.status?error.message:'Central request refused.',code});}
 }));
 server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
  
// POS integration routes (dev)  
import {posRoutes} from '../pos/api.mjs'; 

