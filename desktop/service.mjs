// Raiz fornecida exclusivamente pelo processo principal, nunca pelo renderer.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = process.env.RUY_DESKTOP_ROOT;
if (!root || !path.isAbsolute(root)) throw Error('Raiz do aplicativo ausente.');
let shutdown,requested=false,flight;
let lease=Date.now();
if(process.env.RUY_D1_INSTALLATION){
 if(!process.parentPort||! /^[a-f0-9]{64}$/.test(process.env.RUY_D1_OWNER_NONCE||''))throw Error('WORKER_OWNER_REQUIRED');
 setInterval(()=>{if(Date.now()-lease>15000){requested=true;stop();}},2000).unref();
 process.parentPort.on('close',()=>{requested=true;stop();});
}
const stop=()=>{if(shutdown&&!flight)flight=shutdown().then(()=>process.exit(0));};
process.parentPort?.on('message',event=>{
 if(event.data?.type==='heartbeat')lease=Date.now();
 if(event.data?.type==='shutdown'){requested=true;stop();}
});
void import(pathToFileURL(path.join(root,'scripts/d1-lab/network-guard.cjs')))
 .then(()=>import(pathToFileURL(path.join(root,'server/d1-lab/start.mjs'))))
 .then(module=>{shutdown=module.shutdown;if(requested)stop();})
 .catch(()=>{console.error('D1_WORKER_START_FAILED');process.exit(1);});
