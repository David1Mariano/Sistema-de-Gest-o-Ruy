import https from 'node:https';
import {isIP} from 'node:net';

const fingerprint=value=>String(value).replaceAll(':','').toUpperCase();
export function createLabTransport({key,cert,ca,devices,upstream='http://127.0.0.1:18092',host='127.0.0.1',allowPrivateNetwork=false}){
 if(!['http://127.0.0.1:18092'].includes(upstream))throw Error('Only isolated D1 gateway is allowed.');
 const privateIP=isIP(host)===4&&(/^(10\.|192\.168\.)/.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host));
 if(host!=='127.0.0.1'&&!(allowPrivateNetwork&&privateIP))throw Error('Loopback is the default; private network requires explicit opt-in.');
 if(!Array.isArray(devices)||!devices.length||devices.some(x=>!/^[A-F0-9]{64}$/.test(fingerprint(x.fingerprint))||!/^[a-f0-9]{64}$/.test(x.token)))throw Error('Certificate and device token bindings required.');
 if(new Set(devices.map(x=>fingerprint(x.fingerprint))).size!==devices.length||new Set(devices.map(x=>x.token)).size!==devices.length)throw Error('Unique certificate and token per device required.');
 const bindings=new Map(devices.map(x=>[fingerprint(x.fingerprint),'Bearer '+x.token]));
 const server=https.createServer({key,cert,ca,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.3'},async(req,res)=>{
  const reply=status=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Laboratory request refused.'}));};
  const device=bindings.get(fingerprint(req.socket.getPeerCertificate().fingerprint256));
  if(!req.socket.authorized||!device||req.headers.authorization!==device||req.headers.cookie||req.headers.origin)return reply(403);
  const push=req.method==='POST'&&req.url==='/api/local/d1/push';
  const attachment=/^\/api\/local\/d1\/attachments\/[a-f0-9-]{36}$/.test(req.url)&&['PUT','GET'].includes(req.method);
  const list=req.method==='GET'&&/^\/api\/local\/d1\/attachments\?record=[a-f0-9-]{36}$/.test(req.url);
  if(!push&&!attachment&&!list&&!(req.method==='GET'&&/^\/api\/local\/d1\/changes\?cursor=\d+$/.test(req.url)))return reply(404);
  const writes=push||attachment&&req.method==='PUT';
  if(writes&&!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415);
  try{
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return reply(413);chunks.push(chunk);}
   const response=await fetch(upstream+req.url,{method:req.method,redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:device,...(writes?{'Content-Type':'application/json'}:{})},body:writes?Buffer.concat(chunks):undefined});
   if(![200,400,401,403,409,413,503].includes(response.status))return reply(503);
   // Never relay upstream diagnostics or credentials.
   if(!response.ok)return reply(response.status);
   const result=await response.json();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
  }catch{return reply(503);}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 return {server,listen:port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);})};
}

// CA and hostname verification remain enabled; never use rejectUnauthorized=false.
export function sendLabTLS({url,key,cert,ca,token,method='GET',body}){
 const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password)throw Error('Authenticated HTTPS required.');
 return new Promise((resolve,reject)=>{
  const request=https.request(target,{key,cert,ca,minVersion:'TLSv1.3',method,timeout:7000,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})}},response=>{
   const chunks=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)response.destroy(Error('Response limit'));else chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
  });
  request.on('timeout',()=>request.destroy(Error('Laboratory transport timeout')));request.on('error',reject);request.end(body);
 });
}
