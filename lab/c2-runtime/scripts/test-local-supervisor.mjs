import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||!process.env.RUY_LOCAL_CONFIG)throw Error('Explicit synthetic laboratory config required.');
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(18089,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
import {setTimeout as wait} from 'node:timers/promises';
const child=spawn(process.execPath,[fileURLToPath(new URL('./local-api-supervisor.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,RUY_LOCAL_PORT:'18089',RUY_LOCAL_CONFIG:process.env.RUY_LOCAL_CONFIG}});
const output=[];child.stderr.on('data',data=>output.push(String(data)));
const exited=new Promise(resolve=>child.on('exit',resolve));
async function healthy(){for(let n=0;n<50;n++){try{const r=await fetch('http://127.0.0.1:18089/api/local/health',{signal:AbortSignal.timeout(1000)});if(r.status===200){assert.deepEqual(await r.json(),{status:'ok'});return;}}catch{/* starting */}await wait(200);}throw Error('Health timeout');}
try{
  await healthy();child.stdin.write('restart\n');
  await wait(3000);await healthy();
  console.log('PASS real supervisor startup, controlled API restart, PostgreSQL health');
}finally{child.stdin.end('shutdown\n');assert.equal(await exited,0,output.join(''));}
console.log('PASS controlled supervisor shutdown');
