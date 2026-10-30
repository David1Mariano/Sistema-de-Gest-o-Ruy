// Coleta read-only de integridade e resultados; nunca conecta a banco operacional.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from '../production/store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJSON=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const readLog=async file=>{const bytes=await fs.readFile(file);return bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
const production=path.join(process.env.LOCALAPPDATA,'GestaoRuy','producao');
const active=await readJSON(path.join(production,'active.json'));
const release=await verifyRelease(production,active.current);
const manifestHash=sha(await fs.readFile(path.join(production,'releases',active.current,'manifest.json')));
const health={};
for(const [name,port,route] of [['production',8080,'/__health'],['D1',18087,'/health'],['C1',18083,'/health'],['C2',18086,'/health']]){
 const r=await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.timeout(3000)});
 health[name]={status:r.status,...await r.json()};
}
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const installer='artifacts/windows-lab/Sistema-Gestao-Ruy-Lab-0.1.0-Setup.exe';
const asar='artifacts/windows-lab/win-unpacked/resources/app.asar';
const installed='artifacts/windows-installation-lab/resources/app.asar';
const packageHash=sha(await fs.readFile(asar));
const installerBytes=await fs.readFile(installer);
const tests={};
for(const [name,file,pattern] of [
 ['official','logs/official-tests.log',/pass 773/],
 ['d1API','logs/test-api.mjs.final.log',/D1_OK/],
 ['d1Rename','logs/test-sector-rename.mjs.delivery.log',/13\/13/],
 ['d1Edit','logs/test-sector-edit.mjs.final.log',/SECTOR_EDIT_OK/],
 ['feedback','logs/test-save-feedback.mjs.final.log',/SAVE_FEEDBACK_OK/],
 ['windowsBackup','logs/test-windows-cycle.mjs.final.log',/pass 5/],
 ['catalog','logs/test-catalog.mjs.delivery.log',/pass 1/],
 ['critical','logs/test-critical-engine.mjs.final.log',/pass 1/],
 ['clientRecovery','logs/test-client-recovery.mjs.delivery.log',/pass 1/],
 ['buildAliases','logs/test-build-aliases.mjs.delivery.log',/pass 1/],
 ['syncC2','logs/c2-cycle.log',/C2_OK/],
 ])tests[name]={passed:pattern.test(await readLog(file)),log:file};
const report={
 generatedAt:new Date().toISOString(),purpose:'RUY_WINDOWS_SYNTHETIC_DEVELOPMENT',
 branch:git(['branch','--show-current']),commit:git(['rev-parse','HEAD']),
 officialSourceChanges:git(['diff','--name-only','HEAD','--','src']).split('\n').filter(Boolean),
 production:{release:active.current,manifestHash,verifiedFiles:Object.keys(release.files).length,unchanged:active.current==='20261015T155237724Z-d597121d'&&manifestHash==='a82921aa86895848c34dadd9d22d0ad0c329e295a81b5d9b28e3822fd3846ddc'},
 health,installer:{file:installer,bytes:installerBytes.length,sha256:sha(installerBytes),asarSHA256:packageHash,installedAsarMatches:packageHash===sha(await fs.readFile(installed)),signed:false},
 desktopOwnedAPI:await readJSON('logs/desktop-owned-context.json'),
 desktopInstalled:await readJSON('logs/desktop-installed-smoke.json'),
 installationPreservation:await readJSON('logs/installation-preservation.json'),
 tests,typecheck:{passed:false,diagnostics:1442,log:'logs/official-typecheck.log'},
 limits:{visualParity:'pending; hidden-window frames were stale',windowsClean:'not-tested',physicalOffline:'not-tested; process-level network guard used',twoPhysicalComputers:'not-tested',operationalSyncEnabled:false,D1ConnectedToC2:false,privateAttachmentSync:'not-implemented',externalBackupProtected:false,crossMachineKeyRecovery:'not-implemented'},
};
if(!report.production.unchanged||report.officialSourceChanges.length||!report.installer.installedAsarMatches||Object.values(tests).some(t=>!t.passed))throw Error('Evidência final divergiu. Investigar antes de entregar.');
await fs.writeFile('docs/evidencias-ciclo-windows-20261015.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({release:report.production.release,manifestHash,verifiedFiles:report.production.verifiedFiles,installerSHA256:report.installer.sha256,testsVerified:Object.keys(tests).length,officialSourceChanges:report.officialSourceChanges.length}));
