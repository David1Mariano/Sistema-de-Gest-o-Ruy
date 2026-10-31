import https from 'node:https';
import {isIP} from 'node:net';
import {verifyDiscovery} from './public-discovery.mjs';

// Compatibility bootstrap for already-installed rc.3 clients. No upstream,
// database, authentication, attachment or operational route exists here.
export function createDiscoveryOnlyTransport({key,cert,document,publicKey,deploymentId,minimumGeneration}) {
 if(typeof document!=='function'||!Number.isSafeInteger(minimumGeneration)||minimumGeneration<2)throw Error('APPROVED_DISCOVERY_TRANSITION_REQUIRED');
 const server=https.createServer({key,cert,minVersion:'TLSv1.2'},async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  if(req.socket.remoteAddress!=='127.0.0.1'||req.headers['x-ruy-proxy-proto']!=='https'||!isIP(req.headers['x-ruy-proxy-client-ip']||'')||req.headers.origin||req.headers.cookie)return reply(403,{error:'Bootstrap recusado.'});
  if(req.method!=='GET'||req.url!=='/.well-known/sistema-ruy.json')return reply(410,{error:'Esta origem oferece somente descoberta assinada.'});
  try{const d=await document();const verified=verifyDiscovery(d,{publicKey,deploymentId,minimumGeneration});if(verified.endpoint!=='https://api.ruycaldodecana.com.br')throw Error('OFFICIAL_API_REQUIRED');reply(200,d);}catch{reply(503,{error:'Descoberta indisponivel.'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;
 return {server,listen:port=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);})};
}
