import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyRelease} from '../production/store.mjs';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const decode=bytes=>bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,'');
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
if(git(['branch','--show-current'])!=='preparacao/windows-oficial-20261015')throw Error('Branch divergente.');
const tests={};
for(const [name,file,pattern] of [
 ['official','etapa-e-official-tests.log',/pass 773/],['lint','etapa-e-lint.log',/eslint \. --quiet/],
 ['build','etapa-e-build.log',/built in/],['buildD1','etapa-e-build-d1.log',/built in/],
 ['package','etapa-e-package.log',/building block map/],['domain','etapa-e-test-domain.mjs.log',/DOMAIN_OK 17/],
 ['bridge','etapa-e-bridge.log',/D1_C2_BRIDGE_OK/],['operations','etapa-e-test-operational-persistence.mjs.log',/OPERATIONAL_PERSISTENCE_OK/],
 ['api','etapa-e-test-api.mjs.log',/D1_OK/],['rename','etapa-e-test-sector-rename.mjs.log',/13\/13/],
 ['edit','etapa-e-test-sector-edit.mjs.log',/SECTOR_EDIT_OK/],['feedback','etapa-e-test-save-feedback.mjs.log',/SAVE_FEEDBACK_OK/],
 ['windowsBackup','etapa-e-test-windows-cycle.mjs.log',/pass 5/],['catalog','etapa-e-test-catalog.mjs.log',/pass 1/],
 ['clientRecovery','etapa-e-test-client-recovery.mjs.log',/pass 1/],['aliases','etapa-e-test-build-aliases.mjs.log',/pass 1/],
 ['criticalEngine','etapa-e-test-critical-engine.mjs.log',/pass 1/],['C2Regression','etapa-e-c2-regression.log',/C2_OK/],
 ['desktopSource','etapa-e-desktop-runner.log',/DOMAIN_DESKTOP_OK/],['desktopPackaged','etapa-e-desktop-packaged-runner.log',/DOMAIN_DESKTOP_OK/],
 ]){
 const bytes=await fs.readFile('logs/'+file),text=decode(bytes);
 if(!pattern.test(text)||/AssertionError|not ok \d|DESKTOP_LAB_BLOCKED/.test(text))throw Error('Evidência ausente/falhou: '+name);
 tests[name]={passed:true,log:'logs/'+file,sha256:sha(bytes)};
 }
const rawTypes=await fs.readFile('logs/etapa-e-typecheck.log'),diagnostics=[...decode(rawTypes).matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+):/gm)],byCode={};
for(const d of diagnostics)byCode[d[4]]=(byCode[d[4]]||0)+1;
if(diagnostics.length!==485)throw Error('Atualizar contagem TypeScript após revisão.');
const productionHome=path.join(process.env.LOCALAPPDATA,'GestaoRuy/producao'),active=await json(path.join(productionHome,'active.json'));
const verified=await verifyRelease(productionHome,active.current),manifestSHA256=sha(await fs.readFile(path.join(productionHome,'releases',active.current,'manifest.json')));
if(active.current!=='20261015T155237724Z-d597121d'||manifestSHA256!=='a82921aa86895848c34dadd9d22d0ad0c329e295a81b5d9b28e3822fd3846ddc')throw Error('Produção alterada.');
const desktops={source:await json('logs/etapa-e-desktop.json'),packaged:await json('logs/etapa-e-desktop-packaged.json')};
const pool=poolFor(await config());
try{
 for(const proof of Object.values(desktops)){
  if(!proof.domains.persistedAfterWindowClosed||!proof.domains.financialReport)throw Error('Evidência UI incompleta.');
  const balance=(await pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[proof.syntheticActor])).rows[0];
  if(balance?.quantity_milli!=='1000')throw Error('Saldo após fechamento/reinício divergiu.');
 }
}finally{await pool.end();}
const installer='artifacts/windows-lab/Sistema-Gestao-Ruy-Lab-0.3.0-Setup.exe',installerBytes=await fs.readFile(installer);
const changedFiles=[...new Set([...git(['diff','HEAD','--name-only']).split('\n'),...git(['ls-files','--others','--exclude-standard']).split('\n'),'docs/evidencias-etapa-e-windows.json'])].filter(Boolean).sort();
const report={generatedAt:new Date().toISOString(),version:'0.3.0',baseCommit:'0e91dc253b9db0d01b8ccdf1f5c7b91d5a2e5ebb',branch:git(['branch','--show-current']),remote:git(['remote','get-url','origin']),production:{release:active.current,manifestSHA256,verifiedFiles:Object.keys(verified.files).length},tests,typescript:{exit:2,baseline:1442,remaining:diagnostics.length,reduction:1442-diagnostics.length,byCode,logSHA256:sha(rawTypes),checksDisabled:false},domain:await json('logs/etapa-e-domain-evidence.json'),bridge:await json('logs/d1-c2-bridge-evidence.json'),desktops,installer:{path:installer,sha256:sha(installerBytes),bytes:installerBytes.length,signed:false},changedFiles,limitations:{dailyUseReleased:false,operationalSyncEnabled:false,cloudMigrations:false,globalReconciliation:false,paymentBatch:false,RHIntegration:false,globalFinancialClose:false,privateAttachments:false,cleanWindows:false,physicalTwoComputers:false,windowsReboot:false,reinstallationOfVersion03:false,crossMachineRestore:false}};
await fs.writeFile('docs/evidencias-etapa-e-windows.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({testGroups:Object.keys(tests).length,domainChecks:report.domain.checks,bridgeChecks:report.bridge.checks,typescriptRemaining:diagnostics.length,productionFiles:report.production.verifiedFiles,installerSHA256:report.installer.sha256}));
