import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {schemaFiles} from '../../server/central/schema.mjs';import {sha} from '../../server/central/profile.mjs';
const exec=promisify(execFile),project=path.resolve('.'),out=path.join(project,'artifacts/central-sessoes-20261027'),dest=path.join(out,'pacote-central-0.10.0-rc.1-prep.4');
await fs.mkdir(out,{recursive:true});
try{await fs.stat(dest);try{await fs.stat(path.join(dest,'manifest.json'));throw Error('SEALED_PACKAGE_PRESERVED');}catch(e){if(e.code!=='ENOENT')throw e;}if(!dest.startsWith(path.join(project,'artifacts')+path.sep))throw Error('WORKSPACE_REQUIRED');await fs.rename(dest,dest+'.incomplete-'+Date.now());}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(dest);const seen=new Set(),packages=new Set();
async function copy(relative){const source=path.resolve(project,relative);if(!source.startsWith(project+path.sep)||seen.has(source))return;seen.add(source);const target=path.join(dest,path.relative(project,source));await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);if(!/\.(mjs|js)$/.test(source))return;
 const text=await fs.readFile(source,'utf8');const imports=[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);for(const specifier of imports){if(specifier.startsWith('.'))await copy(path.relative(project,path.resolve(path.dirname(source),specifier)));else if(!specifier.startsWith('node:'))packages.add(specifier.split('/').slice(0,specifier.startsWith('@')?2:1).join('/'));}
}
for(const file of ['server/central/worker.mjs','scripts/central/supervisor.mjs','scripts/central/initialize-empty.mjs','scripts/homologacao/verify-device-public.mjs'])await copy(file);
for(const name of schemaFiles)await copy('server/'+name+'.sql');
for(const file of ['Install-CentralService.ps1','Prepare-RuiPcEstoque.ps1','WindowsServiceHost.cs','central.template.json','authorization.template.json','cloudflare-tunnel.template.yml','prepare-internet.mjs'])await copy('scripts/central/'+file);
for(const file of ['device-authorization.template.json','physical-checklist.template.csv'])await copy('scripts/homologacao/'+file);
await copy('docs/central-sessoes-20261027.md');
const copiedPackages=new Set();
async function dependency(name,from=project){
 let dir=path.dirname(createRequire(path.join(from,'package.json')).resolve(name));while(path.basename(dir)!==name.split('/').at(-1)){const next=path.dirname(dir);if(next===dir)throw Error('PACKAGE_ROOT_NOT_FOUND');dir=next;}
 const info=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));if(copiedPackages.has(info.name))return;copiedPackages.add(info.name);const target=path.join(dest,'node_modules',info.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.cp(dir,target,{recursive:true,errorOnExist:true,force:false});
 for(const dep of Object.keys(info.dependencies||{}))await dependency(dep,dir);for(const dep of Object.keys(info.optionalDependencies||{}))try{await dependency(dep,dir);}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
}
for(const name of packages)await dependency(name);
await fs.mkdir(path.join(dest,'runtime'));await fs.copyFile(process.execPath,path.join(dest,'runtime/node.exe'));
const licenseSource='https://raw.githubusercontent.com/nodejs/node/'+process.version+'/LICENSE';
const license=await fetch(licenseSource,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!license.ok)throw Error('NODE_DISTRIBUTION_LICENSE_REQUIRED');const licenseText=await license.text();if(!licenseText.startsWith('Node.js is licensed for use as follows:'))throw Error('NODE_LICENSE_INVALID');await fs.writeFile(path.join(dest,'runtime/Node-LICENSE.txt'),licenseText,{flag:'wx'});
await exec('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:exe','/platform:x64','/reference:System.ServiceProcess.dll','/out:'+path.join(dest,'runtime/RuyCentralService.exe'),path.join(project,'scripts/central/WindowsServiceHost.cs')],{windowsHide:true});
await fs.writeFile(path.join(dest,'package.json'),JSON.stringify({name:'ruy-central-preparada',version:'0.10.0-rc.1-prep.4',private:true,type:'module'},null,2));
const files=[];async function walk(dir){for(const d of await fs.readdir(dir,{withFileTypes:true})){if(d.isSymbolicLink())throw Error('PACKAGE_LINK_REFUSED');const f=path.join(dir,d.name);if(d.isDirectory())await walk(f);else{if(/\.(dpapi|ruybak|dump|pfx|p12|key|pem|env)$/i.test(f))throw Error('PRIVATE_FILE_REFUSED');const bytes=await fs.readFile(f);if(/\.(js|mjs|json|ps1|sql|md|cs|txt)$/i.test(f)&&/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----\s+[a-zA-Z0-9+/=\r\n]{64,}/.test(bytes.toString()))throw Error('EMBEDDED_PRIVATE_KEY_REFUSED');files.push({path:path.relative(dest,f),bytes:bytes.length,sha256:sha(bytes)});}}}await walk(dest);
const manifest={version:'0.10.0-rc.1-prep.4',createdAt:new Date().toISOString(),purpose:'PREPARATION_ONLY_NOT_PRODUCTION_ACTIVATION',nodeVersion:process.version,credentialsIncluded:false,installerRebuilt:false,files};await fs.writeFile(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2));
const psQuote=s=>"'"+s.replaceAll("'","''")+"'";const zip=dest+'.zip';await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command','Compress-Archive -LiteralPath '+psQuote(dest)+' -DestinationPath '+psQuote(zip)+' -CompressionLevel Optimal'],{windowsHide:true,timeout:120000});
const proof={authentication:'user-session',directory:dest,zip,bytes:(await fs.stat(zip)).size,sha256:sha(await fs.readFile(zip)),files:files.length,nodeVersion:process.version,privateKeys:0,privateProfiles:0,servicesInstalled:0};await fs.writeFile(path.join(out,'package-prep.4.json'),JSON.stringify(proof,null,2),{flag:'wx'});console.log(JSON.stringify(proof));
