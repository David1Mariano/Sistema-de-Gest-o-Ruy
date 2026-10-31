import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadProfile} from '../../server/central/profile.mjs';
const directory=path.resolve(process.argv[2]||'');
await loadProfile(directory); // Fail before locking or launching anything.
const lock=path.join(directory,'supervisor.lock'),log=path.join(directory,'central.log');
try{const old=JSON.parse(fs.readFileSync(lock));let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw Error('CENTRAL_ALREADY_SUPERVISED');fs.unlinkSync(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,profile:directory}),{flag:'wx'});
let child,stopping=false,restarts=0,watchdog,lastHealth=Date.now(),timer,shutdownExit=0;
function record(event,extra={}){if(fs.existsSync(log)&&fs.statSync(log).size>1024*1024){for(let i=2;i>=1;i--)if(fs.existsSync(log+'.'+i))fs.renameSync(log+'.'+i,log+'.'+(i+1));fs.renameSync(log,log+'.1');}fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),event,...extra})+'\n');}
function finish(code){clearInterval(watchdog);clearTimeout(timer);if(fs.existsSync(lock)&&JSON.parse(fs.readFileSync(lock)).pid===process.pid)fs.unlinkSync(lock);record('supervisor_stopped',{code});process.exit(code);}
function stop(){if(stopping)return;stopping=true;clearTimeout(timer);record('shutdown_requested');if(child?.connected){child.send({type:'shutdown'});timer=setTimeout(()=>{record('shutdown_timeout_manual_intervention');process.exitCode=3;},30000);}else finish(0);}
function launch(){
 if(stopping)return;const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('RUY_D1_')||k.startsWith('RUY_SHARED_')||k.startsWith('PG')||k==='NODE_OPTIONS')delete env[k];
 child=fork(fileURLToPath(new URL('../../server/central/worker.mjs',import.meta.url)),[directory],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});lastHealth=Date.now();record('worker_started',{pid:child.pid,restarts});
 child.on('message',m=>{if(m?.type==='ready'){lastHealth=Date.now();record('ready',{pid:child.pid,apiPort:m.apiPort,tlsPort:m.tlsPort});process.send?.({...m,pid:child.pid});}else if(m?.type==='health'){if(m.ok)lastHealth=Date.now();else record('health_unavailable');}else if(m?.type==='failed')record('bootstrap_refused');});
 child.on('error',()=>record('worker_spawn_failed'));
 child.once('exit',code=>{record('worker_exited',{code});if(stopping)return finish(shutdownExit||(code===0?0:2));if(++restarts>3)return finish(2);timer=setTimeout(launch,Math.min(8000,500*2**(restarts-1)));});
}
process.stdin.setEncoding('utf8');let input='';process.stdin.on('data',v=>{input+=v;if(input.includes('\n')){for(const line of input.split('\n').slice(0,-1))if(line.trim()==='shutdown')stop();input=input.slice(input.lastIndexOf('\n')+1);}if(input.length>1000)input='';});process.stdin.on('end',stop);
process.on('message',m=>{if(m?.type==='shutdown')stop();});process.on('disconnect',stop);process.on('SIGINT',stop);process.on('SIGTERM',stop);
watchdog=setInterval(()=>{if(!stopping&&Date.now()-lastHealth>20000){record('health_timeout_draining');shutdownExit=2;stop();}},2000);
record('supervisor_started');launch();
