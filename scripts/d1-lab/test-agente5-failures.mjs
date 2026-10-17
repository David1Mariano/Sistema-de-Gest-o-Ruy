import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Explicit lab opt-in required');
const home=path.join(process.env.LOCALAPPDATA,'GestaoRuy/dev-core'),port=18092,lock=path.join(home,'api-supervisor-18092.lock'),temporary=path.join(home,'agente5-failure-'+randomUUID()+'.json');
const original=JSON.parse(await fs.readFile(path.join(home,'db-config.json'),'utf8'));
const bad={...original,database:'ruy_local_test_absent_'+randomUUID().replaceAll('-','')};
await fs.writeFile(temporary,JSON.stringify(bad),{flag:'wx'});
const launch=()=>{const child=spawn(process.execPath,['lab/c2-runtime/scripts/local-api-supervisor.mjs'],{windowsHide:true,stdio:['pipe','ignore','ignore'],env:{...process.env,RUY_LOCAL_PORT:String(port),RUY_LOCAL_CONFIG:temporary}});child.done=new Promise(resolve=>child.once('exit',resolve));return child;};
let child;
try{
 child=launch();await wait(1200);await fs.writeFile(temporary,JSON.stringify(original));
 let ok=false;for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:18092/api/local/health',{signal:AbortSignal.timeout(500)})).status===200){ok=true;break;}}catch{/* retry */}await wait(100);}assert.equal(ok,true);
 child.stdin.end('shutdown\n');assert.equal(await child.done,0);console.log('PASS unavailable synthetic database followed by config repair recovers automatically');
 await fs.writeFile(lock,JSON.stringify({pid:0,reason:'FICTICIO orphan lock'}),{flag:'wx'});const stale=await fs.readFile(lock,'utf8');assert.equal(await launch().done,1);assert.equal(await fs.readFile(lock,'utf8'),stale);await fs.unlink(lock);console.log('PASS stale lock is preserved and blocks duplicate launch');
 await fs.writeFile(temporary,JSON.stringify(bad));child=launch();assert.equal(await child.done,1);await assert.rejects(fs.access(lock));console.log('PASS persistent startup failure reaches bounded retry limit and releases owned lock');
 await fs.writeFile('logs/agente5-failures-20261017.json',JSON.stringify({checks:3,databaseFailureRecovered:true,retryLimitVerified:true,staleLockPreserved:true,forcedTermination:false}));
}finally{if(child?.exitCode===null)child.stdin.end('shutdown\n');await fs.unlink(temporary);}
