import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes,X509Certificate} from 'node:crypto';
import {createFixture} from './rc-fixture.mjs';
import {digest} from '../../server/d1-lab/core.mjs';
import {createStockItem,operationalState} from '../../server/d1-lab/operations.mjs';
import {domainCommand,domainPreview} from '../../server/d1-lab/domain.mjs';
import {catalogSave} from '../../server/d1-lab/catalog.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {provisionTLS,provisionedRequest} from '../../server/d1-lab/tls-provision.mjs';
import {enqueueAttachment,transferAttachment,fetchAttachment,readCachedAttachment} from '../../server/d1-lab/attachment-transfer.mjs';
import {attachmentHash} from '../../server/d1-lab/attachment-contract.mjs';
import {createD1Central} from '../../server/sync-lab/d1-server.mjs';
import {createLocalServer} from '../../lab/c2-runtime/server/local/api.mjs';
import {createLabTransport} from '../../server/sync-lab/mtls-transport.mjs';
const fixture=await createFixture(),schemas=['schema','entities','catalog','sync','operations','domain','attachments'].map(name=>'d1-lab/'+name+'.sql');
const A=await fixture.database('local',schemas),B=await fixture.database('local',schemas),C=await fixture.database('central',['sync-lab/d1-central.sql','sync-lab/attachments.sql']);
const workspace=randomUUID(),actorA=randomUUID(),actorB=randomUUID(),deviceA=randomUUID(),deviceB=randomUUID(),tokenA=randomBytes(32).toString('hex'),tokenB=randomBytes(32).toString('hex');
const serverCert=await fixture.certificate('server'),clientA=await fixture.certificate('device-a'),clientB=await fixture.certificate('device-b');
for(const [local,actor,device,token] of [[A,actorA,deviceA,tokenA],[B,actorB,deviceB,tokenB]]){
 await local.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);
 await local.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,'synthetic-disabled-login','admin')",[actor,actor+'@example.invalid']);
 await local.pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actor,device,workspace]);
 await C.pool.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),device,actor,workspace]);
}
let central,gateway,tls;const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const close=server=>server?.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();
try{
 central=createD1Central(C.pool,{attachments:true});await listen(central,18094);
 gateway=createLocalServer(C.pool,{origin:'http://127.0.0.1:18092',d1BridgeOrigin:'http://127.0.0.1:18094'});await listen(gateway,18092);
 tls=createLabTransport({...serverCert,ca:clientA.cert+'\n'+clientB.cert,devices:[{fingerprint:new X509Certificate(clientA.cert).fingerprint256,token:tokenA},{fingerprint:new X509Certificate(clientB.cert).fingerprint256,token:tokenB}]}).server;
 await listen(tls,0);const endpoint='https://127.0.0.1:'+tls.address().port;
 for(const [local,actor,device,token,certificate] of [[A,actorA,deviceA,tokenA,clientA],[B,actorB,deviceB,tokenB,clientB]])await provisionTLS(local.pool,{...certificate,ca:serverCert.cert,endpoint,actorId:actor,deviceId:device,workspaceId:workspace,token});
 const bindingA={actor:actorA,device_id:deviceA,workspace_id:workspace},bindingB={actor:actorB,device_id:deviceB,workspace_id:workspace};
 const transportA=await provisionedRequest(bindingA),transportB=await provisionedRequest(bindingB);
 process.env.RUY_D1_MTLS_LAB='1';
 const employee=randomUUID();
 await catalogSave(A.pool,{id:actorA,role:'admin'},deviceA,'Employee',employee,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO RC Employee',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
 await check('provisioned DPAPI mTLS: D1 outbox through HTTPS gateway and SQL central to peer',async()=>{
  const a=await synchronizeD1(A.pool,actorA),b=await synchronizeD1(B.pool,actorB);assert.equal(a.pending,0);assert.equal(a.lastError,null);assert.equal(b.lastError,null);assert.equal((await B.pool.query('SELECT id FROM d1_records WHERE owner_id=$1 AND id=$2',[actorB,employee])).rowCount,1);
 });
 const bytes=Buffer.from('FICTICIO RC attachment with durable retry'),body={id:randomUUID(),operationId:randomUUID(),recordId:employee,recordVersion:1,entity:'Employee',filename:'FICTICIO-rc.txt',mediaType:'text/plain',sha256:attachmentHash(bytes),bytes:bytes.toString('base64')};
 await check('local attachment queue validates permission, version, size and integrity',async()=>{
  await assert.rejects(enqueueAttachment(A.pool,actorA,{...body,sha256:'0'.repeat(64)}),e=>e.status===400);
  await assert.rejects(enqueueAttachment(A.pool,actorA,{...body,filename:'../FICTICIO-secret.txt'}),e=>e.status===400);
  const oversize=Buffer.from('FICTICIO '+'x'.repeat(524288));await assert.rejects(enqueueAttachment(A.pool,actorA,{...body,bytes:oversize.toString('base64'),sha256:attachmentHash(oversize)}),e=>e.status===400);
  await assert.rejects(enqueueAttachment(A.pool,actorA,{...body,mediaType:'image/png'}),e=>e.status===400);
  await enqueueAttachment(A.pool,actorA,body);assert.equal((await enqueueAttachment(A.pool,actorA,body)).replay,true);
  await assert.rejects(enqueueAttachment(A.pool,actorA,{...body,filename:'FICTICIO-changed.txt'}),e=>e.status===409);
  await assert.rejects(enqueueAttachment(A.pool,actorA,{...body,id:randomUUID(),operationId:randomUUID(),recordVersion:9}),e=>e.status===409);
 });
 await check('offline upload leaves the same UUID pending with no central object',async()=>{
  await assert.rejects(transferAttachment(A.pool,actorA,body.id,{token:tokenA,request:async()=>{throw Error('FICTICIO offline');}}));
  assert.equal((await A.pool.query('SELECT state FROM d1_attachment_queue WHERE id=$1',[body.id])).rows[0].state,'pending');assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_attachment_objects')).rows[0].n,0);
 });
 await check('lost reply after central commit retries same UUID without duplicate bytes or audit',async()=>{
  await assert.rejects(transferAttachment(A.pool,actorA,body.id,{token:tokenA,request:async(...args)=>{await transportA.request(...args);throw Error('FICTICIO lost ACK');}}));
  assert.equal((await A.pool.query('SELECT state FROM d1_attachment_queue WHERE id=$1',[body.id])).rows[0].state,'pending');
  const receipt=await transferAttachment(A.pool,actorA,body.id,transportA);assert.equal(receipt.replay,true);
  assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_attachment_objects')).rows[0].n,1);assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_attachment_audit')).rows[0].n,1);
 });
 await check('peer download through mTLS verifies hash and persists an offline cache',async()=>{
  const result=await fetchAttachment(B.pool,actorB,body.id,transportB);assert.equal(result.sha256,body.sha256);assert.deepEqual(await readCachedAttachment(B.pool,actorB,body.id),bytes);
 });
 await check('server rejects viewer, revoked token, cross-workspace access and identity collisions',async()=>{
  for(const [column,value] of [['role','viewer'],['active',false],['workspace_id',randomUUID()]]){
   await C.pool.query('UPDATE d1_principals SET '+column+'=$2 WHERE token_hash=$1',[digest(tokenB),value]);
   await assert.rejects(transportB.request(tokenB,'/attachments/'+body.id),e=>e.status===403);
   await C.pool.query('UPDATE d1_principals SET '+column+'=$2 WHERE token_hash=$1',[digest(tokenB),column==='role'?'admin':column==='active'?true:workspace]);
  }
  await assert.rejects(transportA.request(tokenA,'/attachments/'+body.id,{...body,operationId:randomUUID()}),e=>e.status===409);
  await assert.rejects(transportA.request(tokenA,'/attachments/'+randomUUID(),{...body,id:randomUUID()}),e=>e.status===400);
 });
 await check('corrupt central bytes and corrupt local cache are denied, not served',async()=>{
  await C.pool.query('UPDATE d1_attachment_objects SET bytes=$1 WHERE id=$2',[Buffer.from('FICTICIO corrupt'),body.id]);await assert.rejects(transportA.request(tokenA,'/attachments/'+body.id),e=>e.status===503);await C.pool.query('UPDATE d1_attachment_objects SET bytes=$1 WHERE id=$2',[bytes,body.id]);
  await B.pool.query('UPDATE d1_attachment_cache SET bytes=$1 WHERE id=$2',[Buffer.from('FICTICIO corrupt'),body.id]);await assert.rejects(readCachedAttachment(B.pool,actorB,body.id),e=>e.status===503);await B.pool.query('UPDATE d1_attachment_cache SET bytes=$1 WHERE id=$2',[bytes,body.id]);
  await B.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actorB]);await assert.rejects(readCachedAttachment(B.pool,actorB,body.id),e=>e.status===403);await B.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actorB]);
 });
 await check('restart of owned central/gateway preserves attachment, receipt and downloaded cache',async()=>{
  await close(gateway);await close(central);central=createD1Central(C.pool,{attachments:true});await listen(central,18094);gateway=createLocalServer(C.pool,{origin:'http://127.0.0.1:18092',d1BridgeOrigin:'http://127.0.0.1:18094'});await listen(gateway,18092);
  assert.equal((await transportA.request(tokenA,'/attachments/'+body.id)).sha256,body.sha256);assert.deepEqual(await readCachedAttachment(B.pool,actorB,body.id),bytes);
 });
 await check('transactional inventory and production snapshots cross TLS; global balance stays unconfirmed',async()=>{
  const raw=randomUUID(),product=randomUUID(),daily=randomUUID(),user={id:actorA,role:'admin'};
  await createStockItem(A.pool,user,deviceA,{operationId:randomUUID(),itemId:raw,data:{name:'FICTICIO RC material',status:'ativo',unit:'kg',minimum_stock:0},initialMilli:10000,unitCents:250});
  const command=(entity,id,data)=>({operationId:randomUUID(),entity,id,baseVersion:null,action:'save',data});
  await domainCommand(A.pool,user,deviceA,command('ProductionProduct',product,{name:'FICTICIO RC recipe',yield_quantity:10,yield_unit:'un',status:'ativo',ingredients:[{inventory_item_id:raw,quantity:2}]}));
  await domainCommand(A.pool,user,deviceA,command('DailyProduction',daily,{date:'2026-10-17',product_id:product,produced_quantity:10,loss_quantity:0,leftover_quantity:0,losses:[],unit:'un'}));
  const preview=await domainPreview(A.pool,user,daily),confirm={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:1,action:'confirm',token:preview.token};
  await domainCommand(A.pool,user,deviceA,confirm);assert.equal((await domainCommand(A.pool,user,deviceA,confirm)).replay,true);
  const cancel={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:2,action:'cancel'};await domainCommand(A.pool,user,deviceA,cancel);assert.equal((await domainCommand(A.pool,user,deviceA,cancel)).replay,true);
  const status=await synchronizeD1(A.pool,actorA);await synchronizeD1(B.pool,actorB);assert.equal(status.lastError,null);assert.equal(status.pending,0);assert.ok(status.pendingBusiness>0);assert.equal(status.operationalSyncEnabled,false);
  const stockA=await operationalState(A.pool,user),stockB=await operationalState(B.pool,{id:actorB,role:'admin'});assert.equal(stockA.balances[0].quantity_milli,'10000');assert.equal(stockB.balances.length,0);assert.equal(stockB.businessConfirmed,false);
  const snapshot=(await B.pool.query("SELECT data FROM d2_catalog WHERE owner_id=$1 AND id=$2",[actorB,daily])).rows[0];assert.equal(JSON.parse(snapshot.data.payload_json).local_status,'cancelado');
 });
 await check('financial aggregate crosses TLS atomically and concurrent edit preserves losing proposal',async()=>{
  const id=randomUUID(),a={id:actorA,role:'admin'},b={id:actorB,role:'admin'},data={description:'FICTICIO RC payment',date:'2026-10-17',amount:12.34,status:'pago',beneficiary_type:'colaborador',beneficiary_id:employee,payment_method:'dinheiro'};
  const command={operationId:randomUUID(),entity:'FinancialExpense',id,baseVersion:null,action:'save',data};
  await domainCommand(A.pool,a,deviceA,command);assert.equal((await domainCommand(A.pool,a,deviceA,command)).replay,true);await synchronizeD1(A.pool,actorA);await synchronizeD1(B.pool,actorB);
  const payment=(await B.pool.query("SELECT data FROM d2_catalog WHERE owner_id=$1 AND entity='EmployeePayment'",[actorB])).rows[0];assert.equal(JSON.parse(payment.data.payload_json).financial_expense_id,id);
  const before=(await A.pool.query('SELECT count(*)::int n FROM lab_outbox')).rows[0].n;
  await assert.rejects(domainCommand(A.pool,a,deviceA,{...command,operationId:randomUUID(),baseVersion:1,data:{...data,amount:99}},()=>{throw Error('FICTICIO transaction failure');}));assert.equal((await A.pool.query('SELECT count(*)::int n FROM lab_outbox')).rows[0].n,before);
  await domainCommand(A.pool,a,deviceA,{...command,operationId:randomUUID(),baseVersion:1,data:{...data,amount:14.01}});
  await domainCommand(B.pool,b,deviceB,{...command,operationId:randomUUID(),baseVersion:1,data:{...data,amount:13.37}});
  await synchronizeD1(A.pool,actorA);const statusB=await synchronizeD1(B.pool,actorB);assert.ok(statusB.conflicts>0);
  const central=(await C.pool.query('SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows[0];assert.equal(JSON.parse(central.data.payload_json).amount,14.01);
  const local=(await B.pool.query('SELECT data FROM d2_catalog WHERE owner_id=$1 AND id=$2',[actorB,id])).rows[0];assert.equal(JSON.parse(local.data.payload_json).amount,13.37);
 });
 await check('encrypted dumps restore queue, cache, bytes and receipt into fresh synthetic databases',async()=>{
  const restoredA=await fixture.roundTrip(A),restoredB=await fixture.roundTrip(B),restoredC=await fixture.roundTrip(C);
  assert.equal((await restoredA.pool.query('SELECT state FROM d1_attachment_queue WHERE id=$1',[body.id])).rows[0].state,'acknowledged');
  assert.deepEqual(await readCachedAttachment(restoredB.pool,actorB,body.id),bytes);
  const object=(await restoredC.pool.query('SELECT bytes,sha256 FROM d1_attachment_objects WHERE id=$1',[body.id])).rows[0];assert.deepEqual(object.bytes,bytes);assert.equal(object.sha256,body.sha256);
  assert.equal((await restoredC.pool.query('SELECT count(*)::int n FROM d1_attachment_receipts')).rows[0].n,1);
 });
 await check('local authenticated API enforces CSRF and cached attachment permissions',async()=>{
  if(process.env.RUY_D1_TEST_API_PORT!=='18091')throw Error('API acceptance requires auxiliary port 18091');
  process.env.RUY_D1_ATTACHMENTS_LAB='1';
  const {createServer}=await import('../../server/d1-lab/api.mjs'),local=createServer(B.pool,deviceB);await listen(local,18091);
  const session=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex'),url='http://127.0.0.1:18091/api/d1/attachments';
  await B.pool.query("INSERT INTO lab_sessions VALUES($1,$2,$3,now()+interval '1 hour')",[digest(session),actorB,csrf]);
  const headers={Origin:'http://127.0.0.1:18091',Cookie:'ruy_d1_lab='+session,'Content-Type':'application/json'};
  try{
   assert.equal((await fetch(url+'/'+body.id,{headers:{Origin:headers.Origin}})).status,401);
   const cached=await fetch(url+'/'+body.id,{headers});assert.equal(cached.status,200);assert.deepEqual(Buffer.from((await cached.json()).bytes,'base64'),bytes);
   assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,403);
   const large=Buffer.from('FICTICIO '+'x'.repeat(20000)),upload={...body,id:randomUUID(),operationId:randomUUID(),filename:'FICTICIO-large.txt',bytes:large.toString('base64'),sha256:attachmentHash(large)},authorized={...headers,'X-CSRF-Token':csrf};
   const queued=await fetch(url,{method:'POST',headers:authorized,body:JSON.stringify(upload)});assert.equal(queued.status,200);
   assert.equal((await fetch(url+'/'+upload.id+'/send',{method:'POST',headers:authorized,body:'{}'})).status,200);
   assert.equal((await fetch(url+'/'+upload.id+'/fetch',{method:'POST',headers:authorized,body:'{}'})).status,200);
   const received=await fetch(url+'/'+upload.id,{headers});assert.equal(received.status,200);assert.deepEqual(Buffer.from((await received.json()).bytes,'base64'),large);
   await B.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actorB]);assert.equal((await fetch(url+'/'+body.id,{headers})).status,403);
   await B.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actorB]);
  }finally{await close(local);delete process.env.RUY_D1_ATTACHMENTS_LAB;}
 });
 await fs.writeFile('logs/agente5-rc-transfer.json',JSON.stringify({checks:results.length,results,databases:fixture.databases,restartFixture:process.env.RUY_D1_RESTART_FIXTURE||null,syntheticOnly:true,tls:'1.3',provisionedWithDPAPI:true,physicalComputers:false,networkFailuresSimulated:true,productionChanged:false,operationalRelease:false,globalBalanceAppliedToPeer:false,encryptedBackupRestore:true},null,2));
 console.log('RC_TRANSFER_OK '+results.length);
}finally{delete process.env.RUY_D1_MTLS_LAB;await close(tls);await close(gateway);await close(central);await fixture.close();}
