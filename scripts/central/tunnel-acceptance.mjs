import assert from 'node:assert/strict';
import https from 'node:https';
import {createUserTransport} from '../../server/sync-lab/user-transport.mjs';
export async function testTunnelOrigin({key,cert,ca,apiPort}){
 const gateway=createUserTransport({key,cert,apiPort,cloudflareTunnel:true,publicHostname:'api.ficticio.example.invalid'});
 await gateway.listen(0);
 const request=(route,headers={})=>new Promise((resolve,reject)=>{
  const req=https.request('https://127.0.0.1:'+gateway.server.address().port+route,{ca,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.end();
 });
 try{
  const cloudflare={'X-Forwarded-Proto':'https','CF-Connecting-IP':'203.0.113.7','X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1'};
  assert.equal((await request('/.well-known/sistema-ruy.json')).status,403);
  assert.equal((await request('/.well-known/sistema-ruy.json',{...cloudflare,'X-Forwarded-Proto':'http'})).status,403);
  const discovery=await request('/.well-known/sistema-ruy.json',cloudflare);assert.equal(discovery.status,200);assert.deepEqual(discovery.body,{contract:'RUY-PUBLIC-API/1',apiOrigin:'https://api.ficticio.example.invalid'});
  assert.equal((await request('/api/local/d1/state',cloudflare)).status,401);
  for(const route of ['/admin','/metrics','/5432','/rdp','/ssh'])assert.equal((await request(route,{...cloudflare,Authorization:'Bearer '+'a'.repeat(64)})).status,404);
  return {passed:true,realHttpsOrigin:true,clientCertificates:false,forwardedHttpsRequired:true,publicDiscoveryOnly:true,unauthenticatedDataRefused:true,adminRoutesRefused:true,cloudflareCloudUsed:false};
 }finally{gateway.server.closeIdleConnections();await new Promise(r=>gateway.server.close(r));}
}
