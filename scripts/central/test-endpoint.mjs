import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {centralEndpoint,validateEndpoint} from '../../desktop/central-endpoint.mjs';
test('reject plaintext, embedded credentials, paths, query strings and fragments',()=>{
 for(const value of ['http://api.example.invalid','https://user:pass@api.example.invalid','https://api.example.invalid/path','https://api.example.invalid/?token=x','https://api.example.invalid/#x'])assert.throws(()=>validateEndpoint(value));
 assert.equal(validateEndpoint('https://api.example.invalid/'),'https://api.example.invalid');
});
test('machine policy overrides packaged metadata, without per-user files',async()=>{
 assert.deepEqual(await centralEndpoint({policyReader:async()=> 'https://policy.example.invalid/',publicConfig:'does-not-exist'}),{endpoint:'https://policy.example.invalid'});
});
test('public HTTPS discovery is bound to its known origin and rejects redirects/error/data from another host',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-public-metadata-')),file=path.join(dir,'metadata.json');
 try{
  const write=host=>fs.writeFile(file,JSON.stringify({discoveryUrl:'https://'+host+'/.well-known/sistema-ruy.json'}));
  await write('bad.example.invalid');
  await assert.rejects(centralEndpoint({publicConfig:file,policyReader:async()=>null,discoveryRequest:async()=>({status:200,body:JSON.stringify({contract:'RUY-PUBLIC-API/1',apiOrigin:'https://attacker.example.invalid/'})})}));
  await write('redirect.example.invalid');
  await assert.rejects(centralEndpoint({publicConfig:file,policyReader:async()=>null,discoveryRequest:async()=>({status:302,body:''})}));
  await write('api.example.invalid');
  assert.deepEqual(await centralEndpoint({publicConfig:file,policyReader:async()=>null,discoveryRequest:async()=>({status:200,body:JSON.stringify({contract:'RUY-PUBLIC-API/1',apiOrigin:'https://api.example.invalid/'})})}),{endpoint:'https://api.example.invalid'});
 }finally{await fs.unlink(file);await fs.rmdir(dir);}
});
test('missing official domain fails closed with a connection message',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-empty-endpoint-')),file=path.join(dir,'metadata.json');
 try{await fs.writeFile(file,JSON.stringify({endpoint:null}));await assert.rejects(centralEndpoint({policyReader:async()=>null,publicConfig:file}),e=>e.code==='CENTRAL_ADDRESS_PENDING');}finally{await fs.unlink(file);await fs.rmdir(dir);}
});
test('legacy LAN metadata remains compatible; public policy can override older clients',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-legacy-lan-')),file=path.join(dir,'metadata.json');
 try{
  await fs.writeFile(file,JSON.stringify({endpoint:'https://ADM-RUY:18716/'}));
  assert.deepEqual(await centralEndpoint({publicConfig:file,policyReader:async()=>null}),{endpoint:'https://adm-ruy:18716'});
  assert.deepEqual(await centralEndpoint({publicConfig:file,policyReader:async()=> 'https://api.ruycaldodecana.com.br'}),{endpoint:'https://api.ruycaldodecana.com.br'});
 }finally{await fs.unlink(file);await fs.rmdir(dir);}
});
