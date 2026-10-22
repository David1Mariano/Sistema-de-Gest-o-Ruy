// Real recovered data: aggregate output only. Authentication fixtures are in a
// separate synthetic DB; never insert synthetic business records into the import.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {powershell,installation,config} from '../../server/d1-lab/environment.mjs';
import {createOperationalHistory} from '../../server/d1-lab/operational-history.mjs';
import {historicalEntities} from '../../server/d1-lab/history-readonly.mjs';
import {createIdentity,identityPassword} from '../../server/d1-lab/identity.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
if(installation?.id!=='final-dev-20261021'||process.env.RUY_OPERATIONAL_SCREEN_ACCEPTANCE!=='1')throw Error('EXPLICIT_ISOLATED_SCREEN_TEST_REQUIRED');
const root=process.argv[2];if(!root||!path.isAbsolute(root))throw Error('NEW_IMPORT_ROOT_REQUIRED');
const open=async file=>JSON.parse(powershell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}',await fs.readFile(file,'utf8')));
const seal=async(file,data)=>fs.writeFile(file,powershell('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify(data)),{flag:'wx'});
const marker=JSON.parse(await fs.readFile(path.join(root,'marker.json'),'utf8'));assert.equal(marker.purpose,'RUY_REAL_OPERATIONAL_REHEARSAL_ONLY');assert.match(marker.database,/^ruy_operational_trial_[a-f0-9]{12}$/);assert.equal(marker.port,55463);
const ownerConfig=await open(path.join(root,'owner.dpapi'));assert.equal(ownerConfig.database,marker.database);assert.equal(ownerConfig.host,'127.0.0.1');assert.equal(ownerConfig.port,55463);
const owner=new pg.Pool(ownerConfig),suffix=randomBytes(8).toString('hex'),readerRole='ruy_import_'+suffix+'_reader';
const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));assert.equal(report.imported,1186);assert.equal(report.sourceUnchanged,true);assert.equal(report.operationalSideEffects,0);
const sourceRoot=path.join(path.dirname(path.dirname(root)),'ensaio-postgresql','ensaio-2026-10-20T21-33-52-094Z-e9e1ff00');
const recoveryAdmin=await open(path.join(sourceRoot,'admin.dpapi'));assert.equal(recoveryAdmin.host,'127.0.0.1');assert.equal(recoveryAdmin.port,55463);
const readConfig={...ownerConfig,user:readerRole,password:randomBytes(32).toString('hex')};
const ctl=new pg.Client(recoveryAdmin);await ctl.connect();try{await ctl.query(`CREATE ROLE ${readerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${readConfig.password}'`);await ctl.query(`GRANT CONNECT ON DATABASE ${marker.database} TO ${readerRole}`);await ctl.query(`ALTER ROLE ${readerRole} SET default_transaction_read_only=on`);}finally{await ctl.end();}
await owner.query(`GRANT USAGE ON SCHEMA history TO ${readerRole};GRANT SELECT ON ALL TABLES IN SCHEMA history TO ${readerRole};GRANT SELECT ON historical_import_receipts TO ${readerRole}`);
await seal(path.join(root,'screen-reader-'+suffix+'.dpapi'),readConfig);
const reader=new pg.Pool(readConfig),authDatabase='ruy_d1_rc_'+suffix,authOwnerConfig=await config(true),authCtl=new pg.Client(authOwnerConfig);await authCtl.connect();try{await authCtl.query('CREATE DATABASE '+authDatabase+' OWNER ruy_d1_owner');await authCtl.query('REVOKE ALL ON DATABASE '+authDatabase+' FROM PUBLIC');}finally{await authCtl.end();}
const auth=new pg.Pool({...authOwnerConfig,database:authDatabase});
for(const name of ['schema','entities','catalog','sync','operations','domain','attachments','business','identity'])await auth.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
const userId=randomUUID(),unauthorizedId=randomUUID(),device=randomUUID(),password=randomBytes(24).toString('hex'),email='screen-'+suffix+'@example.invalid';
await auth.query('INSERT INTO lab_device(id) VALUES($1)',[device]);
for(const [id,login] of [[userId,email],[unauthorizedId,'unauthorized-'+suffix+'@example.invalid']]){
 await auth.query("INSERT INTO lab_users(id,login,password_hash,role,active) VALUES($1,$2,$3,'admin',true)",[id,login,await identityPassword(password)]);
 await auth.query("INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at) VALUES($1,'FICTICIO Teste separado de acesso',now(),now())",[id]);
}
const identity=createIdentity({pool:auth,pepper:randomBytes(32),sender:async()=>{throw Error('NO_EMAIL_AUTHORIZED_IN_SCREEN_TEST');}});
const projection=createOperationalHistory({pool:reader,grants:[{userId,entities:historicalEntities,attachments:true}]});await projection.verify();
let server;const checks=[];const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const call=async(route,body,session)=>{const r=await fetch(origin+'/api/d1'+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});const type=r.headers.get('content-type')||'';return {status:r.status,data:type.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer()),cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};};
const fingerprint=async()=> (await owner.query("SELECT md5(string_agg(raw_json,'' ORDER BY entity,legacy_id)) records,(SELECT md5(string_agg(sha256,'' ORDER BY id)) FROM history.attachments) files FROM history.records")).rows[0];
try{
 const before=await fingerprint();server=createServer(auth,device,{identity,operationalHistory:projection});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18133,'127.0.0.1',resolve);});
 let login=await call('/login',{login:email,password});assert.equal(login.status,200);const session={cookie:login.cookie,csrf:login.data.csrf};assert.equal(login.data.operationalHistoryPreview,true);
 await check('server authentication and explicit import grant',async()=>{assert.equal((await call('/catalog/Employee')).status,401);const r=await call('/login',{login:'unauthorized-'+suffix+'@example.invalid',password});assert.equal((await call('/catalog/Employee',undefined,{cookie:r.cookie,csrf:r.data.csrf})).status,403);});
 await check('administrative module capabilities and disconnected social panel are server authorized',async()=>{
  assert.equal((await call('/modules/status')).status,401);
  const r=await call('/modules/status',undefined,session);assert.equal(r.status,200);assert.equal(r.data.historical,true);assert.equal(r.data.sources.Employee,true);assert.equal(r.data.sources.Warning,true);assert.equal(r.data.sources.Revenue,undefined);assert.equal(r.data.attendance,false);assert.equal(r.data.payrollPayments,false);assert.equal(r.data.purchaseReceipt,false);
  const social=await call('/social/snapshot',undefined,session);assert.equal(social.status,200);assert.equal(social.data.connected,false);assert.equal(social.data.sendingEnabled,false);assert.deepEqual(social.data.comments,[]);
  assert.equal((await call('/social/snapshot',{},session)).status,403);
  const u=await call('/login',{login:'unauthorized-'+suffix+'@example.invalid',password});assert.equal((await call('/modules/status',undefined,{cookie:u.cookie,csrf:u.data.csrf})).status,403);
  assert.ok((await call('/domain/Purchase',undefined,session)).status>=400);
 });
 const projected=new Map();
 await check('all 1186 imported records available through normal entity contracts',async()=>{let total=0;for(const entity of historicalEntities){const prefix=['Sector','JobRole'].includes(entity)?'/entities/':['Employee','InventoryItem','ExpenseCategory'].includes(entity)?'/catalog/':'/domain/';const r=await call(prefix+entity,undefined,session);assert.equal(r.status,200);const expected=(await owner.query('SELECT count(*)::int n FROM history.records WHERE entity=$1',[entity])).rows[0].n;assert.equal(r.data.records.length,expected);projected.set(entity,r.data.records);total+=r.data.records.length;}assert.equal(total,1186);assert.equal(projected.get('Employee').length,63);});
 await check('confirmed relationships use canonical IDs; missing reference remains flagged',async()=>{const all=new Map([...projected.values()].flat().map(r=>[r.id,r]));const refs=(await owner.query('SELECT * FROM history.references')).rows;let mapped=0,missing=0;for(const ref of refs){if(ref.target_id){assert.equal(all.get(ref.source_id)[ref.field],ref.target_id);assert.ok(all.has(ref.target_id));mapped++;}else if(ref.status==='missing'){assert.ok(all.get(ref.source_id)._missingReferences>0);missing++;}}assert.equal(mapped,382);assert.equal(missing,1);});
 await check('original financial numbers and stock quantities preserved',async()=>{for(const entity of historicalEntities){const originals=(await owner.query('SELECT id,payload FROM history.records WHERE entity=$1',[entity])).rows;const byId=new Map(projected.get(entity).map(r=>[r.id,r]));for(const row of originals)for(const key of ['amount','net_amount','gross_amount','current_stock','quantity','average_cost','last_cost'])if(key in row.payload)assert.deepEqual(byId.get(row.id)[key],row.payload[key]);}});
 await check('54 linked attachments authorized and SHA256 verified; five quarantined refused',async()=>{const files=(await owner.query('SELECT id,state,sha256 FROM history.attachments ORDER BY id')).rows;let linked=0,quarantine=0;for(const file of files){const r=await call('/migrated/attachments/'+file.id+'/download',undefined,session);if(file.state==='linked'){assert.equal(r.status,200);assert.equal(createHash('sha256').update(r.data).digest('hex'),file.sha256);linked++;}else{assert.equal(r.status,404);quarantine++;}}assert.equal(linked,54);assert.equal(quarantine,5);});
 await check('direct commands cannot replay payment or stock effects',async()=>{for(const route of ['/domain/command','/operations/command','/catalog/Employee/'+randomUUID(),'/sync-now'])assert.equal((await call(route,{operation:'create',operationId:randomUUID()},session)).status,403);assert.equal((await owner.query('SELECT (SELECT count(*) FROM d1_stock_movements)+(SELECT count(*) FROM d1_financial_entries)+(SELECT count(*) FROM lab_outbox) n')).rows[0].n,'0');});
 await check('database reader has no writes',async()=>{assert.equal((await reader.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');await assert.rejects(()=>reader.query("UPDATE history.records SET raw_json=raw_json WHERE false"),e=>['25006','42501'].includes(e.code));});
 await check('HTTP restart preserves login and imported count',async()=>{await new Promise(r=>server.close(r));server=createServer(auth,device,{identity,operationalHistory:projection});await new Promise(r=>server.listen(18133,'127.0.0.1',r));assert.equal((await call('/catalog/Employee',undefined,session)).data.records.length,63);assert.deepEqual(await fingerprint(),before);});
 if(process.env.RUY_OPERATIONAL_ELECTRON_EXE)await check('development Electron normal screens display recovered data',async()=>{
  const employee=projected.get('Employee').find(r=>r.status!=='inativo'&&projected.get('EmployeePayment').some(p=>p.employee_id===r.id&&p.proof_url)),sector=projected.get('Sector')[0],item=projected.get('InventoryItem')[0];assert.ok(employee);
  const file=path.join(root,'screen-ui-'+suffix+'.dpapi');await seal(file,{purpose:'ISOLATED_OPERATIONAL_SCREEN_TEST',suffix,email,password,employeeId:employee.id,employeeName:employee.name,sectorName:sector.name,itemName:item.name});
  const env={...process.env,RUY_OPERATIONAL_UI_CONTEXT:file};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const p=spawn(process.env.RUY_OPERATIONAL_ELECTRON_EXE,['desktop/operational-screen-smoke.mjs'],{cwd:process.cwd(),windowsHide:true,env,stdio:'ignore'});p.once('error',reject);p.once('exit',resolve);});
  const proof=JSON.parse(await fs.readFile(path.join(root,'screen-ui-'+suffix+'.json'),'utf8'));assert.equal(proof.passed,true,'REAL_NORMAL_SCREEN_UI_PROOF_REQUIRED');assert.deepEqual(await fingerprint(),before);
 });
 await seal(path.join(root,'screen-context-'+suffix+'.dpapi'),{authConfig:{...authOwnerConfig,database:authDatabase},readConfig,userId,unauthorizedId,device,password,email});
 await fs.writeFile(path.join(root,'screen-report-'+suffix+'.json'),JSON.stringify({passed:true,checks,records:1186,linked:54,quarantine:5,sourceUnchanged:true,syntheticBusinessRecords:0,emailSent:false,installedR4Touched:false},null,2),{flag:'wx'});
 console.log(JSON.stringify({passed:checks.length,records:1186,linked:54,quarantine:5,sourceUnchanged:true,emailSent:false}));
}catch(e){console.error(JSON.stringify({passed:checks.length,failed:1,code:e.code||e.status||'ASSERTION_FAILED',lastPassed:checks.at(-1)}));process.exitCode=1;}
finally{if(server?.listening)await new Promise(r=>server.close(r));await auth.end();await reader.end();await owner.end();}
