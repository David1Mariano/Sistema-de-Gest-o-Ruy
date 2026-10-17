import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
// Foreground lab supervisor. Never installs a service or touches PostgreSQL.
const config=JSON.parse(await fs.readFile(process.env.RUY_LOCAL_CONFIG,'utf8'));
if(config.host!=='127.0.0.1'||config.port!==55432||!/^ruy_local_test_[a-z0-9_]+$/.test(config.database))throw Error('Lab config required');
const home=path.join(process.env.LOCALAPPDATA,'GestaoRuy','dev-core');
const port=Number(process.env.RUY_LOCAL_PORT||18080);
if(![18080,18089,18092].includes(port))throw Error('Only laboratory ports permitted');
const lockPath=path.join(home,`api-supervisor-${port}.lock`);
if(port===18092&&process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Explicit lab opt-in required');
const lock=await fs.open(lockPath,'wx');
await lock.writeFile(JSON.stringify({pid:process.pid,port,startedAt:new Date().toISOString()}));
let child,stopping=false,restarts=0,timer,planned=false;
const log=event=>fs.appendFile(path.join(home,'api-supervisor.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');
async function launch(){
  if(stopping)return;
  const probe=net.createServer();
  try{await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));}
  catch{await log({event:'port_in_use'});return shutdown(1);}
  if(stopping)return;
  child=spawn(process.execPath,[fileURLToPath(new URL('../server/local/start.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  child.stdin.on('error',()=>{});
  await log({event:'started',pid:child.pid});
  child.once('error',()=>{log({event:'spawn_error'});shutdown(1);});
  child.once('close',async(code,signal)=>{
    await log({event:'exit',code,signal});
    child=null;
    if(stopping)return finish();
    if(planned){planned=false;timer=setTimeout(launch,250);return;}
    if(++restarts>5){await log({event:'restart_limit'});return shutdown(1);}
    timer=setTimeout(launch,Math.min(30000,1000*2**restarts));
  });
}
async function finish(){process.stdin.removeAllListeners('data');process.stdin.removeAllListeners('end');process.stdin.pause();await lock.close();await fs.unlink(lockPath);}
async function shutdown(code=0){
  if(stopping)return;
  stopping=true;process.exitCode=code;clearTimeout(timer);
  await log({event:'shutdown_requested'});
  if(child)child.stdin.end('shutdown\n');else await finish();
}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
process.stdin.setEncoding('utf8');
let input='';
process.stdin.on('data',chunk=>{
  input+=chunk;
  if(input.length>128&&!input.includes('\n')){input='';return;}
  let split;
  while((split=input.indexOf('\n'))>=0){
    const command=input.slice(0,split).trim();input=input.slice(split+1);
    if(command==='shutdown')void shutdown();
    if(command==='restart'&&child&&!stopping&&!planned){planned=true;child.stdin.end('shutdown\n');}
  }
});
process.stdin.once('end',()=>void shutdown());
process.stdin.once('error',()=>void shutdown(1));
await launch();
