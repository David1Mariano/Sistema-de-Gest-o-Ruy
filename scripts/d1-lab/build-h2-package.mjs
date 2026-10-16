import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const installer='Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.exe';
const expected='4e65feaa43612911494863f1f6689dc868960e1c86fdc8b6f73029ece9937c91';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const name='windows-h2-homologacao-'+new Date().toISOString().replace(/[:.]/g,'-');
const output=path.join(root,'artifacts',name);await fs.mkdir(output,{recursive:false});
const entries=[
 ['artifacts/windows-lab-0.5.0-h1/'+installer,installer],
 ['docs/etapa-h2-roteiro.md','LEIA-ME-H2.md'],
 ...['Verify-Package.ps1','Collect-H2.ps1','Test-BackupCopy.ps1'].map(file=>['scripts/d1-lab/h2/'+file,file]),
];
const files=[];
for(const [source,target] of entries){
 const bytes=await fs.readFile(path.join(root,source));
 if(target===installer&&hash(bytes)!==expected)throw Error('H1 installer changed; package blocked.');
 await fs.writeFile(path.join(output,target),bytes,{flag:'wx'});files.push({name:target,bytes:bytes.length,sha256:hash(bytes)});
}
const checks=['installationAndShortcuts','apiAuthenticationAndLoopback','offlineLogin','officialModules','closeReopenPersistence','offlineNetwork','pendingQueue','authorizedRealReboot','failureRecovery','physicalExternalDestination','encryptedBackupAndPortableKey','retention','backupCopyHashes','isolatedRestoreTablesAttachmentsQueue','uninstallReinstallPreservation','cloudNeverOperationalGreen'];
const form={purpose:'RUY_H2_MANUAL_ACCEPTANCE',version:'0.5.0',revision:'H1',installerSha256:expected,responsible:null,date:null,machineHash:null,windowsBuild:null,independentWindows:false,rebootAuthorization:{responsible:null,date:null,targetMachineHash:null},syntheticRecords:[],pendingBefore:null,pendingAfter:null,checks:Object.fromEntries(checks.map(check=>[check,{result:'pendente',evidence:[],observations:''}])),physicalBackupProtected:false,operationalUseApproved:false,doNotRecordSecrets:true};
const bytes=Buffer.from(JSON.stringify(form,null,2)+'\n');await fs.writeFile(path.join(output,'ficha-h2.json'),bytes,{flag:'wx'});files.push({name:'ficha-h2.json',bytes:bytes.length,sha256:hash(bytes)});
await fs.writeFile(path.join(output,'package-manifest.json'),JSON.stringify({purpose:'RUY_H2_SYNTHETIC_ACCEPTANCE_KIT',createdAt:new Date().toISOString(),installerSha256:expected,files,noAutomaticInstallRebootServicesOrSync:true},null,2)+'\n',{flag:'wx'});
const zip=output+'.zip';
const quote=value=>"'"+value.replaceAll("'","''")+"'";
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath ${quote(output)} -DestinationPath ${quote(zip)} -CompressionLevel Fastest`],{windowsHide:true,stdio:'pipe',timeout:120000});
const result={directory:output,zip,zipSha256:hash(await fs.readFile(zip)),installerSha256:expected,files:files.length+1};
await fs.writeFile(zip+'.sha256.txt',result.zipSha256+'  '+path.basename(zip)+'\n',{flag:'wx'});
await fs.writeFile(path.join(root,'logs/etapa-h2/package.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
