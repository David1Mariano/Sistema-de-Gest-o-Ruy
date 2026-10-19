import assert from 'node:assert/strict';
import {randomUUID,randomBytes,X509Certificate} from 'node:crypto';
import {fork} from 'node:child_process';
import {createFixture} from './rc-fixture.mjs';
import {digest,hashPassword} from '../../server/d1-lab/core.mjs';
import {catalogSave} from '../../server/d1-lab/catalog.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {provisionTLS,provisionedRequest} from '../../server/d1-lab/tls-provision.mjs';
import {transferAttachment,fetchAttachment,readCachedAttachment} from '../../server/d1-lab/attachment-transfer.mjs';
import {createD1Central} from '../../server/sync-lab/d1-server.mjs';
import {createLabTransport,sendLabTLS} from '../../server/sync-lab/mtls-transport.mjs';
import {createLocalServer} from '../../lab/c2-runtime/server/local/api.mjs';
import {attachmentSamples,attachmentBody} from './stage3-attachment-samples.mjs';

export async function runStage3(){
 assert.equal(process.env.RUY_D1_ALLOW_TESTS,'1');assert.equal(process.env.RUY_D1_RESTART_FIXTURE,'e5aaec701010f607');
 const fixture=await createFixture(),results=[];
 const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
 const schemas=['schema','entities','catalog','sync','operations','domain','attachments','business'].map(n=>'d1-lab/'+n+'.sql');
 const A=await fixture.database('local',schemas),B=await fixture.database('local',schemas),C=await fixture.database('local',['sync-lab/d1-central.sql','sync-lab/attachments.sql','sync-lab/business.sql']);
 assert.ok(fixture.databases.every(d=>d.port===55437));
 const actorA=randomUUID(),actorB=randomUUID(),deviceA=randomUUID(),deviceB=randomUUID(),workspace=randomUUID(),other=randomUUID();
 const tokenA=randomBytes(32).toString('hex'),tokenB=randomBytes(32).toString('hex'),password=randomBytes(32).toString('hex'),recordId=randomUUID();
 const serverCert=await fixture.certificate('stage3-server'),clientA=await fixture.certificate('stage3-a'),clientB=await fixture.certificate('stage3-b');
 let central,gateway,tls,worker,session;
 const listen=(s,p)=>new Promise((r,j)=>{s.once('error',j);s.listen(p,'127.0.0.1',r);});
 const close=s=>s?.listening?new Promise(r=>s.close(r)):Promise.resolve();
 const startWorker=async()=>{
  worker=fork(new URL('./stage3-api-worker.mjs',import.meta.url),[],{windowsHide:true,stdio:['ignore','inherit','inherit','ipc'],env:{...process.env,RUY_D1_TEST_API_PORT:'18091',RUY_D1_ATTACHMENTS_LAB:'1'}});
  await new Promise((r,j)=>{const onExit=()=>j(Error('Auxiliary API exited before readiness'));worker.once('exit',onExit);worker.once('error',j);worker.once('message',m=>{worker.removeListener('exit',onExit);m.ready?r():j(Error('Auxiliary API refused synthetic fixture'));});worker.send({action:'start',config:A.config,deviceId:deviceA});});
 };
 const stopWorker=async()=>{if(worker&&worker.exitCode===null){const p=worker;await new Promise((r,j)=>{p.once('exit',code=>code===0?r():j(Error('Auxiliary API normal shutdown failed')));if(p.connected)p.send({action:'stop'});});}worker=null;};
 const origin='http://127.0.0.1:18091';
 const api=async(route,body,options={})=>{
  const r=await fetch(origin+'/api/d1'+route,{method:body?'POST':'GET',signal:AbortSignal.timeout(15000),headers:{Origin:options.origin||origin,'Content-Type':'application/json',Cookie:options.cookie??session?.cookie??'','X-CSRF-Token':options.csrf??session?.csrf??''},body:body?JSON.stringify(body):undefined});
  const binary=route.endsWith('/download')&&r.ok;return {status:r.status,headers:r.headers,value:binary?Buffer.from(await r.arrayBuffer()):await r.json()};
 };
 const login=async(actor=actorA)=>{const r=await api('/login',{login:actor+'@example.invalid',password});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.value.csrf};};
 const fileTables=['d1_attachment_queue','d1_attachment_cache','d1_attachment_objects','d1_attachment_receipts','d1_attachment_audit'];
 const snapshot=async pool=>{const value={};for(const t of fileTables)if((await pool.query('SELECT to_regclass($1) AS t',['public.'+t])).rows[0].t)value[t]=(await pool.query(`SELECT to_jsonb(r) AS r FROM ${t} r ORDER BY to_jsonb(r)::text`)).rows;return value;};
 try{
  const passwordHash=await hashPassword(password);
  for(const [local,actor,device,token] of [[A,actorA,deviceA,tokenA],[B,actorB,deviceB,tokenB]]){
   await local.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);
   await local.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',passwordHash]);
   await local.pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actor,device,workspace]);
   await C.pool.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),device,actor,workspace]);
  }
  await A.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[other,other+'@example.invalid',passwordHash]);
  central=createD1Central(C.pool,{attachments:true,business:true});await listen(central,18094);
  gateway=createLocalServer(C.pool,{origin:'http://127.0.0.1:18092',d1BridgeOrigin:'http://127.0.0.1:18094'});await listen(gateway,18092);
  tls=createLabTransport({...serverCert,ca:clientA.cert+'\n'+clientB.cert,devices:[{fingerprint:new X509Certificate(clientA.cert).fingerprint256,token:tokenA},{fingerprint:new X509Certificate(clientB.cert).fingerprint256,token:tokenB}]}).server;await listen(tls,0);
  const endpoint='https://127.0.0.1:'+tls.address().port;
  for(const [local,actor,device,token,cert] of [[A,actorA,deviceA,tokenA,clientA],[B,actorB,deviceB,tokenB,clientB]])await provisionTLS(local.pool,{...cert,ca:serverCert.cert,endpoint,actorId:actor,deviceId:device,workspaceId:workspace,token});
  const transportA=await provisionedRequest({actor:actorA,device_id:deviceA,workspace_id:workspace}),transportB=await provisionedRequest({actor:actorB,device_id:deviceB,workspace_id:workspace});
  await catalogSave(A.pool,{id:actorA,role:'admin'},deviceA,'Employee',recordId,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO stage3 employee',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
  for(const [local,actor,transport] of [[A,actorA,transportA],[B,actorB,transportB]])assert.equal((await synchronizeD1(local.pool,actor,transport)).lastError,null);
  await startWorker();session=await login();const bytes=Buffer.from('FICTICIO stage3 durable attachment'),body=attachmentBody(bytes,{recordId});
  await check('01 actual D1 API rejects missing session, CSRF, origin, owner and viewer',async()=>{
   const before=await snapshot(A.pool);assert.equal((await api('/attachments',body,{cookie:''})).status,401);assert.equal((await api('/attachments',body,{csrf:'wrong'})).status,403);assert.equal((await api('/attachments',body,{origin:'https://example.invalid'})).status,403);
   const otherSession=await login(other);assert.equal((await api('/attachments',body,otherSession)).status,403);
   await A.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actorA]);assert.equal((await api('/attachments',body)).status,403);await A.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actorA]);assert.deepEqual(await snapshot(A.pool),before);
  });
  await check('02 authorized upload queue, exact replay, collision and entity/version validation',async()=>{
   assert.equal((await api('/attachments',body)).status,200);assert.equal((await api('/attachments',body)).value.replay,true);
   assert.equal((await api('/attachments',{...body,filename:'FICTICIO-changed.txt'})).status,409);
   assert.equal((await api('/attachments',attachmentBody(bytes,{recordId,entity:'DeliveryOrder'}))).status,400);
   assert.equal((await api('/attachments',attachmentBody(bytes,{recordId,recordVersion:999}))).status,409);
   assert.equal((await A.pool.query('SELECT count(*)::int n FROM d1_attachment_queue')).rows[0].n,1);
  });
  await check('03 local HTTP download verifies SHA and safe non-cacheable attachment headers',async()=>{
   const r=await api('/attachments/'+body.id+'/download');assert.equal(r.status,200);assert.deepEqual(r.value,bytes);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-disposition'),/^attachment;/);assert.match(r.headers.get('content-security-policy'),/sandbox/);
   assert.equal((await api('/attachments')).value.records[0].id,body.id);assert.equal((await api('/attachments/'+body.id+'/download?token=FICTICIO')).status,404);
   const otherSession=await login(other);assert.equal((await api('/attachments/'+body.id+'/download',undefined,otherSession)).status,403);
  });
  await check('04 simulated offline transfer preserves pending UUID and no central bytes',async()=>{
   await assert.rejects(transferAttachment(A.pool,actorA,body.id,{token:tokenA,request:async()=>{throw Error('FICTICIO offline');}}));
   assert.equal((await A.pool.query('SELECT state FROM d1_attachment_queue WHERE id=$1',[body.id])).rows[0].state,'pending');assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_attachment_objects')).rows[0].n,0);
  });
  await check('05 real mTLS lost ACK retries same UUID without duplicate object receipt or audit',async()=>{
   await assert.rejects(transferAttachment(A.pool,actorA,body.id,{token:tokenA,request:async(...args)=>{await transportA.request(...args);throw Error('FICTICIO lost ACK');}}));
   const receipt=await api('/attachments/'+body.id+'/send',{});assert.equal(receipt.status,200);assert.equal(receipt.value.replay,true);
   await Promise.all([transportA.request(tokenA,'/attachments/'+body.id,body),transportA.request(tokenA,'/attachments/'+body.id,body)]);
   for(const table of ['d1_attachment_objects','d1_attachment_receipts','d1_attachment_audit'])assert.equal((await C.pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n,1);
  });
  await check('06 authorized peer lists and downloads over provisioned mTLS then reads offline cache',async()=>{
   assert.equal((await transportB.request(tokenB,'/attachments?record='+recordId)).records[0].id,body.id);
   await fetchAttachment(B.pool,actorB,body.id,transportB);assert.deepEqual(await readCachedAttachment(B.pool,actorB,body.id),bytes);
   assert.equal((await api('/attachments/'+body.id+'/fetch',{})).status,200);
  });
  await check('07 central access rejects foreign workspace viewer revoked token and mismatched certificate',async()=>{
   for(const [column,value,original] of [['workspace_id',randomUUID(),workspace],['role','viewer','admin'],['active',false,true]]){
    await C.pool.query('UPDATE d1_principals SET '+column+'=$2 WHERE token_hash=$1',[digest(tokenB),value]);
    await assert.rejects(transportB.request(tokenB,'/attachments/'+body.id),e=>e.status===403);
    const denied=attachmentBody(bytes,{recordId});await assert.rejects(transportB.request(tokenB,'/attachments/'+denied.id,denied),e=>e.status===403);
    await C.pool.query('UPDATE d1_principals SET '+column+'=$2 WHERE token_hash=$1',[digest(tokenB),original]);
   }
   const wrong=await sendLabTLS({...clientB,ca:serverCert.cert,token:tokenA,url:endpoint+'/api/local/d1/attachments/'+body.id});assert.equal(wrong.status,403);
  });
  await check('08 corrupted SQL object and cache are refused before content delivery',async()=>{
   await C.pool.query('UPDATE d1_attachment_objects SET bytes=$1 WHERE id=$2',[Buffer.from('FICTICIO corrupt'),body.id]);await assert.rejects(transportA.request(tokenA,'/attachments/'+body.id),e=>e.status===503);await C.pool.query('UPDATE d1_attachment_objects SET bytes=$1 WHERE id=$2',[bytes,body.id]);
   await A.pool.query('UPDATE d1_attachment_cache SET bytes=$1 WHERE id=$2',[Buffer.from('FICTICIO corrupt'),body.id]);assert.equal((await api('/attachments/'+body.id+'/download')).status,503);await A.pool.query('UPDATE d1_attachment_cache SET bytes=$1 WHERE id=$2',[bytes,body.id]);
   await B.pool.query("UPDATE lab_users SET active=false WHERE id=$1",[actorB]);await assert.rejects(readCachedAttachment(B.pool,actorB,body.id),e=>e.status===403);await B.pool.query("UPDATE lab_users SET active=true WHERE id=$1",[actorB]);
  });
  await check('09 matching-hash truncated PDF PNG JPEG rejected; complete structural uploads cross D1 C2',async()=>{
   for(const sample of attachmentSamples){
    const patch={recordId,filename:sample.filename,mediaType:sample.mediaType},bad=attachmentBody(sample.prefix,patch),good=attachmentBody(sample.bytes,patch);
    assert.equal((await api('/attachments',bad)).status,400);await assert.rejects(transportA.request(tokenA,'/attachments/'+bad.id,bad),e=>e.status===400);
    assert.equal((await api('/attachments',good)).status,200);assert.equal((await api('/attachments/'+good.id+'/send',{})).status,200);
    assert.equal((await api('/attachments/'+good.id+'/fetch',{})).status,200);assert.deepEqual((await api('/attachments/'+good.id+'/download')).value,sample.bytes);
   }
  });
  await check('10 session TTL logout and account revocation deny access without deleting retained bytes',async()=>{
   const before=await snapshot(A.pool);await A.pool.query("UPDATE lab_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[actorA]);assert.equal((await api('/attachments/'+body.id+'/download')).status,401);assert.equal((await api('/attachments',attachmentBody(bytes,{recordId}))).status,401);
   assert.deepEqual(await snapshot(A.pool),before);session=await login();await A.pool.query('UPDATE lab_users SET active=false WHERE id=$1',[actorA]);assert.equal((await api('/attachments/'+body.id+'/download')).status,401);await A.pool.query('UPDATE lab_users SET active=true WHERE id=$1',[actorA]);
   assert.equal((await api('/logout',{})).status,200);assert.equal((await api('/attachments/'+body.id+'/download')).status,401);session=await login();
  });
  await check('11 deleted reference revokes local and central reads even when bytes still exist',async()=>{
   await A.pool.query("UPDATE d1_records SET data=jsonb_set(data,'{_deleted}','\"true\"') WHERE id=$1",[recordId]);assert.equal((await api('/attachments/'+body.id+'/download')).status,403);assert.equal((await api('/attachments')).value.records.length,0);await A.pool.query("UPDATE d1_records SET data=data-'_deleted' WHERE id=$1",[recordId]);
   await C.pool.query("UPDATE d1_central_records SET data=jsonb_set(data,'{_deleted}','\"true\"') WHERE id=$1",[recordId]);await assert.rejects(transportA.request(tokenA,'/attachments/'+body.id),e=>e.status===403);await C.pool.query("UPDATE d1_central_records SET data=data-'_deleted' WHERE id=$1",[recordId]);
  });
  await check('12 real auxiliary API process normal restart preserves session queue cache and downloads',async()=>{
   const pid=worker.pid,before=await snapshot(A.pool);await stopWorker();await startWorker();assert.notEqual(worker.pid,pid);assert.deepEqual(await snapshot(A.pool),before);assert.deepEqual((await api('/attachments/'+body.id+'/download')).value,bytes);assert.equal((await api('/attachments/'+body.id+'/send',{})).status,200);
  });
  await check('13 encrypted SQL backups restore local queue cache and central objects receipts audit',async()=>{
   for(const source of [A,B,C]){const restored=await fixture.roundTrip(source);assert.deepEqual(await snapshot(restored.pool),await snapshot(source.pool));}
  });
  await check('14 existing D1 C2 contracts and business disabled flag survive attachment integration',async()=>{
   for(const [local,actor,transport] of [[A,actorA,transportA],[B,actorB,transportB]]){const state=await synchronizeD1(local.pool,actor,transport);assert.equal(state.lastError,null);assert.equal(state.operationalSyncEnabled,false);}
   const r=await api('/domain/command',{operationId:randomUUID(),entity:'DeliveryOrder',id:randomUUID(),baseVersion:null,action:'save',data:{name:'FICTICIO disabled'}});assert.ok(r.status>=400);
  });
  return {checks:results.length,results,databasePorts:[...new Set(fixture.databases.map(d=>d.port))],syntheticOnly:true,actualHttpAndMtls:true,apiProcessRestarted:true,physicalWindows:false,electronInstalledRestartTested:false,networkFailuresSimulated:true,retentionDeletionImplemented:false,operationalSyncEnabled:false};
 }finally{await stopWorker();await close(tls);await close(gateway);await close(central);await fixture.close();}
}
