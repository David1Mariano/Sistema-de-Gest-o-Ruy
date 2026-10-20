// Actual Electron utility processes, independent new PostgreSQL clusters.
import {app,utilityProcess} from 'electron';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {stopOwnedWorker} from '../../desktop/controlled-exit.mjs';
const root=process.cwd(),workers=new Set();
app.setPath('userData',path.join(process.env.APPDATA,'SistemaGestaoRuy-i5r3-worker-test'));
async function launch(id,port){
 const nonce=randomBytes(32).toString('hex'),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('RUY_'))delete env[key];
 Object.assign(env,{RUY_D1_INSTALLATION:id,RUY_D1_ALLOW_TESTS:'1',RUY_D1_TEST_API_PORT:String(port),RUY_D1_OWNER_NONCE:nonce,RUY_DESKTOP_ROOT:root});
 const worker=utilityProcess.fork(path.join(root,'desktop/service.mjs'),[],{env,stdio:'pipe'});workers.add(worker);
 worker.stderr?.on('data',()=>{});worker.stdout?.on('data',()=>{});
 const heartbeat=setInterval(()=>worker.postMessage({type:'heartbeat'}),1000);
 worker.once('exit',()=>{clearInterval(heartbeat);workers.delete(worker);});
 const url='http://127.0.0.1:'+port+'/health';
 for(let n=0;n<160;n++){
  try{const response=await fetch(url);const value=await response.json();assert.equal(value.installationId,id);assert.equal(value.pid,worker.pid);assert.equal(response.headers.get('x-ruy-owner'),nonce);return {worker,url,stopHeartbeat:()=>clearInterval(heartbeat)};}catch{await new Promise(r=>setTimeout(r,250));}
 }
 throw Error('OWNED_WORKER_START_TIMEOUT');
}
app.whenReady().then(async()=>{
 let passed=false;
 try{
  const a=await launch('i5r3-20261020',18103),b=await launch('i5r3-peer-20261020',18104);
  assert.notEqual(a.worker.pid,b.worker.pid);
  assert.equal(await stopOwnedWorker(a.worker),true);
  assert.equal((await fetch(b.url)).status,200);
  const restarted=await launch('i5r3-20261020',18103);
  assert.notEqual(a.worker.pid,restarted.worker.pid);
  const gone=new Promise(resolve=>restarted.worker.once('exit',resolve));restarted.stopHeartbeat();assert.equal(await gone,0);
  await assert.rejects(fetch(restarted.url));assert.equal((await fetch(b.url)).status,200);
  assert.equal(await stopOwnedWorker(b.worker),true);await assert.rejects(fetch(b.url));
  await fs.writeFile('logs/i5r3/workers.json',JSON.stringify({actualElectronUtilityProcesses:true,actualD1Apis:true,twoIndependentClusters:true,simultaneousDistinctPorts:true,ownedShutdown:true,apiRestart:true,parentLeaseExpiryShutdown:true,peerUnaffected:true,forcedTermination:false},null,2));
  passed=true;
 }finally{for(const worker of workers)await stopOwnedWorker(worker);app.exit(passed?0:1);}
}).catch(()=>app.exit(1));
