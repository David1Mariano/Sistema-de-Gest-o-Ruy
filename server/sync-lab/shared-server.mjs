import http from 'node:http';
import {installation} from '../d1-lab/environment.mjs';
import {fail} from '../d1-lab/core.mjs';
import {acceptD1,changesD1} from './d1-central.mjs';
import {sharedSessions} from './shared-sessions.mjs';
import {sharedCapabilities,sharedCommandPolicy} from './shared-policy.mjs';
import {putAttachment,getAttachment,listAttachments} from './attachments.mjs';
export async function createSharedLabServer({pool,identity}){
 if(process.env.RUY_SHARED_LAB!=='1'||installation?.id!=='final-dev-20261021')throw Error('Isolated shared laboratory required');
 const actual=(await pool.query("SELECT current_database() db,current_setting('port') port")).rows[0];
 if(!/^ruy_d1_rc_[a-f0-9]{16}$/.test(actual.db)||actual.port!==String(installation.dbPort))throw Error('Fresh synthetic database required');
 const auth=sharedSessions(pool,identity),port=installation.gatewayPort;
 const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
  try{
   if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin||req.headers.cookie)throw fail(403,'Server transport required.');
   if(req.headers['x-ruy-sync-contract']!==sharedCapabilities.contract)throw fail(409,'Unsupported synchronization contract.');
   const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],session=req.headers['x-ruy-user-session'];
   const url=new URL(req.url,`http://127.0.0.1:${port}`);let body;
   if(['POST','PUT'].includes(req.method)){
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON required.');
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw fail(413,'Request limit.');chunks.push(chunk);}
    try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw fail(400,'Invalid JSON.');}
   }
   if(req.method==='POST'&&url.pathname==='/api/local/d1/session/login')return reply(200,await auth.login(token,body||{}));
   const principal=await auth.authorize(token,session);
   if(req.method==='POST'&&url.pathname==='/api/local/d1/session/logout')return reply(200,await auth.logout(token,session));
   if(req.method==='GET'&&url.pathname==='/api/local/d1/capabilities')return reply(200,{...sharedCapabilities,role:principal.role});
   if(req.method==='GET'&&url.pathname==='/api/local/d1/changes'&&/^\?cursor=\d+$/.test(url.search))return reply(200,await changesD1(pool,session,Number(url.searchParams.get('cursor')),{business:true,readProjection:true}));
   if(req.method==='POST'&&url.pathname==='/api/local/d1/push'&&!url.search){sharedCommandPolicy(body);return reply(200,await acceptD1(pool,session,body,{business:true,authorizeSession:c=>auth.authorize(token,session,c,true)}));}
   const object=url.pathname.match(/^\/api\/local\/d1\/attachments\/([a-f0-9-]{36})$/);
   if(req.method==='GET'&&url.pathname==='/api/local/d1/attachments'&&/^\?record=[a-f0-9-]{36}$/.test(url.search))return reply(200,await listAttachments(pool,session,url.searchParams.get('record')));
   if(object&&!url.search&&req.method==='GET')return reply(200,await getAttachment(pool,session,object[1]));
   if(object&&!url.search&&req.method==='PUT'&&body?.id===object[1])return reply(200,await putAttachment(pool,session,body,{authorizeSession:c=>auth.authorize(token,session,c,true)}));
   throw fail(404,'Unknown shared route.');
  }catch(error){reply([400,401,403,404,405,409,413,415,429].includes(error.status)?error.status:503,{error:'Shared laboratory request refused.'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
