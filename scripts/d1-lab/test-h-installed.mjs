import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {powershell,config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
import {productionWitness} from './production-witness.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório para ensaio H de laboratório.');
const root=fileURLToPath(new URL('../../',import.meta.url)),exec=promisify(execFile),target=path.resolve(root,'artifacts/windows-installation-h-0.5.0');
const output=path.join(root,'artifacts/windows-lab-0.5.0-h1'),installer=path.join(output,'Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.exe');
if(path.dirname(target)!==path.resolve(root,'artifacts'))throw Error('Destino inválido.');
try{await fs.access(target);if(!process.argv.includes('--update-existing'))throw Error('Instalação H existente preservada. Use --update-existing somente para esta pasta.');await fs.access(path.join(target,'Sistema de Gestão Ruy Lab H.exe'));}catch(e){if(e.code!=='ENOENT')throw e;}
const snapshot=async()=>JSON.parse((await exec(process.execPath,[path.join(root,'scripts/d1-lab/installation-snapshot.mjs')],{windowsHide:true,timeout:30000})).stdout);
const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function run(executable,args,label){
 const log=await fs.open(path.join(root,'logs',label+'.log'),'a');
 try{await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore',log.fd,log.fd]});const timer=setTimeout(()=>{child.kill();reject(Error('Prazo excedido: '+label));},120000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error(label+' exit '+code));});
 });}finally{await log.close();}
}
const production=await productionWitness(),before=await snapshot(),original=await sha(path.join(root,'artifacts/windows-lab-0.5.0/Sistema-Gestao-Ruy-Lab-0.5.0-Setup.exe'));
assert.equal(original,'8e5d24d7b7319fad0705141fd9d40c0201c427fc04d70f72ea2d401979e32e2d');
await run(installer,['/S','/D='+target],'etapa-h-install');
const installedAsar=path.join(target,'resources/app.asar');assert.equal(await sha(installedAsar),await sha(path.join(output,'win-unpacked/resources/app.asar')));assert.deepEqual(await snapshot(),before);
const shortcut=JSON.parse(powershell("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Sistema de Gestão Ruy — Homologação H.lnk';$s=New-Object -ComObject WScript.Shell;$l=$s.CreateShortcut($p);@{path=$p;target=$l.TargetPath}|ConvertTo-Json -Compress"));
assert.equal(path.resolve(shortcut.target).toLowerCase(),path.join(target,'Sistema de Gestão Ruy Lab H.exe').toLowerCase());
const control=(...args)=>exec(process.execPath,[path.join(root,'scripts/d1-lab.mjs'),...args],{windowsHide:true,timeout:30000});
await control('stop-api');await control('stop-db');
const file=path.join(root,'logs','etapa-h-autonomy-'+randomUUID()+'.json');let autonomy;
try{
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 powershell(`Start-Process -FilePath ${quote(shortcut.path)} -ArgumentList @('--lab-smoke','--lab-rh-smoke','--lab-autonomy-smoke',${quote('--lab-evidence='+file)}) -WindowStyle Hidden`);
 for(let attempt=0;attempt<300;attempt++){
  try{const failed=JSON.parse(await fs.readFile(file+'.failure.json','utf8'));throw Error('Ensaio H interrompido na etapa '+failed.stage);}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  try{autonomy=JSON.parse(await fs.readFile(file,'utf8'));break;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.ok(autonomy,'Atalho não concluiu o ensaio H; não foi declarado aprovado.');
 assert.equal(autonomy.revision,'H1');assert.equal(autonomy.apiOwned,true);assert.equal(autonomy.databaseStartup.started,true);
 assert.ok(autonomy.rh,'Formulários oficiais RH não foram exercitados.');
 assert.equal(autonomy.autonomy.apiCrashRecovered,true);assert.equal(autonomy.autonomy.postgresImmediateStopRecovered,true);assert.equal(autonomy.autonomy.offlinePasswordRelogin,true);
 assert.equal(autonomy.autonomy.queueBefore,autonomy.autonomy.queueAfter);
 const pool=poolFor(await config());try{assert.equal((await pool.query('SELECT data FROM d1_records WHERE id=$1',[autonomy.autonomy.id])).rows[0].data.name,'FICTICIO Autonomia H editado');}finally{await pool.end();}
 console.log('PASS H: desktop shortcut, owned PostgreSQL/API, offline re-login, crash recovery and durable queue');
 // O teste terminou por app.quit; aguardar liberação da API antes de retomar o CLI.
 await new Promise(resolve=>setTimeout(resolve,1000));
}finally{await control('start-api');}
const afterUse=await snapshot(),uninstaller=(await fs.readdir(target)).find(name=>name.startsWith('Uninstall ')&&name.endsWith('.exe'));assert.ok(uninstaller);
await run(path.join(target,uninstaller),['/S'],'etapa-h-uninstall');
// NSIS relaunches its uninstaller from TEMP; the initial process can exit first.
for(let attempt=0;attempt<480;attempt++){try{await fs.access(installedAsar);}catch(e){if(e.code==='ENOENT')break;throw e;}await new Promise(resolve=>setTimeout(resolve,250));}
await assert.rejects(fs.access(installedAsar),e=>e.code==='ENOENT');assert.deepEqual(await snapshot(),afterUse);
await run(installer,['/S','/D='+target],'etapa-h-reinstall');assert.deepEqual(await snapshot(),afterUse);assert.equal(await sha(installedAsar),await sha(path.join(output,'win-unpacked/resources/app.asar')));
assert.deepEqual(await productionWitness(),production);
await fs.writeFile('logs/etapa-h-installation.json',JSON.stringify({version:'0.5.0',revision:'H1',target,shortcut,autonomy,before,afterUse,reinstalled:await snapshot(),installedAsarHash:await sha(installedAsar),originalInstallerUnchanged:await sha(path.join(root,'artifacts/windows-lab-0.5.0/Sistema-Gestao-Ruy-Lab-0.5.0-Setup.exe'))===original,productionPreserved:true,otherWindows:false,windowsReboot:false,install:true,uninstall:true,reinstall:true},null,2));
console.log('H_INSTALLATION_OK');
