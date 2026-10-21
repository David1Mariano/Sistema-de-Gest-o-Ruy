import {app} from 'electron';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';
async function run(){
 await app.whenReady();if(!app.isPackaged)throw Error('PACKAGED_PREFLIGHT_REQUIRED');const root=app.getAppPath(),metadata=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 if(!['RUY-WINDOWS-CANDIDATE-20261021','RUY-WINDOWS-LAYOUT-20261021'].includes(metadata.ruyRevision)||metadata.ruyIndividualIdentity!==true)throw Error('CANDIDATE_METADATA_REFUSED');
 const env=await import(pathToFileURL(path.join(root,'server/d1-lab/environment.mjs')));await env.validateHome();
 for(const file of ['server/d1-lab/identity-profile.mjs','server/d1-lab/operational-history-profile.mjs','server/d1-lab/attendance.mjs','server/d1-lab/payroll.mjs'])await import(pathToFileURL(path.join(root,file)));
 for(const file of ['dist-d1/lab/d1/index.html','individual-admin.html','individual-admin-preload.cjs','individual-admin-renderer.js','assets/ruy.ico'])await fs.access(path.join(root,file));
 await fs.writeFile(path.join(env.home,'packaged-preflight.json'),JSON.stringify({passed:true,packaged:true,version:metadata.version,revision:metadata.ruyRevision,backendDependenciesLoaded:true,individualIdentity:true,recoveredSourceAdapter:true,frontendBundled:true,defaultCredentials:false,emailSent:false,databaseStarted:false,installed:false},null,2),{flag:'wx'});app.quit();
}
run().catch(()=>{process.exitCode=1;app.quit();});
