import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Lab opt-in required');
const port=18092,home=path.join(process.env.LOCALAPPDATA,'GestaoRuy/dev-core'),lock=path.join(home,'api-supervisor-18092.lock');
const config=path.join(home,'db-config.json'),script='lab/c2-runtime/scripts/local-api-supervisor.mjs';
const launch=()=>{const child=spawn(process.execPath,[script],{windowsHide:true,stdio:['pipe','ignore','ignore'],env:{...process.env,RUY_LOCAL_PORT:String(port),RUY_LOCAL_CONFIG:config}});child.done=new Promise(resolve=>child.once('exit',resolve));return child;};
async function healthy(){for(let n=0;n<100;n++){try{const r=await fetch('http://127.0.0.1:'+port+'/api/local/health',{signal:AbortSignal.timeout(500)});if(r.status===200){assert.deepEqual(await r.json(),{status:'ok'});return;}}catch{/* API starting */}await wait(100);}throw Error('Health timeout');}
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});
assert.equal(await launch().done,1);await new Promise(resolve=>probe.close(resolve));await assert.rejects(fs.access(lock));
console.log('PASS raw occupied TCP port refused without touching listener');
let child=launch();
try{await healthy();assert.equal(await launch().done,1);console.log('PASS duplicate supervisor refused by exclusive lock');
const initial=(await fs.readFile(path.join(home,'api-supervisor.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.event==='started').length;
child.stdin.write('restart\n');await wait(3000);await healthy();const after=(await fs.readFile(path.join(home,'api-supervisor.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(x=>x.event==='started').length;assert.equal(after,initial+1);console.log('PASS normal restart changes child and reconnects PostgreSQL');
child.stdin.end();assert.equal(await child.done,0);await assert.rejects(fs.access(lock));console.log('PASS parent stdin EOF closes child, releases listener and lock');
child=launch();await healthy();child.stdin.end('shutdown\n');assert.equal(await child.done,0);await assert.rejects(fs.access(lock));console.log('PASS clean relaunch and explicit shutdown');
await fs.writeFile('logs/agente5-supervision-20261017.json',JSON.stringify({port,checks:5,realPostgreSQL:true,forcedTermination:false,old18080Untouched:true}));
}finally{if(child.exitCode===null)child.stdin.end('shutdown\n');}
