import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {staticRoute} from './routes.mjs';
import {fail} from './core.mjs';
import {authorizedReport} from './reports.mjs';
// Original stock screens display whole units/reais. Keep the integer ledger
// fields alongside them; never turn a UI conversion into a stock operation.
export function projectSharedMovement(r){
 const delta=Number(r.delta),cost=Number(r.cost),balance=Number(r.balance);
 if(![delta,cost,balance].every(Number.isSafeInteger)||cost<0)throw fail(503,'Movimento central fora da precisão suportada.');
 const total=(BigInt(Math.abs(delta))*BigInt(cost)+500n)/1000n;
 if(total>BigInt(Number.MAX_SAFE_INTEGER))throw fail(503,'Custo fora da precisão suportada.');
 return {id:r.operation+':'+r.item,operation_id:r.operation,item_id:r.item,item_name:r.item_name,unit:r.unit,quantity_milli:delta,quantity:Math.abs(delta)/1000,unit_cents:cost,unit_cost:cost/100,total_cost:Number(total)/100,balance_after_milli:balance,balance_after:balance/1000,movement_type:r.kind};
}
// Browser credentials are local, HttpOnly and never expose the central session
// or device private key. Only the owning Electron process holds the transport.
export function createSharedFacade({client,port=0,assetRoot}){
 let browserToken=null;
 const disposition=value=>{const name=[...(value.originalFilename||value.filename).split(/[\\/]/).pop()].map(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127?'_':c).join('');return 'attachment; filename="'+name.replace(/[^a-zA-Z0-9_.-]/g,'_')+'"; filename*=UTF-8'+"''"+encodeURIComponent(name);};
 const server=http.createServer(async(req,res)=>{
  const origin='http://127.0.0.1:'+server.address().port;
  const reply=(status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
  const cookie=value=>'ruy_shared='+value+'; HttpOnly; SameSite=Strict; Path=/api/d1; Max-Age='+(value?'28800':'0');
  try{
   if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw fail(403,'Origem recusada.');
   if(!['GET','POST'].includes(req.method))throw fail(405,'Método recusado.');
   const url=new URL(req.url,origin);
   if(await staticRoute(req,res,url,assetRoot?{root:assetRoot}:undefined))return;
   let body;
   if(req.method==='POST'){
    if(req.headers.origin!==origin||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(403,'Origem e JSON obrigatórios.');
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(url.pathname==='/api/d1/attachments'?22*1024*1024:16384))throw fail(413,'Limite de conteúdo.');chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks));}catch{throw fail(400,'JSON inválido.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Objeto obrigatório.');
   }
   if(req.method==='GET'&&url.pathname==='/api/d1/account/config')return reply(200,{enabled:true,sharedMode:true});
   if(req.method==='GET'&&url.pathname==='/api/d1/connection')return reply(200,await client.connection());
   if(req.method==='POST'&&url.pathname==='/api/d1/login'){
    const value=await client.login(body);browserToken=randomBytes(32).toString('hex');return reply(200,value,{'Set-Cookie':cookie(browserToken)});
   }
   const token=(req.headers.cookie||'').match(/(?:^|;\s*)ruy_shared=([a-f0-9]{64})(?:;|$)/)?.[1];
   if(!token||!browserToken||!timingSafeEqual(Buffer.from(token),Buffer.from(browserToken)))throw fail(401,'Entre com sua conta central.');
   const session=client.me();
   const archive=url.pathname.match(/^\/api\/d1\/archive\/(FinancialExpense|EmployeePayment|Vale|AccountsPayable)$/);
   if(req.method==='GET'&&archive&&!url.search)return reply(200,{records:client.archived(archive[1])});
   if(req.method==='GET'&&url.pathname.startsWith('/api/d1/history/')){
    const download=url.pathname.match(/^\/api\/d1\/history\/attachments\/([a-f0-9-]{36})\/download$/);
    if(download&&!url.search){const value=await client.attachmentGet(download[1]),bytes=Buffer.from(value.bytes,'base64');res.writeHead(200,{'Content-Type':value.mediaType||'application/octet-stream','X-Content-SHA256':value.sha256,'Content-Length':bytes.length,'Content-Disposition':disposition(value),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;}
    return reply(200,await client.query(url.pathname.slice('/api/d1'.length)+url.search));
   }
   if(req.method==='POST'&&req.headers['x-csrf-token']!==client.csrf())throw fail(403,'CSRF obrigatório.');
   if(url.pathname.startsWith('/api/d1/account/'))return reply(200,await client.account(url.pathname.slice('/api/d1'.length),body));
   if(req.method==='GET'&&(url.pathname.startsWith('/api/d1/domain/preview/')||url.pathname.startsWith('/api/d1/domain/history/')||url.pathname==='/api/d1/domain/financial-audit'||url.pathname.startsWith('/api/d1/settlements/')))return reply(200,await client.query(url.pathname.slice('/api/d1'.length)+url.search));
   if(req.method==='GET'&&url.pathname==='/api/d1/me')return reply(200,session);
   if(req.method==='GET'&&url.pathname==='/api/d1/sync-status')return reply(200,client.status());
   if(req.method==='GET'&&url.pathname==='/api/d1/pending')return reply(200,{total:0});
   if(req.method==='POST'&&url.pathname==='/api/d1/logout'){await client.logout();browserToken=null;return reply(200,{ok:true},{'Set-Cookie':cookie('')});}
   if(req.method==='POST'&&url.pathname==='/api/d1/domain/command')return reply(200,await client.domain(body));
   const report=url.pathname.match(/^\/api\/d1\/reports\/(employees|categories)$/);
   if(req.method==='GET'&&report){await client.refresh();return reply(200,await authorizedReport(null,session.user,report[1],Object.fromEntries(url.searchParams),{list:async(_user,entity)=>client.list(entity)}));}
   if(req.method==='GET'&&url.pathname==='/api/d1/attachments')return reply(200,await client.attachmentList());
   if(req.method==='POST'&&url.pathname==='/api/d1/attachments')return reply(200,await client.attachmentPut(body));
   if(req.method==='GET'&&url.pathname==='/api/d1/attachments/remote')return reply(200,await client.attachmentList(url.searchParams.get('record')));
   const file=url.pathname.match(/^\/api\/d1\/attachments\/([a-f0-9-]{36})(?:\/(download|fetch))?$/);
   if(file&&(req.method==='GET'&&!file[2]||req.method==='POST'&&file[2]==='fetch'))return reply(200,await client.attachmentGet(file[1]));
   if(file&&req.method==='GET'&&file[2]==='download'){const value=await client.attachmentGet(file[1]),bytes=Buffer.from(value.bytes,'base64');res.writeHead(200,{'Content-Type':value.mediaType||'application/octet-stream','X-Content-SHA256':value.sha256,'Content-Length':bytes.length,'Content-Disposition':disposition(value),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(bytes);return;}
   const entity=url.pathname.match(/^\/api\/d1\/(?:entities|catalog|domain)\/([A-Za-z]+)(?:\/([a-f0-9-]{36}))?$/);
   if(entity&&req.method==='GET'&&!entity[2])return reply(200,{records:client.list(entity[1]),shared:true});
   if(entity&&req.method==='POST'&&entity[2])return reply(200,await client.mutate(entity[1],entity[2],body));
   if(req.method==='GET'&&url.pathname==='/api/d1/attendance/status')return reply(200,{enabled:!session.consultationOnly,payrollCalculationEnabled:!session.consultationOnly,payrollPaymentsEnabled:!session.consultationOnly&&!session.operationalRestrictions?.financialOpeningPending});
   if(req.method==='GET'&&url.pathname==='/api/d1/modules/status')return reply(200,{purchaseReceipt:!session.consultationOnly,payrollPayments:!session.consultationOnly&&!session.operationalRestrictions?.financialOpeningPending,deliveryReceipts:!session.consultationOnly,shared:true});
   if(req.method==='GET'&&url.pathname==='/api/d1/delivery/status')return reply(200,{enabled:!session.consultationOnly,labOnly:!session.operationalActivationApproved,paymentIntegration:!session.consultationOnly,financialEnabled:!session.consultationOnly});
   if(req.method==='GET'&&url.pathname==='/api/d1/operations/state'){
    const state=client.state();return reply(200,{balances:(state?.stock||[]).map(r=>({item_id:r.item,quantity_milli:Number(r.quantity),average_cents:Number(r.average),last_cents:Number(r.last_cost),version:Number(r.version)})),accounts:(state?.accounts||[]).map(r=>({account:r.account,balance_cents:Number(r.balance),version:Number(r.version)})),movements:[...client.list('StockMovement'),...(state?.movements||[]).map(projectSharedMovement)],operationalSyncEnabled:!!session.operationalActivationApproved});
   }
   if(req.method==='POST'&&url.pathname==='/api/d1/operations/command')return reply(200,await client.operation(body));
   if(req.method==='POST'&&url.pathname==='/api/d1/operations/create-item')return reply(200,await client.operation({...body,kind:'create-item'}));
   throw fail(403,'Fluxo ainda não homologado no cliente compartilhado. Nenhum efeito foi executado.');
  }catch(error){reply([400,401,403,405,409,413,422,426,429,503].includes(error.status)?error.status:503,{error:error.status?error.message:'Consulta central indisponível. Dados preservados.',...(typeof error.code==='string'&&/^[A-Z_]{3,64}$/.test(error.code)?{code:error.code}:{})});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {server,listen:()=>new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);}),async close(){await new Promise(r=>server.close(r));await client.close();}};
}
