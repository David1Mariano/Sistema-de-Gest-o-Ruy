import http from 'node:http';
import pg from 'pg';
import {config} from './environment.mjs';
import {acceptD1,changesD1} from './d1-central.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic integration opt-in required.');
const c=(await config('central')).db;
if(c.host!=='127.0.0.1'||c.port!==55435||c.database!=='ruy_c2_central')throw Error('Synthetic central required.');
const pool=new pg.Pool({...c,max:5,connectionTimeoutMillis:3000,statement_timeout:5000});
pool.on('error',()=>console.error('Synthetic central pool unavailable.'));
const server=http.createServer(async(req,res)=>{
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
  if(req.headers.host!=='127.0.0.1:18090'||req.headers.origin||req.headers.cookie)return reply(403,{error:'Server transport only.'});
  const url=new URL(req.url,'http://127.0.0.1:18090');
  if(req.method==='GET'&&url.pathname==='/health'){await pool.query('SELECT 1');return reply(200,{status:'ok'});}
  const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)return reply(403,{error:'Credential required.'});
  if(req.method==='GET'&&url.pathname==='/d1/changes'&&/^\?cursor=\d+$/.test(url.search))return reply(200,await changesD1(pool,token,Number(url.searchParams.get('cursor'))));
  if(req.method!=='POST'||url.pathname!=='/d1/push')return reply(404,{error:'Not found.'});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'JSON required.'});
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return reply(413,{error:'Too large.'});chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON.'});}
  reply(200,await acceptD1(pool,token,body));
 }catch(error){reply(error.status||503,{error:'Synthetic request refused.'});}
});
server.requestTimeout=10000;server.headersTimeout=10000;
server.listen(18090,'127.0.0.1',()=>console.log('Synthetic integration central: 127.0.0.1:18090'));
const stop=()=>server.close(()=>pool.end().finally(()=>process.exit(0)));
process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{if(text.trim()==='shutdown')stop();});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
