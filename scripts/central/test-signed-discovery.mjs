import {test} from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {signedDiscovery,verifyDiscovery,publicApiOrigin} from '../../server/central/public-discovery.mjs';
import {centralEndpoint} from '../../desktop/central-endpoint.mjs';
import {prepareInternet} from './prepare-internet.mjs';
import http from 'node:http';import https from 'node:https';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createUserTransport} from '../../server/sync-lab/user-transport.mjs';
import {validateProfile} from '../../server/central/profile.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519'),key=publicKey.export({type:'spki',format:'der'}).toString('base64'),deploymentId=randomUUID(),now=Date.now();
const doc=(generation=1,apiOrigin='https://api.ficticio.example.invalid')=>signedDiscovery({privateKey,deploymentId,generation,apiOrigin,now});
test('public tunnel configuration preserves isolated database, activation and session-authentication guards',()=>{
 const p={contract:'RUY-CENTRAL/1',mode:'lab',enabled:true,syntheticOnly:true,authentication:'user-session',exposure:'ngrok-tunnel',publicHostname:'ficticio.example.invalid',database:{host:'127.0.0.1',port:55483,database:'ruy_d1_rc_1234567812345678',user:'ruy_central_1234567812345678'},api:{host:'127.0.0.1',port:0},tls:{host:'127.0.0.1',port:0},history:{database:{host:'127.0.0.1',port:55483,database:'ruy_central_history_1234567812345678',user:'ruy_history_1234567812345678_reader'},datasetSha256:'a'.repeat(64),records:0,attachments:0,grants:[]},discovery:{publicKey:key,deploymentId,generation:1,apiOrigin:'https://api.ficticio.example.invalid'}};
 assert.equal(validateProfile(p).exposure,'ngrok-tunnel');
 assert.throws(()=>validateProfile({...p,tls:{...p.tls,host:'0.0.0.0'}}));
 assert.throws(()=>validateProfile({...p,authentication:'device-mtls'}));
 assert.throws(()=>validateProfile({...p,publicHostname:'127.0.0.1'}));
 assert.throws(()=>validateProfile({...p,database:{...p.database,port:5432}}));
 assert.throws(()=>validateProfile({...p,mode:'controlled',database:{...p.database,port:55516,database:'ruy_central_rc1_staging'},api:{host:'127.0.0.1',port:18216},tls:{host:'127.0.0.1',port:18716},activationApproved:false}));
});
test('only an authentic, current deployment document can change the HTTPS origin',()=>{
 assert.equal(verifyDiscovery(doc(),{publicKey:key,deploymentId,now}).endpoint,'https://api.ficticio.example.invalid');
 for(const d of [{...doc(),apiOrigin:'https://attacker.example.invalid'},{...doc(),deploymentId:randomUUID()},{...doc(),signature:'a'.repeat(86)+'=='},{...doc(),extra:'ignored'}])assert.throws(()=>verifyDiscovery(d,{publicKey:key,deploymentId,now}));
 assert.throws(()=>verifyDiscovery(doc(),{publicKey:key,deploymentId,now:now+3600000}));
 assert.throws(()=>verifyDiscovery(doc(),{publicKey:key,deploymentId,now,minimumGeneration:2}));
 assert.throws(()=>verifyDiscovery(doc(),{publicKey:privateKey.export({format:'pem',type:'pkcs8'}),deploymentId,now}));
 for(const origin of ['http://api.example.invalid','https://127.0.0.1','https://192.168.1.102','https://user:password@api.example.invalid','https://api.example.invalid:5432','https://api.example.invalid/path'])assert.throws(()=>publicApiOrigin(origin));
});
test('signed migration works without registry or installer edits; durable state refuses rollback and unsigned metadata',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-signed-endpoint-')),config=path.join(root,'public.json'),state=path.join(root,'state.json');
 let document=doc(),clock=now;const request=async()=>({status:200,body:JSON.stringify(document)});
 try{
  await fs.writeFile(config,JSON.stringify({discoveryUrl:'https://bootstrap-'+randomUUID()+'.example.invalid/.well-known/sistema-ruy.json',discoveryPublicKey:key,deploymentId}));
  let requests=0;const resolve=()=>centralEndpoint({publicConfig:config,policyReader:async()=>{throw Error('Signed deployment must not depend on per-machine configuration');},discoveryStateFile:state,discoveryRequest:async(...args)=>{requests++;return request(...args);},now:clock});
  const concurrent=await Promise.all([resolve(),resolve(),resolve()]);assert.equal(requests,1);assert.ok(concurrent.every(v=>v.endpoint===document.apiOrigin));
  clock+=61000;document=doc(2,'https://dominio-proprio.ficticio.example.invalid');assert.equal((await resolve()).endpoint,document.apiOrigin);
  assert.equal(JSON.parse(await fs.readFile(state)).generation,2);
  clock+=61000;document=doc();await assert.rejects(resolve(),/ROLLBACK/);
  document=doc(2,'https://outro.ficticio.example.invalid');await assert.rejects(resolve(),/GENERATION_CONFLICT/);
  document={contract:'RUY-PUBLIC-API/1',apiOrigin:'https://attacker.example.invalid'};await assert.rejects(resolve(),/SIGNED/);
  document=doc(3);await fs.writeFile(state,'bad state');await assert.rejects(resolve());
  const previousLab=process.env.RUY_SHARED_LAB;process.env.RUY_SHARED_LAB='1';
  try{
   await fs.writeFile(path.join(root,'synthetic-endpoint.json'),JSON.stringify({purpose:'RUY_SYNTHETIC_PUBLIC_DISCOVERY/1'}));
   await fs.copyFile(config,path.join(root,'public-endpoint.json'));
   assert.equal((await centralEndpoint({testRoot:root,discoveryRequest:request,now})).endpoint,document.apiOrigin);
   await fs.writeFile(path.join(root,'synthetic-endpoint.json'),JSON.stringify({purpose:'RUY_SYNTHETIC_PUBLIC_DISCOVERY/1',ca:'untrusted'}));
   await assert.rejects(centralEndpoint({testRoot:root,discoveryRequest:request,now}),/FIXTURE_METADATA_REFUSED/);
  }finally{if(previousLab===undefined)delete process.env.RUY_SHARED_LAB;else process.env.RUY_SHARED_LAB=previousLab;}
 }finally{for(const f of await fs.readdir(root))await fs.unlink(path.join(root,f));await fs.rmdir(root);}
});
test('ngrok preparation routes only HTTPS API, replaces spoofable proxy headers and exports no private key',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-ngrok-offline-')),directory=path.join(root,'config');
 try{
  const result=await prepareInternet({provider:'ngrok',hostname:'ficticio.example.invalid',directory,publicKey:key,deploymentId});assert.equal(result.activated,false);
  const launch=JSON.parse(await fs.readFile(path.join(directory,'ngrok-launch.disabled.json')));assert.equal(launch.enabled,false);assert.ok(launch.arguments.includes('--upstream-tls-verify'));assert.ok(launch.arguments.includes('--upstream-tls-verify-cas'));assert.ok(launch.arguments.includes('--inspect=false'));assert.equal(launch.secretEnvironmentVariable,'NGROK_AUTHTOKEN');assert.equal(launch.postgresForwarded,false);
  const policy=JSON.parse(await fs.readFile(path.join(directory,'ngrok-policy.json')));assert.equal(policy.on_http_request[1].actions[0].type,'remove-headers');assert.equal(policy.on_http_request[1].actions[1].config.headers['x-ruy-proxy-client-ip'],'${conn.client_ip}');
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'central-endpoint.json')));assert.equal(metadata.discoveryPublicKey,key);assert.equal(metadata.deploymentId,deploymentId);
  for(const f of await fs.readdir(directory))assert.doesNotMatch(await fs.readFile(path.join(directory,f),'utf8'),/BEGIN PRIVATE KEY|scrypt-v2|authtoken:\s*\S+/);
 }finally{for(const f of await fs.readdir(directory).catch(()=>[]))await fs.unlink(path.join(directory,f));await fs.rmdir(directory).catch(()=>{});await fs.rmdir(root);}
});
test('ngrok adapter verifies real TLS, rejects forged or plaintext proxy metadata and keeps all data behind login',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-ngrok-tls-')),keyFile=path.join(root,'ficticio.key'),certFile=path.join(root,'ficticio.pem');
 const upstream=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({available:true,address:req.headers['x-ruy-client-address']}));});let transport;
 try{
  const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  await promisify(execFile)(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=FICTICIO offline automatic test','-addext','subjectAltName=IP:127.0.0.1'],{windowsHide:true});
  const cert=await fs.readFile(certFile,'utf8');await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  transport=createUserTransport({key:await fs.readFile(keyFile,'utf8'),cert,apiPort:upstream.address().port,ngrokTunnel:true,publicHostname:'ficticio.example.invalid',serviceDiscovery:()=>doc()});await transport.listen(0);
  const call=(route,headers={},trusted=true)=>new Promise((resolve,reject)=>{const req=https.request({hostname:'127.0.0.1',port:transport.server.address().port,path:route,...(trusted?{ca:cert}:{}),headers,timeout:5000},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));res.on('error',reject);});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('timeout')));req.end();});
  const proxy={'X-Ruy-Proxy-Proto':'https','X-Ruy-Proxy-Client-IP':'203.0.113.9','X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1'};
  assert.equal((await call('/api/local/d1/connection')).status,403);
  assert.equal((await call('/api/local/d1/connection',{...proxy,'X-Ruy-Proxy-Proto':'http'})).status,403);
  assert.equal((await call('/api/local/d1/connection',{...proxy,'X-Ruy-Proxy-Client-IP':'203.0.113.9, 127.0.0.1'})).status,403);
  assert.equal((await call('/api/local/d1/connection',proxy)).body.address,'203.0.113.9');
  assert.equal((await call('/api/local/d1/state',proxy)).status,401);
  assert.equal((await call('/admin',{...proxy,Authorization:'Bearer '+'a'.repeat(64)})).status,404);
  const discovery=await call('/.well-known/sistema-ruy.json',proxy);assert.equal(discovery.status,200);assert.equal(verifyDiscovery(discovery.body,{publicKey:key,deploymentId,now}).endpoint,'https://api.ficticio.example.invalid');
  await assert.rejects(call('/api/local/d1/connection',proxy,false));
 }finally{transport?.server.closeIdleConnections();if(transport?.server.listening)await new Promise(resolve=>transport.server.close(resolve));upstream.closeIdleConnections();if(upstream.listening)await new Promise(resolve=>upstream.close(resolve));for(const f of await fs.readdir(root))await fs.unlink(path.join(root,f));await fs.rmdir(root);}
});
