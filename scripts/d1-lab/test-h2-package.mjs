import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {wrapRecoveryKey} from '../../server/d1-lab/key-envelope.mjs';
const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const kit=JSON.parse(await fs.readFile(path.join(root,'logs/etapa-h2/package.json'),'utf8'));
const folder=path.join(root,'logs/etapa-h2','package-test-'+randomUUID());await fs.mkdir(folder);
const ps=(file,args=[])=>exec('powershell.exe',['-NoProfile','-NonInteractive','-File',file,...args],{windowsHide:true,timeout:45000,maxBuffer:100000});
const verify=path.join(kit.directory,'Verify-Package.ps1');
const checks=[];
async function check(name,job){await job();checks.push(name);console.log('PASS '+name);}
await check('Complete H1 kit verifies without repository dependencies',async()=>{assert.match((await ps(verify)).stdout,/H2_PACKAGE_INTEGRITY_OK/);});
await check('ZIP extracts and verifies without private data',async()=>{
 const destination=path.join(folder,'extracted'),quote=value=>"'"+value.replaceAll("'","''")+"'";
 await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(kit.zip)} -DestinationPath ${quote(destination)}`],{windowsHide:true,timeout:45000});
 const extracted=path.join(destination,path.basename(kit.directory));
 assert.match((await ps(path.join(extracted,'Verify-Package.ps1'))).stdout,/H2_PACKAGE_INTEGRITY_OK/);
 const files=await fs.readdir(extracted);assert.equal(files.length,7);assert.equal(files.some(name=>/\.env|\.dpapi|\.ruykey|\.ruybak|cluster/i.test(name)),false);
});
const copy=path.join(folder,'copy');await fs.mkdir(copy);
for(const name of await fs.readdir(kit.directory))await fs.copyFile(path.join(kit.directory,name),path.join(copy,name));
await check('Changed guide is rejected',async()=>{await fs.appendFile(path.join(copy,'LEIA-ME-H2.md'),'FICTICIO changed');await assert.rejects(ps(path.join(copy,'Verify-Package.ps1')));});
await fs.copyFile(path.join(kit.directory,'LEIA-ME-H2.md'),path.join(copy,'LEIA-ME-H2.md'));
await check('Manifest traversal is rejected',async()=>{
 const manifest=JSON.parse(await fs.readFile(path.join(copy,'package-manifest.json')));manifest.files[0].name='../outside.exe';await fs.writeFile(path.join(copy,'package-manifest.json'),JSON.stringify(manifest));await assert.rejects(ps(path.join(copy,'Verify-Package.ps1')));
});
const local=path.join(folder,'local.ruybak'),external=path.join(folder,'external.ruybak'),keyFile=path.join(folder,'FICTICIO.ruykey');
await fs.writeFile(local,Buffer.concat([Buffer.from('RUYBAK01'),randomBytes(128)]));await fs.copyFile(local,external);
const key=randomBytes(32);try{await fs.writeFile(keyFile,await wrapRecoveryKey(key,randomUUID(),randomBytes(32).toString('hex')));}finally{key.fill(0);}
const copyScript=path.join(kit.directory,'Test-BackupCopy.ps1'),args=['-LocalBackup',local,'-ExternalBackup',external,'-RecoveryKey',keyFile];
await check('Matching copy is reported only as hash verification',async()=>{const result=JSON.parse((await ps(copyScript,args)).stdout);assert.equal(result.copyHashVerified,true);assert.equal(result.externalProtected,false);assert.equal(result.authenticatedDecryption,'pending-application-restore');});
await check('Different backup bytes are rejected',async()=>{await fs.appendFile(external,'FICTICIO corruption');await assert.rejects(ps(copyScript,args));await fs.copyFile(local,external);});
await check('Same file is not accepted as a separate copy',async()=>{await assert.rejects(ps(copyScript,['-LocalBackup',local,'-ExternalBackup',local,'-RecoveryKey',keyFile]));});
await check('Invalid key envelope is rejected',async()=>{const saved=await fs.readFile(keyFile);await fs.writeFile(keyFile,'{}');await assert.rejects(ps(copyScript,args));await fs.writeFile(keyFile,saved);});
await check('Collector records loopback API guards and refuses physical protection claims',async()=>{
 await ps(path.join(kit.directory,'Collect-H2.ps1'),['-Stage','Laboratorio','-ExternalDirectory',folder,'-EvidenceDirectory',folder]);
 const name=(await fs.readdir(folder)).find(name=>name.startsWith('Laboratorio-')&&name.endsWith('.json'));
 const result=JSON.parse((await fs.readFile(path.join(folder,name),'utf8')).replace(/^\uFEFF/,''));
 assert.equal(result.api.health.service,'ruy-d1-lab');assert.equal(result.api.health.syncEnabled,false);
 assert.equal(result.api.anonymousDenied,true);assert.equal(result.api.foreignOriginDenied,true);
 assert.equal(result.network.publicListenerDetected,false);assert.equal(result.network.inspection,'verified');
 assert.equal(result.externalBackup.protected,false);assert.equal(result.externalBackup.physicalIndependence,'same-disk-rejected');
 assert.equal(result.manualAcceptance.reboot,'pending');assert.equal(result.noInstallRebootServiceDatabaseOrCredentialChange,true);
 await fs.copyFile(path.join(folder,name),path.join(root,'logs/etapa-h2/observation-local.json'));
});
await fs.writeFile(path.join(root,'logs/etapa-h2/package-checks.json'),JSON.stringify({checks:checks.length,results:checks,folder,syntheticOnly:true,otherWindows:false,reboot:false,physicalExternalDisk:false},null,2));
console.log('H2_PACKAGE_TESTS_OK '+checks.length);
