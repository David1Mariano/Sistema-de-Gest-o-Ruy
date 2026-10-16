import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {productionWitness} from './production-witness.mjs';
import {powershell} from '../../server/d1-lab/environment.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório: instalação somente em artifacts/windows-installation-g-0.5.0.');
const root=fileURLToPath(new URL('../../',import.meta.url)),exec=promisify(execFile),pkg=JSON.parse(await fs.readFile(path.join(root,'desktop/package.json'),'utf8'));
const output=path.resolve(root,'desktop',pkg.build.directories.output),target=path.resolve(root,'artifacts','windows-installation-g-0.5.0');
if(path.dirname(target)!==path.resolve(root,'artifacts')||!target.endsWith('windows-installation-g-0.5.0'))throw Error('Destino inesperado recusado.');
try{
 await fs.access(target);
 if(!process.argv.includes('--update-existing'))throw Error('Diretório de instalação já existe; preservado, ensaio recusado.');
 await fs.access(path.join(target,pkg.build.productName+'.exe'));
}catch(e){if(e.code!=='ENOENT')throw e;}
const production=await productionWitness(),installer=path.join(output,'Sistema-Gestao-Ruy-Lab-0.5.0-Setup.exe');
const snapshot=async()=>JSON.parse((await exec(process.execPath,[path.join(root,'scripts/d1-lab/installation-snapshot.mjs')],{windowsHide:true,timeout:30000})).stdout);
const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function run(executable,args,label){
 const log=await fs.open(path.join(root,'logs','etapa-g-'+label+'.log'),'a');
 try{await new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  const timer=setTimeout(()=>{child.kill();reject(Error('Prazo do instalador excedido.'));},120000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('Instalador retornou '+code));});
 });}finally{await log.close();}
}
const before=await snapshot();
await run(installer,['/S','/D='+target],'nsis-install');
const installedAsar=path.join(target,'resources','app.asar');assert.equal(await sha(installedAsar),await sha(path.join(output,'win-unpacked','resources','app.asar')));
assert.deepEqual(await snapshot(),before);
const safe=pkg.build.nsis.shortcutName.replaceAll("'","''");
const shortcuts=JSON.parse(powershell(`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$s=New-Object -ComObject WScript.Shell; $paths=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) '${safe}.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) '${safe}.lnk')); $items=@();foreach($p in $paths){if(!(Test-Path -LiteralPath $p)){throw 'Atalho ausente'};$l=$s.CreateShortcut($p);$items+=@{path=$p;target=$l.TargetPath}};$items|ConvertTo-Json -Compress`));
assert.ok(shortcuts.every(item=>path.resolve(item.target).toLowerCase()===path.join(target,pkg.build.productName+'.exe').toLowerCase()));
console.log('PASS NSIS install: isolated path, ASAR verified, desktop/start-menu shortcuts and data preserved');
await exec(process.execPath,[path.join(root,'scripts/d1-lab/test-g-package.mjs'),'--installed'],{windowsHide:true,timeout:300000,maxBuffer:20000});
const afterUse=await snapshot(),uninstallers=(await fs.readdir(target)).filter(name=>name.startsWith('Uninstall ')&&name.endsWith('.exe'));assert.equal(uninstallers.length,1);
await run(path.join(target,uninstallers[0]),['/S'],'nsis-uninstall');
let removed=false;
for(let i=0;i<80;i++){
 try{await fs.access(installedAsar);}catch(e){if(e.code!=='ENOENT')throw e;removed=true;break;}
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.equal(removed,true);assert.deepEqual(await snapshot(),afterUse);
console.log('PASS NSIS uninstall preserves PostgreSQL, RH history, queue and identity');
await run(installer,['/S','/D='+target],'nsis-reinstall');
assert.equal(await sha(installedAsar),await sha(path.join(output,'win-unpacked','resources','app.asar')));assert.deepEqual(await snapshot(),afterUse);
assert.deepEqual(await productionWitness(),production);
await fs.writeFile(path.join(root,'logs','etapa-g-installation.json'),JSON.stringify({version:pkg.version,target,installer,shortcuts,before,afterUse,reinstalled:await snapshot(),installedAsarHash:await sha(installedAsar),install:true,uninstall:true,reinstall:true,dataPreserved:true,productionPreserved:true,otherWindows:false},null,2));
console.log('G_INSTALLATION_OK: install, owned runtime, uninstall and reinstall on same Windows; production preserved.');
