import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
const executable=path.resolve('artifacts/agente5-integracao5r3-20261020/win-unpacked/Sistema Ruy - I5 R3 Homologacao.exe');
const clean={...process.env};for(const key of Object.keys(clean))if(key.startsWith('RUY_'))delete clean[key];delete clean.ELECTRON_RUN_AS_NODE;
const run=args=>new Promise((resolve,reject)=>{const child=spawn(executable,args,{env:clean,stdio:'ignore'});child.once('error',reject);child.once('exit',resolve);});
const noApi=async()=>{await assert.rejects(fetch('http://127.0.0.1:18103/health'));await new Promise((resolve,reject)=>{const socket=net.connect(55443,'127.0.0.1');socket.once('error',()=>resolve());socket.once('connect',()=>{socket.end();reject(Error('OWNED_POSTGRES_STILL_RUNNING'));});});};
assert.equal(await run(['--lab-window-test']),0);await noApi();
const window=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'SistemaGestaoRuy-i5r3-20261020/window-test.json'),'utf8'));
assert.equal(window.initialWindowVisible,true);assert.equal(window.hiddenWindowRecoveredBySecondInstance,true);
for(let n=1;n<=2;n++){
 const evidence=path.resolve('logs/i5r3/packaged-login-'+Date.now()+'.json');
 assert.equal(await run(['--lab-smoke','--lab-evidence='+evidence]),0);
 const result=JSON.parse(await fs.readFile(evidence,'utf8'));assert.equal(result.authenticated,true);assert.equal(result.apiOwned,true);await noApi();
}
assert.equal(await run(['--lab-startup-failure-test']),1);await noApi();
const foreign=http.createServer((_request,response)=>response.end('foreign synthetic fixture'));
await new Promise(resolve=>foreign.listen(18103,'127.0.0.1',resolve));
try{assert.equal(await run(['--lab-smoke']),1);assert.equal(foreign.listening,true);}finally{await new Promise(resolve=>foreign.close(resolve));}
await fs.writeFile('logs/i5r3/runtime.json',JSON.stringify({packagedElectron:true,installed:false,window,syntheticLoginTwice:true,ownApiShutdownAfterEachRun:true,ownPostgresShutdownAfterEachRun:true,startupFailureRefused:true,occupiedPortRefusedAndPreserved:true,forcedTermination:false},null,2));
console.log('I5R3_PACKAGED_RUNTIME_OK');
