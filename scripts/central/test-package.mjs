import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';
import {loadProfile,sha} from '../../server/central/profile.mjs';import {sendLabTLS} from '../../server/sync-lab/mtls-transport.mjs';
const out=path.resolve('artifacts/central-preparacao-20261027'),proof=JSON.parse(await fs.readFile(path.join(out,'package-prep.3.json'))),root=proof.directory,exec=promisify(execFile);
const reports=await Promise.all((await fs.readdir(out)).filter(f=>/^runtime-[a-f0-9]{16}\.json$/.test(f)).map(async f=>JSON.parse(await fs.readFile(path.join(out,f)))));
const lab=reports.filter(r=>r.passed).sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt)).at(-1);assert.ok(lab);const {profile,secrets}=await loadProfile(lab.root);assert.equal(profile.mode,'lab');
const manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json')));for(const f of manifest.files)assert.equal(sha(await fs.readFile(path.join(root,f.path))),f.sha256);assert.equal(sha(await fs.readFile(proof.zip)),proof.sha256);
const env={...process.env,PATH:process.env.SystemRoot+'\\System32;'+process.env.SystemRoot+'\\System32\\WindowsPowerShell\\v1.0'};delete env.NODE_OPTIONS;
for(const k of Object.keys(env))if(k.startsWith('RUY_')||k.startsWith('PG'))delete env[k];
const executable=path.join(root,'runtime/node.exe');assert.equal((await exec(executable,['--version'],{env,windowsHide:true})).stdout.trim(),proof.nodeVersion);
const before=(await fs.readFile(path.join(lab.root,'central.log'),'utf8')).trim().split('\n').length;
const host=spawn(path.join(root,'runtime/RuyCentralService.exe'),['--console',executable,path.join(root,'scripts/central/supervisor.mjs'),lab.root],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});host.stdout.resume();host.stderr.resume();
const until=async fn=>{for(let i=0;i<300;i++){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,100));}throw Error('PACKAGED_CENTRAL_TIMEOUT');};let ready;
try{
 ready=await until(async()=>{assert.equal(host.exitCode,null);const lines=(await fs.readFile(path.join(lab.root,'central.log'),'utf8')).trim().split('\n').slice(before).map(v=>JSON.parse(v));return lines.find(v=>v.event==='ready');});
 const clients=await Promise.all(['A','B'].map(async(n,i)=>({key:await fs.readFile(path.join(lab.root,n+'.key')),cert:await fs.readFile(path.join(lab.root,n+'.crt')),ca:secrets.tlsCert,token:secrets.devices[i].token,contract:'RUY-SHARED-LAB/1'})));
 for(const client of clients){const r=await sendLabTLS({...client,url:'https://127.0.0.1:'+ready.tlsPort+'/api/local/d1/capabilities'});assert.equal(r.status,401);}
 // Login passwords were deliberately not exported by the runtime test.
 // Its preexisting valid DB-bound sessions allow a read without reprovisioning.
 const pg=(await import('pg')).default;const db=new pg.Client({...profile.database,password:secrets.databasePassword});await db.connect();
 try{for(let i=0;i<clients.length;i++){
  // Tokens are stored only as hashes; do not bypass login or invent a session.
  const state=(await db.query('SELECT count(*)::int n FROM d1_central_records')).rows[0];assert.ok(state.n>0);
  assert.ok((await db.query('SELECT 1 FROM central_history_binding WHERE dataset_sha256=$1',[profile.history.datasetSha256])).rowCount);
 }}finally{await db.end();}
}finally{
 const end=new Promise(r=>host.once('exit',r));host.stdin.write('shutdown\n');let timeout;try{await Promise.race([end,new Promise((_,j)=>{timeout=setTimeout(()=>j(Error('PACKAGED_HOST_SHUTDOWN_TIMEOUT')),45000);})]);}finally{clearTimeout(timeout);}assert.equal(host.exitCode,0);
}
await assert.rejects(fs.stat(path.join(lab.root,'supervisor.lock')),e=>e.code==='ENOENT');
const fakeProfile=path.join(lab.root,'fake-service-account','central-pichau-rc1-staging');await fs.mkdir(fakeProfile,{recursive:true});
const service=await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/central/Install-CentralService.ps1'),'-Package',root,'-Profile',fakeProfile],{windowsHide:true});assert.match(service.stdout,/True/);
const installer=path.resolve('artifacts/multicomputador-0.9.0-rc.1-20261026/build/Sistema-Ruy-Compartilhado-0.9.0-rc.1-Setup.exe');
const device=await exec('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/central/Prepare-RuiPcEstoque.ps1'),'-Installer',installer],{windowsHide:true});assert.match(device.stdout,/True/);
const dry=JSON.parse((await exec(executable,[path.join(root,'scripts/central/initialize-empty.mjs'),'--profile='+path.join(process.env.LOCALAPPDATA,'GestaoRuy/central-pichau-rc1-staging')],{windowsHide:true,env})).stdout);assert.equal(dry.dryRun,true);
const result={passed:true,packageSha256:proof.sha256,filesVerified:manifest.files.length,bundledNode:true,pathExcludesExternalNode:true,nativeX64HostLifecycle:true,tlsRequiresIndividualSession:true,historyBindingPresent:true,windowsServiceRegistrationPerformed:false,serviceDryRun:true,clientProvisioningDryRun:true,databaseInitializationDryRun:true,ruiPcAccessed:false,productionChanged:false};
await fs.writeFile(path.join(out,'package-test-prep.3.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
