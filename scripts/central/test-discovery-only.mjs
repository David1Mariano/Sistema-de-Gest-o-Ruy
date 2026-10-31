import fs from 'node:fs/promises';import path from 'node:path';import https from 'node:https';import assert from 'node:assert/strict';import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createDiscoveryOnlyTransport} from '../../server/central/discovery-only-transport.mjs';import {signedDiscovery} from '../../server/central/public-discovery.mjs';import {openDpapi,dataRoot} from '../homologacao/common.mjs';
const profile=path.join(dataRoot,'central-lab-79402bbf27e83425'),s=await openDpapi(path.join(profile,'secrets.dpapi')),ca=await fs.readFile(path.join(profile,'test-ca.pem'));
const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64'),deploymentId=randomUUID();
let doc=signedDiscovery({deploymentId,generation:2,apiOrigin:'https://api.ruycaldodecana.com.br',privateKey:keys.privateKey});
const edge=createDiscoveryOnlyTransport({key:s.tlsKey,cert:s.tlsCert,document:()=>doc,publicKey,deploymentId,minimumGeneration:2});await edge.listen(0);
const checks=[];
try{
 const request=(route,method='GET',proxy=true)=>new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:edge.server.address().port,servername:'ADM-RUY',ca,rejectUnauthorized:true,method,path:route,headers:proxy?{'X-Ruy-Proxy-Proto':'https','X-Ruy-Proxy-Client-IP':'203.0.113.9'}:{}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
 for(const [route,method,expected] of [['/.well-known/sistema-ruy.json','GET',200],['/api/local/d1/state','GET',410],['/api/local/d1/session/login','POST',410],['/api/local/d1/attachments/123','GET',410],['/admin','GET',410]]){assert.equal(await request(route,method),expected);checks.push({route,method,status:expected});}
 assert.equal(await request('/.well-known/sistema-ruy.json','GET',false),403);checks.push('untrusted-proxy-refused');
 doc={...doc,signature:'a'.repeat(86)+'=='};assert.equal(await request('/.well-known/sistema-ruy.json'),503);checks.push('forged-signature-refused');
 doc=signedDiscovery({deploymentId,generation:1,apiOrigin:'https://api.ruycaldodecana.com.br',privateKey:keys.privateKey});assert.equal(await request('/.well-known/sistema-ruy.json'),503);checks.push('generation-rollback-refused');
 console.log(JSON.stringify({passed:true,checks,syntheticSigningKeyOnly:true,loopbackOnly:true,realDataRead:false,clientEndpointsChanged:false}));
}finally{edge.server.closeAllConnections();await new Promise(resolve=>edge.server.close(resolve));}
