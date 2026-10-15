import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pool as openPool,home,ports} from './environment.mjs';
import {digest,fail,accept,principal,localSave,status} from './protocol.mjs';
import {acceptD1,changesD1} from './d1-central.mjs';
const mode=process.argv[2];
const {pool,config}=await openPool(mode);
if(mode!=='central'){
 const identity=(await pool.query('SELECT * FROM identity WHERE singleton')).rows[0];
 if(identity?.device_id!==config.identity.deviceId||identity.actor_id!==config.identity.actorId||identity.workspace_id!==config.identity.workspaceId)throw Error('Identidade C2 divergente.');
}
const origin=`http://127.0.0.1:${ports[mode]}`;
const server=http.createServer(async(req,res)=>{
 const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 try{
  if(req.headers.host!==`127.0.0.1:${ports[mode]}`||req.headers.origin&&req.headers.origin!==origin)throw fail(403,'Origem recusada.');
  if(!['GET','POST'].includes(req.method))throw fail(405,'Método recusado.');
  const url=new URL(req.url,origin);
  if(url.pathname==='/health'&&req.method==='GET'){await pool.query('SELECT 1');return reply(200,{service:'ruy-c2-sync-lab',mode,syntheticOnly:true});}
  const token=(req.headers.authorization||'').match(/^Bearer ([a-z0-9]+)$/)?.[1];
  if(!token)throw fail(401,'Autenticação obrigatória.');
  if(mode!=='central'&&digest(token)!==digest(config.localToken))throw fail(403,'Credencial local recusada.');
  let body;
  if(req.method==='POST'){
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON obrigatório.');
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(url.pathname.startsWith('/d1/')?262144:16384))throw fail(413,'Conteúdo excessivo.');chunks.push(chunk);}
   try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'JSON inválido.');}
   if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Objeto obrigatório.');
  }
  if(mode==='central'){
   if(url.pathname==='/d1/push'&&req.method==='POST')return reply(200,await acceptD1(pool,token,body));
   if(url.pathname==='/d1/changes'&&req.method==='GET')return reply(200,await changesD1(pool,token,Number(url.searchParams.get('cursor')||0)));
   if(url.pathname==='/push'&&req.method==='POST'){
    const result=await accept(pool,token,body);
    const flag=path.join(home,'drop-next-central-response.json');
    try{await fs.access(flag);await fs.unlink(flag);req.socket.destroy();return;}catch(e){if(e.code!=='ENOENT')throw e;}
    return reply(200,result);
   }
   if(url.pathname==='/changes'&&req.method==='GET'){
    const p=await principal(pool,token),cursor=Number(url.searchParams.get('cursor')||0);
    if(!Number.isSafeInteger(cursor)||cursor<0)throw fail(400,'Cursor inválido.');
    const changes=(await pool.query('SELECT * FROM changes WHERE workspace_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 100',[p.workspace_id,cursor])).rows;
    return reply(200,{changes,cursor:changes.length?Number(changes.at(-1).cursor):cursor,hasMore:changes.length===100});
   }
   if(url.pathname==='/status'&&req.method==='GET'){
    if(digest(token)!==digest(config.localToken))throw fail(403,'Inspeção central restrita.');
    return reply(200,(await pool.query('SELECT (SELECT count(*)::int FROM records) records,(SELECT count(*)::int FROM receipts) receipts,(SELECT count(*)::int FROM changes) changes')).rows[0]);
   }
  }else{
   if(url.pathname==='/records'&&req.method==='POST')return reply(200,await localSave(pool,config.identity,body));
   if(url.pathname==='/records'&&req.method==='GET')return reply(200,{records:(await pool.query('SELECT * FROM records ORDER BY id')).rows,shadows:(await pool.query('SELECT * FROM shadow ORDER BY record_id')).rows});
   if(url.pathname==='/status'&&req.method==='GET')return reply(200,await status(pool));
   if(url.pathname==='/outbox'&&req.method==='GET')return reply(200,{operations:(await pool.query('SELECT * FROM outbox ORDER BY created_at,operation_id LIMIT 200')).rows});
  }
  throw fail(404,'Rota C2 inexistente.');
 }catch(e){reply(e.status||(e.code==='23505'?409:500),{error:e.status?e.message:'Erro da simulação C2.',...(e.status===409?{remote:e.remote??null}:{})});}
});
server.requestTimeout=10000;server.headersTimeout=10000;
server.on('error',()=>{console.error('API C2 não iniciou.');pool.end().finally(()=>process.exit(1));});
server.listen(ports[mode],'127.0.0.1',async()=>{await fs.writeFile(path.join(home,mode+'.pid'),String(process.pid));console.log(`API C2 ${mode} loopback:${ports[mode]}`);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>pool.end().finally(()=>process.exit(0)));server.closeAllConnections();});
