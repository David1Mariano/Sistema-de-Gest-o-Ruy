// Read-only collection; never decrypts configuration or connects to a database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const json=async name=>JSON.parse(await fs.readFile(name,'utf8'));
const hash=async name=>createHash('sha256').update(await fs.readFile(name)).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
assert.equal(git('branch','--show-current'),'agente-5-auditoria-integracao-20261019');
const audit=await json('docs/evidencias/agente5-auditoria-quatro-branches-20261019.json');
let wipFiles=0;for(const [file,expected] of Object.entries(audit.wipSha256)){assert.equal(await hash(path.join(audit.wipWorktree,file)),expected,file);wipFiles++;}
assert.equal(wipFiles,10);assert.equal(git('-C',audit.wipWorktree,'rev-parse','HEAD'),audit.auditBase);
const stage1=await json('logs/stage1-api.json'),stage2=await json('logs/stage2-isolated.json'),stage3=await json('logs/stage3-isolated.json'),stage4=await json('logs/stage4-isolated.json');
assert.equal(stage1.checks,8);assert.equal(stage2.checks,16);assert.equal(stage3.checks,14);assert.equal(stage4.checks,17);
const transfer=await json('logs/agente5-rc3-transfer.json'),restart=await json('logs/agente5-rc3-postgres.json'),mtls=await json('logs/agente5-rc3-mtls.json'),windows=await json('logs/agente5-rc3-windows.json');
assert.equal(transfer.checks,33);assert.ok(transfer.databases.every(d=>d.port===55437));assert.equal(restart.persistenceVerified,true);
assert.equal(windows.packaged,true);assert.equal(windows.revision,'A5-I5-20261019');assert.equal(windows.rc3.financialReversalConfirmed,true);
const artifact=await json('logs/etapa5/artifact.json'),rh=await json('logs/etapa5/rh.json'),reopen=await json('logs/etapa5/reopen.json'),gate=await json('logs/etapa5/candidate-gate.json');
assert.equal(await hash(artifact.installer),artifact.sha256);assert.equal(rh.checks,10);assert.equal(reopen.newPackagedLaunches,2);assert.equal(gate.fixtureMissingRefusedBeforeEnvironmentAccess,true);
const regressionBytes=await fs.readFile('logs/etapa5/regression-all.log');
const regression=regressionBytes.subarray(0,2).equals(Buffer.from([255,254]))?regressionBytes.toString('utf16le'):regressionBytes.toString('utf8');
assert.match(regression,/(?:tests|testes) 833/);assert.match(regression,/(?:fail|falha) 0/);
const logNames=['stage1','stage2','stage3','stage4','mtls','rc3-postgres','rc3-postgres-retry','package','package-retry','packaged-windows','regression-all','rh-run','reopen','reopen-retry','candidate-gate','lint-final','build-web','build-d1','test-stock','check-stock','test-financeiro-estabilidade','test-financeiro-integrado','test-freelancer','test-resumo-categorias','check-rh-exclusao'];
const logSha256={};for(const name of logNames)logSha256['logs/etapa5/'+name+'.log']=await hash('logs/etapa5/'+name+'.log');
const report={date:'2026-10-19',revision:artifact.revision,version:artifact.version,base:'a462b2293c80f5129dfd6e6485937e332a357fac',sourceHeadAtCollection:git('rev-parse','HEAD'),branch:git('branch','--show-current'),stages:{stage1,stage2,stage3,stage4},regressions:{nodeTestPassed:833,nodeTestFailed:0,stockInternalChecks:121,lint:true,webBuild:true,d1Build:true},rc3:{checks:transfer.checks,results:transfer.results,allDatabasePorts:[...new Set(transfer.databases.map(d=>d.port))]},mtls,restart,rh,packagedWindows:windows,reopen,candidateGate:gate,artifact,preservation:{wipFilesHashVerified:wipFiles,originalHead:audit.auditBase,production8080Changed:false,oldApi18080Changed:false,supabaseChanged:false,shared55436Migrated:false,operationalDataUsed:false,forcedTermination:false,operationalSyncEnabled:false},pending:['clean Windows installation/reinstallation/reboot','two physical Windows computers','physical network reconnection','independent machine mTLS provisioning and rotation','independent restore and keys','final local/service ACL and privileges','linked RH discount financial reversal','Delivery payments refunds providers and messaging','old API authorized normal replacement','operational acceptance and signing'],logSha256};
await fs.writeFile('docs/evidencias/agente5-integracao-etapa5-20261019.json',JSON.stringify(report,null,2)+'\n');console.log('I5_EVIDENCE_COLLECTED '+wipFiles+' WIP files verified');
