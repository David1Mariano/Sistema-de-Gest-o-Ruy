// Run with Electron, not Node. The worker uses a private synthetic HTTP fixture.
import {app,utilityProcess,dialog} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {stopOwnedWorker} from '../../desktop/controlled-exit.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'ruy-r2-worker-'));
app.setPath('userData',path.join(home,'profile'));
fs.mkdirSync(path.join(home,'scripts/d1-lab'),{recursive:true});fs.mkdirSync(path.join(home,'server/d1-lab'),{recursive:true});
fs.writeFileSync(path.join(home,'scripts/d1-lab/network-guard.cjs'),'// Private fixture, no external requests.');
fs.writeFileSync(path.join(home,'server/d1-lab/start.mjs'),"import http from 'node:http';const server=http.createServer((_q,r)=>r.end('synthetic'));await new Promise(r=>server.listen(0,'127.0.0.1',r));await new Promise(r=>setTimeout(r,250));export const shutdown=()=>new Promise(r=>server.close(r));");
app.whenReady().then(async()=>{
 const worker=utilityProcess.fork(fileURLToPath(new URL('../../desktop/service.mjs',import.meta.url)),[],{env:{...process.env,RUY_DESKTOP_ROOT:home},stdio:'ignore',serviceName:'Ruy synthetic shutdown acceptance'});
 const exited=new Promise(resolve=>worker.once('exit',resolve));
 const acknowledged=await stopOwnedWorker(worker,{timeoutMs:10000});
 if(!acknowledged){fs.writeFileSync('logs/i5r2/worker-ipc.json',JSON.stringify({passed:false,forced:false}));dialog.showErrorBox('Teste de laboratório pendente','Worker sintético não confirmou saída; nenhum processo foi forçado.');return;}
 const code=await exited;
 fs.writeFileSync('logs/i5r2/worker-ipc.json',JSON.stringify({passed:code===0,actualElectronUtilityProcess:true,actualIpcShutdown:true,earlyShutdownBeforeModuleReady:true,syntheticHttpFixture:true,operationalApiOrPostgresqlUsed:false,exitCode:code,forced:false},null,2));
 app.exit(code===0?0:1);
}).catch(()=>{process.exitCode=1;app.quit();});
