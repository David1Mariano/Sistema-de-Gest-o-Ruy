import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
import {createFixture} from './rc-fixture.mjs';
import {digest} from '../../server/d1-lab/core.mjs';
import {createStockItem,operationalCommand} from '../../server/d1-lab/operations.mjs';
import {domainCommand,domainPreview} from '../../server/d1-lab/domain.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {createD1Central} from '../../server/sync-lab/d1-server.mjs';

// Only the marked clone is permitted, including the central and restored databases.
export async function runStage2(restart){
 assert.equal(process.env.RUY_D1_RESTART_FIXTURE,'e5aaec701010f607');
 const fixture=await createFixture(),results=[];
 const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
 const schemas=['schema','entities','catalog','sync','operations','domain','attachments','business'].map(n=>'d1-lab/'+n+'.sql');
 const A=await fixture.database('local',schemas),B=await fixture.database('local',schemas);
 const C=await fixture.database('local',['sync-lab/d1-central.sql','sync-lab/business.sql']);
 const workspace=randomUUID(),actorA=randomUUID(),actorB=randomUUID(),deviceA=randomUUID(),deviceB=randomUUID();
 const tokenA=randomBytes(32).toString('hex'),tokenB=randomBytes(32).toString('hex');
 const user={id:actorA,role:'admin'},raw=randomUUID(),second=randomUUID();
 const tables=['d2_catalog','d1_stock_balances','d1_stock_movements','d1_operation_events','lab_outbox','lab_audit','d1_sync_queue','d1_sync_versions','d1_sync_shadow','d1_sync_binding','d1_business_local','d1_local_reversals','d1_reconciliation','d1_central_records','d1_central_receipts','d1_central_changes','d1_central_clock','d1_business_stock','d1_business_movements','d1_business_reversals'];
 const snapshot=async pool=>{
  const value={};for(const table of tables){if((await pool.query('SELECT to_regclass($1) AS t',['public.'+table])).rows[0].t)value[table]=(await pool.query(`SELECT to_jsonb(t) AS r FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;}
  return value;
 };
 const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const balance=async(item=raw)=>{const r=await A.pool.query('SELECT * FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2',[actorA,item]);return r.rows[0];};
 const op=body=>operationalCommand(A.pool,user,deviceA,{operationId:randomUUID(),...body});
 const save=(entity,id,data)=>({operationId:randomUUID(),entity,id,baseVersion:null,action:'save',data});
 let server,closed=false;
 try{
  for(const [local,actor,device,token] of [[A,actorA,deviceA,tokenA],[B,actorB,deviceB,tokenB]]){
   await local.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);
   await local.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,'synthetic-disabled-login','admin')",[actor,actor+'@example.invalid']);
   await local.pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actor,device,workspace]);
   await C.pool.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),device,actor,workspace]);
  }
  server=createD1Central(C.pool,{business:true});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const request=async(token,route,body)=>{
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/d1'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
   const value=await response.json();if(!response.ok)throw Object.assign(Error('Synthetic stage2 request refused'),{status:response.status});return value;
  };
  const syncA=()=>synchronizeD1(A.pool,actorA,{token:tokenA,request});
  const syncB=()=>synchronizeD1(B.pool,actorB,{token:tokenB,request});
  const syncBoth=async()=>{for(const sync of [syncA,syncB,syncA]){const s=await sync();assert.equal(s.lastError,null);assert.equal(s.pending,0);assert.equal(s.conflicts,0);}};
  await check('01 stock opening and entry calculate integer weighted cost',async()=>{
   for(const [item,name] of [[raw,'raw'],[second,'second']])await createStockItem(A.pool,user,deviceA,{operationId:randomUUID(),itemId:item,data:{name:'FICTICIO stage2 '+name,status:'ativo',unit:'kg',minimum_stock:0},initialMilli:10000,unitCents:250});
   await op({kind:'entry',itemId:raw,baseVersion:1,quantityMilli:10000,unitCents:350});
   assert.equal((await balance()).quantity_milli,'20000');assert.equal((await balance()).average_cents,'300');
  });
  await check('02 exit replay is exact; UUID collision and insufficient stock roll back',async()=>{
   const command={operationId:randomUUID(),kind:'exit',itemId:raw,baseVersion:2,quantityMilli:1000};
   await operationalCommand(A.pool,user,deviceA,command);assert.equal((await operationalCommand(A.pool,user,deviceA,command)).replay,true);
   const before=await snapshot(A.pool);
   await assert.rejects(operationalCommand(A.pool,user,deviceA,{...command,quantityMilli:1001}),e=>e.status===409);
   await assert.rejects(op({kind:'exit',itemId:raw,baseVersion:3,quantityMilli:999999}),e=>e.status===409);
   assert.deepEqual(await snapshot(A.pool),before);assert.equal((await balance()).quantity_milli,'19000');
  });
  await check('03 second-input failure rolls back first debit, event, outbox and audit',async()=>{
   const before=await snapshot(A.pool);
   await assert.rejects(op({kind:'consume',inputs:[{itemId:raw,baseVersion:3,quantityMilli:500},{itemId:second,baseVersion:1,quantityMilli:999999}]}),e=>e.status===409);
   assert.deepEqual(await snapshot(A.pool),before);
  });
  await check('04 failure after ledger and audit writes rolls back the entire local transaction',async()=>{
   const before=await snapshot(A.pool);
   await assert.rejects(operationalCommand(A.pool,user,deviceA,{operationId:randomUUID(),kind:'entry',itemId:raw,baseVersion:3,quantityMilli:500,unitCents:300},()=>{throw Error('FICTICIO injected precommit failure');}),/injected precommit/);
   assert.deepEqual(await snapshot(A.pool),before);
  });
  const product=randomUUID(),order=randomUUID(),daily=randomUUID();let confirm,cancel;
  await check('05 draft and proportional preview do not consume stock; losses are validated',async()=>{
   await domainCommand(A.pool,user,deviceA,save('ProductionProduct',product,{name:'FICTICIO stage2 recipe',yield_quantity:10,yield_unit:'un',status:'ativo',ingredients:[{inventory_item_id:raw,quantity:2},{inventory_item_id:second,quantity:1}]}));
   await domainCommand(A.pool,user,deviceA,save('ProductionOrder',order,{date:'2026-10-19',product_id:product,planned_quantity:10,status:'planejada',unit:'un'}));
   const data={date:'2026-10-19',product_id:product,production_order_id:order,produced_quantity:10,loss_quantity:1,leftover_quantity:0,losses:[{quantity:1,reason:'FICTICIO loss',responsible:'FICTICIO operator',date:'2026-10-19',unit:'un'}],unit:'un'};
   const before=await snapshot(A.pool);await assert.rejects(domainCommand(A.pool,user,deviceA,save('DailyProduction',daily,{...data,loss_quantity:20})),e=>e.status===400);assert.deepEqual(await snapshot(A.pool),before);
   await domainCommand(A.pool,user,deviceA,save('DailyProduction',daily,data));
   const snapshotBeforePreview=await snapshot(A.pool),preview=await domainPreview(A.pool,user,daily);
   assert.deepEqual(preview.inputs.map(i=>i.quantityMilli).sort((a,b)=>a-b),[1000,2000]);assert.deepEqual(await snapshot(A.pool),snapshotBeforePreview);
   assert.equal((await balance()).quantity_milli,'19000');
   const row=(await A.pool.query('SELECT data FROM d2_catalog WHERE id=$1',[order])).rows[0].data;assert.notEqual(row.status,'concluida');
   confirm={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:1,action:'confirm',token:preview.token};
  });
  await check('06 confirmation aggregate rollback, atomic debit, replay and duplicate rejection',async()=>{
   const before=await snapshot(A.pool);await assert.rejects(domainCommand(A.pool,user,deviceA,confirm,()=>{throw Error('FICTICIO aggregate crash');}),/aggregate crash/);assert.deepEqual(await snapshot(A.pool),before);
   await domainCommand(A.pool,user,deviceA,confirm);assert.equal((await domainCommand(A.pool,user,deviceA,confirm)).replay,true);
   assert.equal((await balance()).quantity_milli,'17000');assert.equal((await balance(second)).quantity_milli,'9000');
   assert.equal((await A.pool.query('SELECT data FROM d2_catalog WHERE id=$1',[order])).rows[0].data.status,'concluida');
   await assert.rejects(domainCommand(A.pool,user,deviceA,{...confirm,operationId:randomUUID(),baseVersion:2}),e=>e.status===409);
  });
  await check('07 cancellation restores consumption once and preserves loss history',async()=>{
   cancel={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:2,action:'cancel'};
   await domainCommand(A.pool,user,deviceA,cancel);assert.equal((await domainCommand(A.pool,user,deviceA,cancel)).replay,true);
   assert.equal((await balance()).quantity_milli,'19000');assert.equal((await balance(second)).quantity_milli,'10000');
   const record=JSON.parse((await A.pool.query('SELECT data FROM d2_catalog WHERE id=$1',[daily])).rows[0].data.payload_json);
   assert.equal(record.local_status,'cancelado');assert.equal(record.losses.length,1);
   await assert.rejects(domainCommand(A.pool,user,deviceA,{...cancel,operationId:randomUUID(),baseVersion:3}),e=>e.status===409);
  });
  await check('08 opposing ingredient order serializes; stale concurrent command cannot lose updates',async()=>{
   const versions=[Number((await balance()).version),Number((await balance(second)).version)];
   const inputs=[{itemId:raw,baseVersion:versions[0],quantityMilli:100},{itemId:second,baseVersion:versions[1],quantityMilli:100}];
   const outcomes=await Promise.allSettled([op({kind:'consume',inputs}),op({kind:'consume',inputs:[...inputs].reverse()})]);
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);
   assert.equal((await balance()).quantity_milli,'18900');assert.equal((await balance(second)).quantity_milli,'9900');
  });
  await check('09 offline and lost ACK resume the same UUID through real HTTP central receipts',async()=>{
   const offline=await synchronizeD1(A.pool,actorA,{token:tokenA,request:async()=>{throw Error('FICTICIO offline');}});assert.ok(offline.pending>0);
   let lost=false;await synchronizeD1(A.pool,actorA,{token:tokenA,request:async(...args)=>{const value=await request(...args);if(args[1]==='/push'&&!lost){lost=true;throw Error('FICTICIO lost ACK');}return value;}});assert.equal(lost,true);
   await syncBoth();const state=(await request(tokenB,'/changes?cursor=0')).business;assert.ok(state);
   const count=(await C.pool.query('SELECT count(*)::int n FROM d1_central_receipts')).rows[0].n;
   await syncBoth();assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_central_receipts')).rows[0].n,count);
   assert.equal((await C.pool.query('SELECT quantity FROM d1_business_stock WHERE item=$1',[raw])).rows[0].quantity,'18900');
  });
  await check('10 central second-input rejection rolls back ledger, cursor, records and receipt',async()=>{
   const stocks=(await C.pool.query('SELECT * FROM d1_business_stock')).rows,version=id=>Number(stocks.find(s=>s.item===id).version),operationId=randomUUID();
   const command={operationId,kind:'consume',inputs:[{itemId:raw,baseVersion:version(raw),quantityMilli:100},{itemId:second,baseVersion:version(second),quantityMilli:999999}]};
   const envelope={protocol:'D1LAB/1',operationId,deviceId:deviceA,actorId:actorA,workspaceId:workspace,changes:[{entity:'OperationalEvent',id:operationId,baseVersion:null,data:{name:'FICTICIO failing aggregate',kind:'consume',command_json:JSON.stringify(command),result_json:JSON.stringify({operationId,businessConfirmed:false,externalConfirmed:false}),status:'pending-central',source_device_id:deviceA}}]};
   const before=await snapshot(C.pool);await assert.rejects(request(tokenA,'/push',envelope),e=>e.status===409);assert.deepEqual(await snapshot(C.pool),before);
  });
  await check('11 server permissions and revoked device credentials prevent writes',async()=>{
   const before=await snapshot(A.pool);await A.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actorA]);
   await assert.rejects(op({kind:'entry',itemId:raw,baseVersion:Number((await balance()).version),quantityMilli:1,unitCents:300}),e=>e.status===403);
   await A.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actorA]);assert.deepEqual(await snapshot(A.pool),before);
   await C.pool.query('UPDATE d1_principals SET active=false WHERE token_hash=$1',[digest(tokenB)]);await assert.rejects(request(tokenB,'/changes?cursor=0'),e=>e.status===403);await C.pool.query('UPDATE d1_principals SET active=true WHERE token_hash=$1',[digest(tokenB)]);
  });
  await check('12 two simulated devices competing at the same stock version produce one central debit',async()=>{
   const versions=(await C.pool.query('SELECT item,version FROM d1_business_stock')).rows,version=Number(versions.find(s=>s.item===raw).version);
   const envelope=(actor,device,quantity)=>{const id=randomUUID(),command={operationId:id,kind:'exit',itemId:raw,baseVersion:version,quantityMilli:quantity};return {protocol:'D1LAB/1',operationId:id,actorId:actor,deviceId:device,workspaceId:workspace,changes:[{entity:'OperationalEvent',id,baseVersion:null,data:{name:'FICTICIO concurrent '+id,kind:'exit',command_json:JSON.stringify(command),result_json:JSON.stringify({operationId:id,businessConfirmed:false,externalConfirmed:false}),status:'pending-central',source_device_id:device}}]};};
   const envelopes=[envelope(actorA,deviceA,500),envelope(actorB,deviceB,700)],before=Number((await C.pool.query('SELECT quantity FROM d1_business_stock WHERE item=$1',[raw])).rows[0].quantity);
   const outcomes=await Promise.allSettled(envelopes.map((e,i)=>request(i?tokenB:tokenA,'/push',e)));
   const winner=outcomes.findIndex(r=>r.status==='fulfilled');assert.ok(winner>=0);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);assert.equal(outcomes[1-winner].reason.status,409);
   assert.equal(Number((await C.pool.query('SELECT quantity FROM d1_business_stock WHERE item=$1',[raw])).rows[0].quantity),before-(winner?700:500));
   const prior=await snapshot(C.pool);await request(winner?tokenB:tokenA,'/push',envelopes[winner]);assert.deepEqual(await snapshot(C.pool),prior);
   await syncBoth();
   const centralQuantity=(await C.pool.query('SELECT quantity FROM d1_business_stock WHERE item=$1',[raw])).rows[0].quantity;
   for(const [local,actor] of [[A,actorA],[B,actorB]])assert.equal((await local.pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2',[actor,raw])).rows[0].quantity_milli,centralQuantity);
   assert.equal((await C.pool.query('SELECT s.item FROM d1_business_stock s LEFT JOIN d1_business_movements m ON s.workspace=m.workspace AND s.item=m.item GROUP BY s.workspace,s.item,s.quantity HAVING s.quantity<>coalesce(sum(m.delta),0)')).rowCount,0);
   for(const operationId of [confirm.operationId,cancel.operationId]){
    assert.equal((await C.pool.query('SELECT 1 FROM d1_central_receipts WHERE operation_id=$1',[operationId])).rowCount,1);
    assert.ok((await A.pool.query('SELECT 1 FROM lab_audit WHERE operation_id=$1',[operationId])).rowCount>0);
   }
  });
  await check('13 encrypted backup restores local aggregate, ledger, queue and audit exactly',async()=>{
   const restored=await fixture.roundTrip(A);assert.deepEqual(await snapshot(restored.pool),await snapshot(A.pool));
  });
  const sources=[A,B,C],before=await Promise.all(sources.map(s=>snapshot(s.pool)));
  await new Promise(r=>server.close(r));server=null;await fixture.close();closed=true;
  await restart();
  const reopened=sources.map(s=>({...s,pool:new pg.Pool({...s.config,max:2})}));
  try{
   await check('14 controlled disposable PostgreSQL restart preserves all three database digests',async()=>{
    for(let i=0;i<reopened.length;i++){assert.equal((await reopened[i].pool.query('SELECT 1 AS n')).rows[0].n,1);assert.deepEqual(await snapshot(reopened[i].pool),before[i]);}
   });
   await check('15 post-restart encrypted backup and restore preserves central receipts and stock',async()=>{
    const post=await createFixture();try{const restored=await post.roundTrip(reopened[2]);assert.deepEqual(await snapshot(restored.pool),before[2]);}finally{await post.close();}
   });
   await check('16 post-restart HTTP receipt replay and D1 pull preserve central ledger',async()=>{
    server=createD1Central(reopened[2].pool,{business:true});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
    const envelope=(await reopened[0].pool.query('SELECT envelope FROM d1_sync_queue WHERE operation_id=$1',[confirm.operationId])).rows[0].envelope;
    await request(tokenA,'/push',envelope);assert.deepEqual(await snapshot(reopened[2].pool),before[2]);
    for(const [local,actor,token] of [[reopened[0],actorA,tokenA],[reopened[1],actorB,tokenB]]){const state=await synchronizeD1(local.pool,actor,{token,request});assert.equal(state.lastError,null);assert.equal(state.pending,0);assert.equal(state.conflicts,0);assert.equal(state.operationalSyncEnabled,false);}
    await new Promise(r=>server.close(r));server=null;
   });
  }finally{await Promise.all(reopened.map(s=>s.pool.end()));}
  return {checks:results.length,results,databasePorts:[...new Set(fixture.databases.map(d=>d.port))],digests:before.map(checksum),syntheticOnly:true,physicalWindows:false,networkFailureSimulated:true,postgresRestarted:true,shared55436Touched:false,operationalSyncEnabled:false};
 }finally{if(server)await new Promise(r=>server.close(r));if(!closed)await fixture.close();}
}
