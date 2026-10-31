import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareInternet} from './prepare-internet.mjs';
test('offline preparation excludes private credentials and routes only API/discovery to verified HTTPS',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-tunnel-fixture-')),directory=path.join(parent,'config');
 try{
  const result=await prepareInternet({hostname:'api.ficticio.example.invalid',directory});assert.equal(result.activated,false);assert.equal(result.credentialsIncluded,false);
  const tunnel=await fs.readFile(path.join(directory,'cloudflare-tunnel.yml'),'utf8');
  assert.match(tunnel,/service: https:\/\/127\.0\.0\.1:18716/);assert.match(tunnel,/noTLSVerify: false/);assert.match(tunnel,/originServerName:/);assert.match(tunnel,/caPool:/);assert.match(tunnel,/service: http_status:404/);assert.doesNotMatch(tunnel,/service: (tcp|rdp|ssh|http):/);
  const metadata=JSON.parse(await fs.readFile(path.join(directory,'central-endpoint.json'),'utf8'));assert.equal(metadata.discoveryUrl,'https://api.ficticio.example.invalid/.well-known/sistema-ruy.json');
  const files=await fs.readdir(directory);assert.deepEqual(files.sort(),['central-endpoint.json','cloudflare-tunnel.yml','public-discovery.json']);
 }finally{for(const name of await fs.readdir(directory).catch(()=>[]))await fs.unlink(path.join(directory,name));await fs.rmdir(directory).catch(()=>{});await fs.rmdir(parent);}
});
test('IP literals and missing domain are refused without touching network configuration',async()=>{
 for(const hostname of [null,'127.0.0.1','192.168.1.102','localhost','bad/path.example'])await assert.rejects(prepareInternet({hostname,directory:'must-not-be-created'}));
});
