import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../desktop/package.json',import.meta.url)),asar=require('@electron/asar'),config=require('./electron-builder-agente5-rc.cjs');
const directory='artifacts/agente5-rc1-20261017',file=directory+'/win-unpacked/resources/app.asar';
const files=asar.listPackage(file).map(name=>name.replaceAll('\\','/'));
const dependencies=config.files.filter(item=>typeof item==='object'&&item.to.startsWith('node_modules/')).map(item=>item.to);
for(const dependency of dependencies)assert.ok(files.includes('/'+dependency+'/package.json'),dependency);
for(const name of ['attachment-contract.mjs','attachment-transfer.mjs','attachments.sql','tls-provision.mjs','sync.mjs','api.mjs','backup.mjs']){
 const relative='server/d1-lab/'+name;assert.ok(files.includes('/'+relative));assert.deepEqual(asar.extractFile(file,relative.replaceAll('/',path.sep)),fs.readFileSync(relative));
}
assert.equal(files.some(name=>/(?:^|\/)\.env(?:\.|$)|\.(?:dpapi|ruybak|ruykey|pem|key|crt|dump)$|\/cluster\//i.test(name)),false);
const metadata=JSON.parse(asar.extractFile(file,'package.json'));assert.equal(metadata.ruyRevision,'A5-RC1-20261017');assert.equal(metadata.version,'0.5.1-rc.1');
const installer=directory+'/Sistema-Ruy-A5-RC1-20261017-Setup.exe',report={revision:metadata.ruyRevision,version:metadata.version,dependencies:dependencies.length,criticalSourcesMatch:true,privateFilesAbsent:true,installer,sha256:createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),signed:false,restrictedToHomologation:true,cleanSecondWindowsTested:false};
fs.writeFileSync('logs/agente5-rc-artifact.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
