import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url)),asar=require('@electron/asar'),config=require('./electron-builder-agente5-rc3.cjs');
const directory='artifacts/agente5-rc3-20261017',file=directory+'/win-unpacked/resources/app.asar';
const files=asar.listPackage(file).map(name=>name.replaceAll('\\','/'));
const dependencies=config.files.filter(item=>typeof item==='object'&&item.to.startsWith('node_modules/')).map(item=>item.to);
for(const dependency of dependencies)assert.ok(files.includes('/'+dependency+'/package.json'),dependency);
for(const name of ['attachment-contract.mjs','attachment-transfer.mjs','attachments.sql','tls-provision.mjs','sync.mjs','api.mjs','backup.mjs','business-projection.mjs','business.sql','ledger-contract.mjs','reconciliation.mjs','operations.mjs','domain.mjs','core.mjs','catalog.mjs','entities.mjs','employee-delete.mjs','sync-contract.mjs']){
 const relative='server/d1-lab/'+name;assert.ok(files.includes('/'+relative));assert.deepEqual(asar.extractFile(file,relative.replaceAll('/',path.sep)),fs.readFileSync(relative));
}
for(const name of ['main.mjs','policy.mjs','rc3-smoke.mjs'])assert.deepEqual(asar.extractFile(file,name),fs.readFileSync('desktop/'+name));
for(const entry of fs.readdirSync('dist-d1',{recursive:true,withFileTypes:true})){if(entry.isFile()){const relative=path.join(entry.parentPath||entry.path,entry.name),packed=relative.replaceAll('\\','/');assert.deepEqual(asar.extractFile(file,packed.replaceAll('/',path.sep)),fs.readFileSync(relative));}}
assert.equal(files.some(name=>/(?:^|\/)\.env(?:\.|$)|\.(?:dpapi|ruybak|ruykey|pem|pfx|key|crt|dump|sqlite)$|(?:owner|db)-config\.json$|\/cluster\//i.test(name)),false);
const metadata=JSON.parse(asar.extractFile(file,'package.json'));assert.equal(metadata.ruyRevision,'A5-RC3-20261017');assert.equal(metadata.version,'0.5.1-rc.3');
const installer=directory+'/Sistema-Ruy-A5-RC3-20261017-Setup.exe',report={revision:metadata.ruyRevision,version:metadata.version,dependencies:dependencies.length,criticalSourcesMatch:true,privateFilesAbsent:true,uiBundleMatches:true,installer,sha256:createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),signed:false,restrictedToHomologation:true,cleanSecondWindowsTested:false};
fs.writeFileSync('logs/agente5-rc3-artifact.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
