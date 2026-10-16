import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Foreground lab supervisor. Never installs a service or touches PostgreSQL.
const config=JSON.parse(await fs.readFile(process.env.RUY_LOCAL_CONFIG,'utf8'));
if(config.host!=='127.0.0.1'||config.port!==55432||!/^ruy_local_test_[a-z0-9_]+$/.test(config.database))throw Error('Lab config required');
const home=path.join(process.env.LOCALAPPDATA,'GestaoRuy','dev-core');
const port=Number(process.env.RUY_LOCAL_PORT||18080);
if(![18080,18089].includes(port))throw Error('Only laboratory ports permitted');
const lockPath=path.join(home,`api-supervisor-${port}.lock`);
const lock=await fs.open(lockPath,'wx');
let child,stopping=false,restarts=0,timer;
const log=event=>fs.appendFile(path.join(home,'api-supervisor.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n');
async function launch(){
  if(stopping)return;
  try{
    await fetch(`http://127.0.0.1:${port}/api/local/me`,{signal:AbortSignal.timeout(1000)});
    await log({event:'port_in_use'});return shutdown(1);
  }catch{/* connection unavailable */}
  child=spawn(process.execPath,[fileURLToPath(new URL('../server/local/start.mjs',import.meta.url))],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  await log({event:'started',pid:child.pid});
  child.once('error',()=>{log({event:'spawn_error'});shutdown(1);});
  child.once('exit',async(code,signal)=>{
    await log({event:'exit',code,signal});
    child=null;
    if(stopping)return finish();
    if(++restarts>5){await log({event:'restart_limit'});return shutdown(1);}
    timer=setTimeout(launch,Math.min(30000,1000*2**restarts));
  });
}
async function finish(){process.stdin.pause();await lock.close();await fs.unlink(lockPath);}
async function shutdown(code=0){
  if(stopping)return;
  stopping=true;process.exitCode=code;clearTimeout(timer);
  if(child)child.stdin.end('shutdown\n');else await finish();
}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());
process.stdin.setEncoding('utf8');
let input='';
process.stdin.on('data',chunk=>{
  input+=chunk;
  if(input.includes('\n')){
    const command=input.trim();input='';
    if(command==='shutdown')shutdown();
    if(command==='restart'&&child&&!stopping)child.stdin.end('shutdown\n');
  }
});
await launch();
