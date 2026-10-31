import https from 'node:https';
import * as tls from 'node:tls';
import {isIP} from 'node:net';
import {createReadStream} from 'node:fs';
let trustedRoots;
function systemRoots(){return trustedRoots??=(tls.getCACertificates?[...tls.getCACertificates('default'),...tls.getCACertificates('system')]:tls.rootCertificates);}
// Public HTTPS edge. No client certificate, enrollment, or device secret.
// Only session/login routes are forwarded; PostgreSQL remains loopback-only.
export function createUserTransport({key,cert,host='127.0.0.1',apiPort,allowPrivateNetwork=false,cloudflareTunnel=false,ngrokTunnel=false,publicHostname,serviceDiscovery,ngrokCompatibility=false,queryOnly=false,distribution=null}){
 if(!Number.isInteger(apiPort)||apiPort<1||apiPort>65535)throw Error('LOOPBACK_API_REQUIRED');
 if(host!=='127.0.0.1'&&!(allowPrivateNetwork&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)))throw Error('PRIVATE_BINDING_REQUIRED');
 if(cloudflareTunnel&&ngrokTunnel)throw Error('ONE_PROXY_PROVIDER_REQUIRED');
 if(ngrokCompatibility&&!cloudflareTunnel)throw Error('EXPLICIT_CLOUDFLARE_COMPATIBILITY_REQUIRED');
 if((cloudflareTunnel||ngrokTunnel)&&(host!=='127.0.0.1'||!publicHostname||!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i.test(publicHostname)||!publicHostname.includes('.')||isIP(publicHostname)))throw Error('PUBLIC_HOSTNAME_LOOPBACK_REQUIRED');
 const server=https.createServer({key,cert,minVersion:'TLSv1.2',requestCert:false},async(req,res)=>{
  const reply=(status,value={error:'Solicitação central recusada.'})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  let address=req.socket.remoteAddress;
  if(cloudflareTunnel||ngrokTunnel){
   // Temporary compatibility with the EXISTING synthetic ngrok gateway. Its
   // approved policy strips CF headers before adding the Ruy proxy headers.
   // Only enabled explicitly by the fixed homologation runner, never by the
   // private real-data consultation bootstrap.
   const legacy=cloudflareTunnel&&ngrokCompatibility&&!req.headers['cf-connecting-ip']&&req.headers['x-ruy-proxy-proto']==='https';
   const ngrok=ngrokTunnel||legacy;
   const forwarded=ngrok?req.headers['x-ruy-proxy-client-ip']:req.headers['cf-connecting-ip'];
   const protocol=ngrok?req.headers['x-ruy-proxy-proto']:req.headers['x-forwarded-proto'];
   if(address!=='127.0.0.1'||protocol!=='https'||!isIP(forwarded||''))return reply(403);
   address=forwarded;
   if(req.method==='GET'&&req.url==='/.well-known/sistema-ruy.json'){
    try{return reply(200,serviceDiscovery?await serviceDiscovery():{contract:'RUY-PUBLIC-API/1',apiOrigin:'https://'+publicHostname});}catch{return reply(503);}
   }
   if(distribution&&req.method==='GET'&&req.url==='/downloads/latest.json')return reply(200,distribution.manifest);
   const download=distribution&&[distribution,...(distribution.archives||[])].find(entry=>req.url==='/downloads/'+entry.manifest.name);
   if(download&&['GET','HEAD'].includes(req.method)){res.writeHead(200,{'Content-Type':'application/vnd.microsoft.portable-executable','Content-Length':download.manifest.bytes,'Content-Disposition':'attachment; filename="'+download.manifest.name+'"','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')return res.end();const stream=createReadStream(download.file);stream.on('error',()=>res.destroy());res.on('close',()=>{if(!res.writableFinished)stream.destroy();});stream.pipe(res);return;}
  }
  if(req.headers.origin||req.headers.cookie||req.headers['x-ruy-sync-contract']!=='RUY-SHARED-LAB/1')return reply(403);
  const route=req.url,login=req.method==='POST'&&route==='/api/local/d1/session/login';
  const session=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const connection=req.method==='GET'&&route==='/api/local/d1/connection';
  if(!login&&!connection&&!session)return reply(401);
  const read=req.method==='GET'&&(/^(?:\/api\/local\/d1\/(?:state|capabilities|connection)|\/api\/local\/d1\/changes\?cursor=\d+|\/api\/local\/d1\/attachments\?record=[a-f0-9-]{36}|\/api\/local\/d1\/attachments\/[a-f0-9-]{36})$/.test(route));
  const write=req.method==='POST'&&/^\/api\/local\/d1\/(session\/(login|logout)|operation|domain-command|catalog-command|domain-query|account|push)$/.test(route)||req.method==='PUT'&&/^\/api\/local\/d1\/attachments\/[a-f0-9-]{36}$/.test(route);
  if(!read&&!write)return reply(404);
  if(queryOnly&&write&&!/^\/api\/local\/d1\/(session\/(login|logout)|domain-query)$/.test(route))return reply(405);
  if(write&&!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415);
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(login?4096:req.method==='PUT'&&route.startsWith('/api/local/d1/attachments/')?22*1024*1024:1024*1024))return reply(413);chunks.push(chunk);}
   const response=await fetch('http://127.0.0.1:'+apiPort+route,{method:req.method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1','X-Ruy-Client-Release':/^[0-9a-z.-]{1,32}$/.test(req.headers['x-ruy-client-release']||'')?req.headers['x-ruy-client-release']:'legacy','X-Ruy-Client-Address':address,...(session?{'X-Ruy-User-Session':session}:{}),...(write?{'Content-Type':'application/json'}:{})},body:write?Buffer.concat(chunks):undefined});
   if(![200,400,401,403,404,405,409,413,415,422,429,503].includes(response.status))return reply(503);
   const value=await response.json();const publicCode=['VALIDATION_FAILED','SESSION_INVALID','ACCESS_DENIED','CENTRAL_CONFLICT','CONTENT_TOO_LARGE','BUSINESS_RULE_BLOCKED','RATE_LIMITED','CENTRAL_UNAVAILABLE','REQUEST_REFUSED','ATTACHMENT_STORAGE_FAILED','RUY_FINANCIAL_OPENING_REQUIRED','RUY_STOCK_CLASSIFICATION_REQUIRED'].includes(value.code);
   const safeError=publicCode&&typeof value.error==='string'&&value.error.length<500&&!/[\r\n]/.test(value.error)?{error:value.error,code:value.code}:undefined;
   return reply(response.status,response.ok?value:safeError||((response.status===422||value.code==='ATTACHMENT_STORAGE_FAILED')?value:undefined));
  }catch{return reply(503);}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=30;
 return {server,listen:port=>new Promise((r,j)=>{server.once('error',j);server.listen(port,host,r);})};
}
export function sendUserTLS({url,ca,userSession,method='GET',body,clientRelease,discoveryOnly=false}){
 const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password||target.hash)throw Error('HTTPS_REQUIRED');
 return new Promise((resolve,reject)=>{
  const req=https.request(target,{ca:ca||systemRoots(),minVersion:'TLSv1.2',method,timeout:10000,headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1',...(discoveryOnly&&target.origin==='https://quill-brunt-splinter.ngrok-free.dev'&&target.pathname==='/.well-known/sistema-ruy.json'&&method==='GET'&&!userSession&&!body?{'ngrok-skip-browser-warning':'true'}:{}),...(clientRelease?{'X-Ruy-Client-Release':clientRelease}:{}),...(userSession?{Authorization:'Bearer '+userSession}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{
   let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>(target.pathname.includes('/attachments/')?22*1024*1024:2*1024*1024))res.destroy(Error('RESPONSE_LIMIT'));else chunks.push(b);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
  });req.on('timeout',()=>req.destroy(Error('CENTRAL_TIMEOUT')));req.on('error',reject);req.end(body);
 });
}


