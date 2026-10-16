import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {productionWitness} from './production-witness.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório: reinicia somente laboratório D1.');
const root=fileURLToPath(new URL('../../',import.meta.url)),exec=promisify(execFile),cli=path.join(root,'scripts/d1-lab.mjs');
const pkg=JSON.parse(await fs.readFile(path.join(root,'desktop/package.json'),'utf8'));
const installed=process.argv.includes('--installed');
const directory=installed?path.join(root,'artifacts','windows-installation-g-0.5.0'):path.resolve(root,'desktop',pkg.build.directories.output,'win-unpacked');
const executable=path.join(directory,pkg.build.productName+'.exe'),production=await productionWitness();
const control=(...args)=>exec(process.execPath,[cli,...args],{windowsHide:true,timeout:30000});
async function runApp(args,env,file){
 const log=await fs.open(file,'a');
 try{
  await new Promise((resolve,reject)=>{
   const child=spawn(executable,args,{cwd:root,env,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
   const timer=setTimeout(()=>{child.kill();reject(Error('Aplicativo não encerrou no prazo do ensaio.'));},120000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});
   child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('Aplicativo experimental falhou: '+code));});
  });
 }finally{await log.close();}
}
await fs.access(executable);await control('stop-api');await control('stop-db');
const results=[];
try{
 for(const kind of ['rh','domain']){
  const file=path.join(root,'logs','etapa-g-'+(installed?'installed-':'packaged-')+kind+'-'+randomUUID()+'.json');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  await runApp(['--lab-smoke','--lab-'+kind+'-smoke','--lab-evidence='+file],env,file+'.process.log');
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(value.version,'0.5.0');assert.equal(value.packaged,true);assert.equal(value.apiOwned,true);assert.equal(value.renderer.nodeExposed,false);
  if(kind==='rh'){assert.equal(value.rh.discountLink,true);assert.equal(value.databaseStartup.started,true);}
  else assert.equal(value.domains.confirmedConsumption,true);
  results.push(value);console.log('PASS '+(installed?'installed':'packaged')+' '+kind+' UI, owned API, local PostgreSQL and renderer sandbox');
 }
 assert.deepEqual(await productionWitness(),production);
 await fs.writeFile(path.join(root,'logs','etapa-g-'+(installed?'installed':'package')+'-evidence.json'),JSON.stringify({version:pkg.version,executable,results,productionPreserved:true,otherWindows:false},null,2));
 console.log('G_PACKAGE_OK');
}finally{await control('start-db').catch(()=>{});await control('start-api');}
