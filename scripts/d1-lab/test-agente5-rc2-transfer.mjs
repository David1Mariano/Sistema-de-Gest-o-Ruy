import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes,X509Certificate} from 'node:crypto';
import {createFixture} from './rc-fixture.mjs';
import {digest} from '../../server/d1-lab/core.mjs';
import {createStockItem,operationalState,operationalCommand} from '../../server/d1-lab/operations.mjs';
import {domainCommand,domainPreview} from '../../server/d1-lab/domain.mjs';
import {catalogSave} from '../../server/d1-lab/catalog.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {provisionTLS,provisionedRequest} from '../../server/d1-lab/tls-provision.mjs';
import {enqueueAttachment,transferAttachment,fetchAttachment,readCachedAttachment} from '../../server/d1-lab/attachment-transfer.mjs';
import {attachmentHash} from '../../server/d1-lab/attachment-contract.mjs';
import {createD1Central} from '../../server/sync-lab/d1-server.mjs';
import {createLocalServer} from '../../lab/c2-runtime/server/local/api.mjs';
import {createLabTransport} from '../../server/sync-lab/mtls-transport.mjs';
const fixture=await createFixture(),schemas=['schema','entities','catalog','sync','operations','domain','attachments','business'].map(name=>'d1-lab/'+name+'.sql');
const A=await fixture.database('local',schemas),B=await fixture.database('local',schemas),C=await fixture.database('central',['sync-lab/d1-central.sql','sync-lab/attachments.sql','sync-lab/business.sql']);
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
 central=createD1Central(C.pool,{attachments:true,business:true});await listen(central,18094);
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
  const listing=await transportB.request(tokenB,'/attachments?record='+employee);assert.equal(listing.records[0].id,body.id);assert.equal('bytes' in listing.records[0],false);
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
  await close(gateway);await close(central);central=createD1Central(C.pool,{attachments:true,business:true});await listen(central,18094);gateway=createLocalServer(C.pool,{origin:'http://127.0.0.1:18092',d1BridgeOrigin:'http://127.0.0.1:18094'});await listen(gateway,18092);
  assert.equal((await transportA.request(tokenA,'/attachments/'+body.id)).sha256,body.sha256);assert.deepEqual(await readCachedAttachment(B.pool,actorB,body.id),bytes);
 });
 await check('transactional inventory and production snapshots cross TLS; authoritative balance reaches both peers',async()=>{
  const raw=randomUUID(),product=randomUUID(),daily=randomUUID(),user={id:actorA,role:'admin'};
  await createStockItem(A.pool,user,deviceA,{operationId:randomUUID(),itemId:raw,data:{name:'FICTICIO RC material',status:'ativo',unit:'kg',minimum_stock:0},initialMilli:10000,unitCents:250});
  const command=(entity,id,data)=>({operationId:randomUUID(),entity,id,baseVersion:null,action:'save',data});
  await domainCommand(A.pool,user,deviceA,command('ProductionProduct',product,{name:'FICTICIO RC recipe',yield_quantity:10,yield_unit:'un',status:'ativo',ingredients:[{inventory_item_id:raw,quantity:2}]}));
  await domainCommand(A.pool,user,deviceA,command('DailyProduction',daily,{date:'2026-10-17',product_id:product,produced_quantity:10,loss_quantity:0,leftover_quantity:0,losses:[],unit:'un'}));
  const preview=await domainPreview(A.pool,user,daily),confirm={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:1,action:'confirm',token:preview.token};
  await domainCommand(A.pool,user,deviceA,confirm);assert.equal((await domainCommand(A.pool,user,deviceA,confirm)).replay,true);
  const cancel={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:2,action:'cancel'};await domainCommand(A.pool,user,deviceA,cancel);assert.equal((await domainCommand(A.pool,user,deviceA,cancel)).replay,true);
  const status=await synchronizeD1(A.pool,actorA);await synchronizeD1(B.pool,actorB);assert.equal(status.lastError,null);assert.equal(status.pending,0);assert.equal(status.pendingBusiness,0);assert.equal(status.operationalSyncEnabled,false);
  const stockA=await operationalState(A.pool,user),stockB=await operationalState(B.pool,{id:actorB,role:'admin'});assert.equal(stockA.balances[0].quantity_milli,'10000');assert.equal(stockB.balances[0].quantity_milli,'10000');assert.equal(stockB.businessConfirmed,true);
  const snapshot=(await B.pool.query("SELECT data FROM d2_catalog WHERE owner_id=$1 AND id=$2",[actorB,daily])).rows[0];assert.equal(JSON.parse(snapshot.data.payload_json).local_status,'cancelado');
 });
 await check('funded financial settlement confirms once; paid changes and replay cannot debit twice',async()=>{
  const a={id:actorA,role:'admin'};
  await operationalCommand(A.pool,a,deviceA,{operationId:randomUUID(),kind:'journal',entries:[{account:'cash',cents:10000,baseVersion:0},{account:'equity',cents:-10000,baseVersion:0}]});await synchronizeD1(A.pool,actorA);await synchronizeD1(B.pool,actorB);
  const id=randomUUID(),data={description:'FICTICIO RC2 payment',date:'2026-10-17',amount:12.34,status:'pago',beneficiary_type:'colaborador',beneficiary_id:employee,payment_method:'dinheiro'},command={operationId:randomUUID(),entity:'FinancialExpense',id,baseVersion:null,action:'save',data};
  await domainCommand(A.pool,a,deviceA,command);assert.equal((await domainCommand(A.pool,a,deviceA,command)).replay,true);let status=await synchronizeD1(A.pool,actorA);await synchronizeD1(B.pool,actorB);assert.equal(status.businessConfirmed,true);
  const cash=(await B.pool.query("SELECT balance_cents FROM d1_financial_accounts WHERE owner_id=$1 AND account='cash'",[actorB])).rows[0];assert.equal(cash.balance_cents,'8766');
  const before=(await C.pool.query('SELECT count(*)::int n FROM d1_business_entries')).rows[0].n;
  await synchronizeD1(A.pool,actorA);assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_business_entries')).rows[0].n,before);
  await domainCommand(B.pool,{id:actorB,role:'admin'},deviceB,{...command,operationId:randomUUID(),baseVersion:1,data:{...data,amount:13.37}});status=await synchronizeD1(B.pool,actorB);assert.ok(status.conflicts>0);assert.equal(status.businessConfirmed,false);
  assert.equal((await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance,'8766');
 });
 await check('concurrent devices cannot consume the same authoritative stock; both proposals preserved',async()=>{
  const raw=(await A.pool.query("SELECT item_id,version FROM d1_stock_balances WHERE owner_id=$1",[actorA])).rows[0];
  const first={operationId:randomUUID(),kind:'exit',itemId:raw.item_id,baseVersion:Number(raw.version),quantityMilli:6000},second={...first,operationId:randomUUID(),quantityMilli:7000};
  await operationalCommand(A.pool,{id:actorA,role:'admin'},deviceA,first);await operationalCommand(B.pool,{id:actorB,role:'admin'},deviceB,second);
  let lost=true;const failed=await synchronizeD1(A.pool,actorA,{token:tokenA,request:async(...args)=>{const value=await transportA.request(...args);if(lost&&args[1]==='/push'&&args[2].operationId===first.operationId){lost=false;throw Error('FICTICIO lost business receipt');}return value;}});assert.equal(failed.pending,1);
  await synchronizeD1(A.pool,actorA);const statusB=await synchronizeD1(B.pool,actorB);assert.ok(statusB.conflicts>0);assert.equal(statusB.businessConfirmed,false);
  assert.equal((await C.pool.query('SELECT quantity FROM d1_business_stock WHERE workspace=$1 AND item=$2',[workspace,raw.item_id])).rows[0].quantity,'4000');
  assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_business_movements WHERE workspace=$1 AND operation=$2',[workspace,first.operationId])).rows[0].n,1);
  assert.equal((await B.pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2',[actorB,raw.item_id])).rows[0].quantity_milli,'3000');
  assert.equal((await B.pool.query('SELECT applied FROM d1_business_local WHERE actor=$1',[actorB])).rows[0].applied,false);
 });
 await check('different payment UUIDs for the same payroll obligation debit exactly once',async()=>{
  const data={employee_id:employee,payment_type:'salario',reference_start:'2026-10-01',reference_end:'2026-10-31',gross_amount:10,discount_amount:0,net_amount:10,payment_date:'2026-10-17',payment_method:'dinheiro',status:'pago'};
  await domainCommand(A.pool,{id:actorA,role:'admin'},deviceA,{operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'save',data});
  const a=await synchronizeD1(A.pool,actorA);assert.equal(a.businessConfirmed,true);
  const before=(await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance;
  await domainCommand(B.pool,{id:actorB,role:'admin'},deviceB,{operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'save',data});
  const b=await synchronizeD1(B.pool,actorB);assert.ok(b.conflicts>0);
  assert.equal((await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance,before);
  assert.equal((await C.pool.query("SELECT count(*)::int n FROM d1_business_settlements WHERE workspace=$1 AND obligation LIKE 'payroll:%'",[workspace])).rows[0].n,1);
 });
 await check('one payable cannot be settled twice even with fresh expense and operation UUIDs',async()=>{
  const id=randomUUID(),data={description:'FICTICIO payable RC2',due_date:'2026-10-31',amount:3,status:'pendente',beneficiary_type:'fornecedor',beneficiary_name:'FICTICIO Vendor'};
  await domainCommand(A.pool,{id:actorA,role:'admin'},deviceA,{operationId:randomUUID(),entity:'AccountsPayable',id,baseVersion:null,action:'save',data});await synchronizeD1(A.pool,actorA);await synchronizeD1(B.pool,actorB);
  const paid={...data,status:'pago',paid_date:'2026-10-17',payment_method_planned:'dinheiro'};
  await domainCommand(A.pool,{id:actorA,role:'admin'},deviceA,{operationId:randomUUID(),entity:'AccountsPayable',id,baseVersion:1,action:'save',data:paid});await synchronizeD1(A.pool,actorA);
  const row=(await C.pool.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows[0],payload=JSON.parse(row.data.payload_json),expense=(await C.pool.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,payload.financial_expense_id])).rows[0];
  const fakeExpense=randomUUID(),operationId=randomUUID(),before=(await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance;
  await assert.rejects(transportB.request(tokenB,'/push',{protocol:'D1LAB/1',operationId,deviceId:deviceB,actorId:actorB,workspaceId:workspace,changes:[{entity:'AccountsPayable',id,baseVersion:Number(row.version),data:{...row.data,payload_json:JSON.stringify({...payload,financial_expense_id:fakeExpense})}},{entity:'FinancialExpense',id:fakeExpense,baseVersion:null,data:{...expense.data,name:'FICTICIO duplicate payable '+fakeExpense}}]}),e=>e.status===409);
  assert.equal((await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance,before);assert.equal((await C.pool.query('SELECT 1 FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,fakeExpense])).rowCount,0);
 });
 await check('same supplier invoice with different UUIDs cannot create a second debit',async()=>{
  const data={description:'FICTICIO invoice RC2',date:'2026-10-17',amount:5,status:'pago',payment_method:'dinheiro',beneficiary_type:'fornecedor',beneficiary_name:'FICTICIO Vendor',document_number:'FICTICIO-NF-RC2'};
  await domainCommand(A.pool,{id:actorA,role:'admin'},deviceA,{operationId:randomUUID(),entity:'FinancialExpense',id:randomUUID(),baseVersion:null,action:'save',data});const a=await synchronizeD1(A.pool,actorA);assert.equal(a.businessConfirmed,true);
  const before=(await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance;
  const duplicate={operationId:randomUUID(),entity:'FinancialExpense',id:randomUUID(),baseVersion:null,action:'save',data};await domainCommand(B.pool,{id:actorB,role:'admin'},deviceB,duplicate);await synchronizeD1(B.pool,actorB);
  assert.equal((await B.pool.query('SELECT state FROM d1_sync_queue WHERE operation_id=$1',[duplicate.operationId])).rows[0].state,'conflict');assert.equal((await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance,before);
 });
 await check('corrupt business projection rolls back locally and clean retry recovers',async()=>{
  const before=(await A.pool.query('SELECT state FROM d1_business_local WHERE actor=$1',[actorA])).rows[0].state;
  const failed=await synchronizeD1(A.pool,actorA,{token:tokenA,request:async(...args)=>{const value=await transportA.request(...args);if(args[1].startsWith('/changes'))value.business.accounts[0].balance=String(Number(value.business.accounts[0].balance)+1);return value;}});
  assert.ok(failed.lastError);assert.equal(failed.businessConfirmed,false);assert.deepEqual((await A.pool.query('SELECT state FROM d1_business_local WHERE actor=$1',[actorA])).rows[0].state,before);
  const recovered=await synchronizeD1(A.pool,actorA);assert.equal(recovered.lastError,null);assert.equal(recovered.businessConfirmed,true);
 });
 await check('central rollback preserves stock, cursor and receipt on invalid multi-effect production',async()=>{
  const raw=(await C.pool.query('SELECT item,version,quantity FROM d1_business_stock WHERE workspace=$1',[workspace])).rows[0],operationId=randomUUID();
  const input={operationId,kind:'production',inputs:[{itemId:raw.item,baseVersion:Number(raw.version),quantityMilli:100}],output:{itemId:raw.item,baseVersion:Number(raw.version),quantityMilli:100}};
  const data={name:'FICTICIO invalid aggregate '+operationId,kind:'production',command_json:JSON.stringify(input),result_json:JSON.stringify({operationId,businessConfirmed:false,externalConfirmed:false}),status:'pending-central',source_device_id:deviceA};
  const command={protocol:'D1LAB/1',operationId,actorId:actorA,deviceId:deviceA,workspaceId:workspace,changes:[{entity:'OperationalEvent',id:operationId,baseVersion:null,data}]};
  const before=(await C.pool.query('SELECT cursor FROM d1_central_clock WHERE singleton')).rows[0].cursor;
  await assert.rejects(transportA.request(tokenA,'/push',command),e=>e.status===400);
  assert.equal((await C.pool.query('SELECT quantity FROM d1_business_stock WHERE workspace=$1 AND item=$2',[workspace,raw.item])).rows[0].quantity,raw.quantity);assert.equal((await C.pool.query('SELECT cursor FROM d1_central_clock WHERE singleton')).rows[0].cursor,before);
  assert.equal((await C.pool.query('SELECT 1 FROM d1_central_receipts WHERE operation_id=$1',[operationId])).rowCount,0);
 });
 await check('unpaired paid document and insufficient global funds cannot create a settlement',async()=>{
  const id=randomUUID(),operationId=randomUUID(),data={name:'FICTICIO unpaired payroll '+id,status:'pago',payload_json:JSON.stringify({employee_id:employee,payment_type:'outros',gross_amount:5,discount_amount:0,net_amount:5,payment_date:'2026-10-17',status:'pago'})};
  await assert.rejects(transportA.request(tokenA,'/push',{protocol:'D1LAB/1',operationId,actorId:actorA,deviceId:deviceA,workspaceId:workspace,changes:[{entity:'EmployeePayment',id,baseVersion:null,data}]}),e=>e.status===409);
  assert.equal((await C.pool.query('SELECT 1 FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,id])).rowCount,0);
  const before=(await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance;
  const payment={operationId:randomUUID(),entity:'FinancialExpense',id:randomUUID(),baseVersion:null,action:'save',data:{description:'FICTICIO insufficient funds',date:'2026-10-17',amount:9999,status:'pago',payment_method:'dinheiro'}};
  await domainCommand(A.pool,{id:actorA,role:'admin'},deviceA,payment);const result=await synchronizeD1(A.pool,actorA);assert.ok(result.conflicts>0);assert.equal(result.businessConfirmed,false);
  assert.equal((await C.pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance,before);
  assert.equal((await C.pool.query('SELECT 1 FROM d1_business_settlements WHERE workspace=$1 AND record_id=$2',[workspace,payment.id])).rowCount,0);
 });
 await check('encrypted dumps restore queue, cache, bytes and receipt into fresh synthetic databases',async()=>{
  const restoredA=await fixture.roundTrip(A),restoredB=await fixture.roundTrip(B),restoredC=await fixture.roundTrip(C);
  assert.equal((await restoredA.pool.query('SELECT state FROM d1_attachment_queue WHERE id=$1',[body.id])).rows[0].state,'acknowledged');
  assert.deepEqual(await readCachedAttachment(restoredB.pool,actorB,body.id),bytes);
  const object=(await restoredC.pool.query('SELECT bytes,sha256 FROM d1_attachment_objects WHERE id=$1',[body.id])).rows[0];assert.deepEqual(object.bytes,bytes);assert.equal(object.sha256,body.sha256);
  assert.equal((await restoredC.pool.query('SELECT count(*)::int n FROM d1_attachment_receipts')).rows[0].n,1);
  for(const table of ['d1_business_stock','d1_business_accounts','d1_business_movements','d1_business_entries','d1_business_settlements'])assert.deepEqual((await restoredC.pool.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows,(await C.pool.query('SELECT to_jsonb(t) AS row FROM '+table+' t ORDER BY to_jsonb(t)::text')).rows);
  assert.deepEqual((await restoredB.pool.query('SELECT state,applied FROM d1_business_local WHERE actor=$1',[actorB])).rows,(await B.pool.query('SELECT state,applied FROM d1_business_local WHERE actor=$1',[actorB])).rows);

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
   const manifest=await fetch(url+'/remote?record='+employee,{headers});assert.equal(manifest.status,200);assert.equal((await manifest.json()).records[0].id,body.id);
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
 await fs.writeFile('logs/agente5-rc2-transfer.json',JSON.stringify({checks:results.length,results,databases:fixture.databases,restartFixture:process.env.RUY_D1_RESTART_FIXTURE||null,syntheticOnly:true,tls:'1.3',provisionedWithDPAPI:true,physicalComputers:false,networkFailuresSimulated:true,productionChanged:false,operationalRelease:false,globalBalanceAppliedToPeer:true,encryptedBackupRestore:true},null,2));
 console.log('RC2_TRANSFER_OK '+results.length);
}finally{delete process.env.RUY_D1_MTLS_LAB;await close(tls);await close(gateway);await close(central);await fixture.close();}
