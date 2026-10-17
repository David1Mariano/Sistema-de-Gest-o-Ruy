import http from 'node:http';
import {acceptD1,changesD1} from './d1-central.mjs';
import {putAttachment,getAttachment} from './attachments.mjs';
export function createD1Central(pool,{attachments=false}={}){
 const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   if(req.headers.host!==`127.0.0.1:${server.address().port}`||req.headers.origin||req.headers.cookie)return reply(403,{error:'Server transport required.'});
   const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return reply(403,{error:'Device credential required.'});
   const url=new URL(req.url,'http://127.0.0.1'),object=attachments&&url.pathname.match(/^\/d1\/attachments\/([a-f0-9-]{36})$/);
   if(object&&req.method==='GET'&&!url.search)return reply(200,await getAttachment(pool,token,object[1]));
   if(req.method==='GET'&&url.pathname==='/d1/changes'&&/^\?cursor=\d+$/.test(url.search))return reply(200,await changesD1(pool,token,Number(url.searchParams.get('cursor'))));
   if(url.search||!(req.method==='POST'&&url.pathname==='/d1/push'||object&&req.method==='PUT'))return reply(404,{error:'Unknown route.'});
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,{error:'JSON required.'});
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return reply(413,{error:'Body limit.'});chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON.'});}
   if(object&&body?.id!==object[1])return reply(400,{error:'Attachment identity mismatch.'});
   return reply(200,object?await putAttachment(pool,token,body):await acceptD1(pool,token,body));
  }catch(error){reply([400,403,409,413].includes(error.status)?error.status:503,{error:'Synthetic request refused.'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;return server;
}
