import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),out=path.resolve('artifacts/multicomputador-0.10.0-rc.2-20261028');
const manifest=path.join(out,'release-manifest.json'),installer=path.join(out,'build/Sistema-Ruy-Compartilhado-0.10.0-rc.2-Setup.exe');
const ps=(script,args=[])=>exec('powershell.exe',['-NoProfile','-NonInteractive','-File',script,...args],{windowsHide:true,timeout:20000});
test('update helper reports the current installation without launching NSIS; applying on the operational host is refused',async()=>{
 const args=['-Installer',installer,'-ReleaseManifest',manifest];
 const r=await ps('scripts/central/Update-SharedClient.ps1',args);assert.match(r.stdout,/DryRun\s*:\s*True/);assert.match(r.stdout,/Installed\s*:\s*False/);assert.match(r.stdout,/75c7b9b8-6d06-4bf1-89d1-4e566b45c050/);
 await assert.rejects(ps('scripts/central/Update-SharedClient.ps1',[...args,'-Apply']),e=>/bloqueado|Autorizacao especifica obrigatoria/.test(e.stderr));
 await fs.writeFile(path.join(out,'update-helper-dry-run.txt'),r.stdout);
});
test('LAN and planned internet policy are accepted in dry-run, without network or registry writes',async()=>{
 for(const endpoint of ['https://ADM-RUY:18716/','https://api.ruycaldodecana.com.br/']){const r=await ps('scripts/central/Set-PublicApiPolicy.ps1',['-ApiEndpoint',endpoint]);assert.match(r.stdout,/RegistryModified\s*:\s*False/);}
 await assert.rejects(ps('scripts/central/Set-PublicApiPolicy.ps1',['-ApiEndpoint','http://ADM-RUY:18716/']));
});
test('public CA trust is dry-run only; no private key, trust import or operational certificate is created',async()=>{
 const base=path.join(process.env.LOCALAPPDATA,'GestaoRuy','installation-final-dev-20261021');const candidates=[];
 for(const name of await fs.readdir(base)){if(!/^shared-test-[a-f0-9]{16}$/.test(name))continue;try{const cert=path.join(base,name,'ca.crt'),stat=await fs.stat(cert);candidates.push({cert,time:stat.mtimeMs});}catch{/* Only existing laboratory fixtures. */}}
 candidates.sort((a,b)=>b.time-a.time);assert.ok(candidates.length);
 const cert=candidates[0].cert,hash=createHash('sha256').update(await fs.readFile(cert)).digest('hex'),args=['-PublicCertificate',cert,'-ExpectedSha256',hash];
 const r=await ps('scripts/central/Trust-ServerPublicCa.ps1',args);assert.match(r.stdout,/TrustChanged\s*:\s*False/);assert.match(r.stdout,/PrivateKey\s*:\s*False/);
 await assert.rejects(ps('scripts/central/Trust-ServerPublicCa.ps1',[...args,'-Apply']),e=>/maquina operacional|Autorizar explicitamente/.test(e.stderr));
 await fs.writeFile(path.join(out,'public-ca-dry-run.txt'),r.stdout);
});
test('installation/uninstallation driver refuses the actual host before executing any installer',async()=>{
 await assert.rejects(ps('scripts/central/Test-InstallerIsolated.ps1',['-PackageRoot',out,'-PreviousInstaller',path.resolve('artifacts/multicomputador-0.10.0-rc.1-20261027/build/Sistema-Ruy-Compartilhado-0.10.0-rc.1-Setup.exe'),'-EvidenceRoot',path.join(out,'must-not-run-on-host')]),e=>/somente dentro do Windows Sandbox/.test(e.stderr));
 await assert.rejects(fs.stat(path.join(out,'must-not-run-on-host')),e=>e.code==='ENOENT');
});
