// Targeted loopback transport/configuration validation. No central startup,
// external traffic, database writes, discovery publication or client changes.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import {createUserTransport} from '../../server/sync-lab/user-transport.mjs';
import {json,openDpapi,project,dataRoot} from '../homologacao/common.mjs';

const profile=path.join(dataRoot,'central-lab-79402bbf27e83425');
const secrets=await openDpapi(path.join(profile,'secrets.dpapi'));
const ca=await fs.readFile(path.join(profile,'test-ca.pem'));
const out=path.join(project,'artifacts/dominio-oficial-20261029/homologacao');
const checks=[];
const passed=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name);};
const fixtureSession='a'.repeat(64);
const stub=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 const authorized=req.headers['x-ruy-user-session']===fixtureSession;
 res.statusCode=req.url==='/api/local/d1/connection'||authorized?200:401;
 res.end(JSON.stringify({available:true,syntheticOnly:true,clientAddress:req.headers['x-ruy-client-address']}));
});
const close=server=>new Promise(resolve=>{if(!server?.listening)return resolve();server.closeAllConnections();server.close(resolve);});
let edge,strict;
try{
 await new Promise((resolve,reject)=>{stub.once('error',reject);stub.listen(0,'127.0.0.1',resolve);});
 const options={key:secrets.tlsKey,cert:secrets.tlsCert,host:'127.0.0.1',apiPort:stub.address().port,cloudflareTunnel:true,publicHostname:'api.ruycaldodecana.com.br'};
 edge=createUserTransport({...options,ngrokCompatibility:true});await edge.listen(0);
 strict=createUserTransport(options);await strict.listen(0);
 const cf={'CF-Connecting-IP':'203.0.113.7','X-Forwarded-Proto':'https','X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1'};
 const legacy={'X-Ruy-Proxy-Client-IP':'203.0.113.8','X-Ruy-Proxy-Proto':'https','X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1'};
 const request=(target,route,headers)=>new Promise((resolve,reject)=>{
  const req=https.request({host:'127.0.0.1',port:target.server.address().port,servername:'ADM-RUY',path:route,ca,rejectUnauthorized:true,minVersion:'TLSv1.2',headers,timeout:3000},res=>{
   const tlsValidated=res.socket.authorized;let body='';res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),tlsValidated}));
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('TIMEOUT')));req.end();
 });
 let r=await request(edge,'/api/local/d1/connection',cf);
 passed('cloudflare-connection',r.status,200);passed('origin-ca-and-name-validated',r.tlsValidated,true);passed('trusted-client-address',r.body.clientAddress,'203.0.113.7');
 passed('legacy-ngrok-preserved',(await request(edge,'/api/local/d1/connection',legacy)).status,200);
 passed('legacy-disabled-by-default',(await request(strict,'/api/local/d1/connection',legacy)).status,403);
 passed('missing-proxy-address-denied',(await request(edge,'/api/local/d1/connection',{'X-Forwarded-Proto':'https'})).status,403);
 passed('non-https-forwarding-denied',(await request(edge,'/api/local/d1/connection',{...cf,'X-Forwarded-Proto':'http'})).status,403);
 passed('browser-origin-denied',(await request(edge,'/api/local/d1/connection',{...cf,Origin:'https://untrusted.example.invalid'})).status,403);
 passed('missing-session-denied',(await request(edge,'/api/local/d1/state',cf)).status,401);
 passed('invalid-session-denied-by-upstream',(await request(edge,'/api/local/d1/state',{...cf,Authorization:'Bearer '+'b'.repeat(64)})).status,401);
 passed('fixture-session-forwarded',(await request(edge,'/api/local/d1/state',{...cf,Authorization:'Bearer '+fixtureSession})).status,200);
 passed('administration-route-denied',(await request(edge,'/admin',{...cf,Authorization:'Bearer '+fixtureSession})).status,404);
 const config=await fs.readFile(path.join(out,'cloudflare-tunnel.yml'),'utf8');
 const ingressPattern=new RegExp(config.match(/path: '([^']+)'/)[1]);
 for(const route of ['/.well-known/sistema-ruy.json','/api/local/d1/session/login','/api/local/d1/connection','/api/local/d1/state'])passed('ingress-allows-'+route,ingressPattern.test(route),true);
 for(const route of ['/admin','/metrics','/api/local/d1/account','/api/local/d1/domain-command','/api/local/d1/operation','/rdp','/ssh'])passed('ingress-denies-'+route,ingressPattern.test(route),false);
 passed('homologation-origin-only',config.includes('service: https://127.0.0.1:18716'),true);
 passed('no-private-real-data-origin',/service:\s*https:\/\/[^\s]*:18726\b/.test(config),false);
 passed('single-origin-route',(config.match(/service: https:/g)||[]).length,1);
 passed('tls-validation-enabled',config.includes('noTLSVerify: false'),true);
 passed('catch-all-deny',config.trimEnd().endsWith('- service: http_status:404'),true);
 const preflight=await json(path.join(out,'origin-check.json'));
 const result={at:new Date().toISOString(),passed:true,checks,syntheticStubOnly:true,originCaValidated:true,liveCentralStarted:false,publicTunnelStarted:false,liveOriginResponding:preflight.originCurrentlyResponding,cloudflaredCliValidated:false,dnsChanged:false,clientEndpointsChanged:false,realDataPublished:false};
 await fs.writeFile(path.join(out,'transport-validation.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}finally{await close(edge?.server);await close(strict?.server);await close(stub);}
