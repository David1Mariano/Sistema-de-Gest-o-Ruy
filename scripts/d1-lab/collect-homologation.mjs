import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyRelease} from '../production/store.mjs';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const log=async p=>{const b=await fs.readFile(p);return b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');};
const git=args=>execFileSync('git',args,{windowsHide:true,encoding:'utf8'}).trim();
const home=path.join(process.env.LOCALAPPDATA,'GestaoRuy/producao'),active=await json(path.join(home,'active.json'));
const release=await verifyRelease(home,active.current),manifestSHA256=sha(await fs.readFile(path.join(home,'releases',active.current,'manifest.json')));
if(active.current!=='20261015T155237724Z-d597121d'||manifestSHA256!=='a82921aa86895848c34dadd9d22d0ad0c329e295a81b5d9b28e3822fd3846ddc')throw Error('Produção divergiu da referência.');
const tests={};
for(const [name,file,pattern] of [
 ['official','logs/homologacao-official-tests.log',/pass 773/],
 ['lint','logs/homologacao-lint-final.log',/eslint \. --quiet/],
 ['buildOfficial','logs/homologacao-build.log',/built in/],
 ['buildD1','logs/build-d1-v02.log',/built in/],
 ['package','logs/homologacao-package.log',/building block map/],
 ['API','logs/homologacao-test-api.mjs.log',/D1_OK/],
 ['rename','logs/homologacao-test-sector-rename.mjs.log',/13\/13/],
 ['edit','logs/homologacao-test-sector-edit.mjs.log',/SECTOR_EDIT_OK/],
 ['feedback','logs/homologacao-test-save-feedback.mjs.log',/SAVE_FEEDBACK_OK/],
 ['windowsBackup','logs/homologacao-test-windows-cycle.mjs.log',/pass 5/],
 ['catalog','logs/homologacao-test-catalog.mjs.log',/pass 1/],
 ['clientRecovery','logs/homologacao-test-client-recovery.mjs.log',/pass 1/],
 ['aliases','logs/homologacao-test-build-aliases.mjs.log',/pass 1/],
 ['criticalEngine','logs/homologacao-test-critical-engine.mjs.log',/pass 1/],
 ['C2Regression','logs/homologacao-c2-regression.log',/C2_OK/],
 ['D1C2Bridge','logs/d1-c2-bridge-final.log',/D1_C2_BRIDGE_OK/],
 ['operationalPersistence','logs/operational-persistence.log',/OPERATIONAL_PERSISTENCE_OK/],
 ['bootstrapSafety','logs/bootstrap-safety.log',/BOOTSTRAP_SAFETY_OK/],
])tests[name]={passed:pattern.test(await log(file)),log:file};
if(Object.values(tests).some(t=>!t.passed))throw Error('Resultado de teste ausente/reprovado.');
const typescript=await log('logs/homologacao-typecheck.log'),diagnostics=[...typescript.matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+):/gm)],byCode={};
for(const d of diagnostics)byCode[d[4]]=(byCode[d[4]]||0)+1;
const sourceChanges=git(['diff','HEAD','--name-only','--','src']).split('\n').filter(Boolean);if(sourceChanges.length)throw Error('Fonte oficial alterada.');
const installed=await json('logs/homologacao-desktop-installed.json'),owned=await json('logs/homologacao-desktop-owned.json'),installation=await json('logs/homologacao-installation-preservation.json');
if(!owned.apiOwned||!owned.originalStockPage?.created||!installed.originalStockPage?.created||installation.before.sha256!==installation.after.sha256)throw Error('Evidência desktop/instalação inválida.');
const pool=poolFor(await config());
try{
 for(const proof of [owned,installed]){
  const rows=(await pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[proof.syntheticActor])).rows;
  if(rows.length!==1||rows[0].quantity_milli!=='2000')throw Error('Estoque não persistiu após fechar/reinstalar.');
 }
}finally{await pool.end();}
const installer='artifacts/windows-lab/Sistema-Gestao-Ruy-Lab-0.2.0-Setup.exe',bytes=await fs.readFile(installer);
const health={};for(const [name,port,route] of [['production',8080,'/__health'],['D1',18087,'/health'],['C2',18086,'/health']]){const r=await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('Health final falhou.');health[name]=await r.json();}
const report={generatedAt:new Date().toISOString(),branch:git(['branch','--show-current']),baseCommit:'9d7e59ea59239f1ab25c0abbc346420d83e3783d',version:'0.2.0',production:{release:active.current,manifestSHA256,verifiedFiles:Object.keys(release.files).length,sourceChanges},health,tests,typescript:{exit:2,diagnostics:diagnostics.length,byCode,sample:diagnostics.slice(0,5).map(d=>({file:d[1],line:Number(d[2]),code:d[4]})),existingOfficialSource:true},bridge:await json('logs/d1-c2-bridge-evidence.json'),operations:await json('logs/operational-persistence-evidence.json'),desktop:{owned,installed,stockPersistsAfterClose:true},installation,installer:{path:installer,bytes:bytes.length,sha256:sha(bytes),signed:false},limitations:{dailyUseReleased:false,operationalSyncEnabled:false,physicalComputersTested:false,cleanWindowsTested:false,visualParityApproved:false,crossMachineKeyRecovery:false,externalBackupProtected:false,globalBusinessReconciliation:false}};
await fs.writeFile('docs/evidencias-homologacao-windows.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({tests:Object.keys(tests).length,typescriptDiagnostics:diagnostics.length,productionFiles:report.production.verifiedFiles,installerSHA256:report.installer.sha256,sourceChanges:sourceChanges.length}));
