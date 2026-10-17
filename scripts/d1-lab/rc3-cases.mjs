import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {digest} from '../../server/d1-lab/core.mjs';
import {catalogSave,catalogList} from '../../server/d1-lab/catalog.mjs';
import {domainCommand,domainPreview,domainList} from '../../server/d1-lab/domain.mjs';
import {createStockItem,operationalCommand,operationalState} from '../../server/d1-lab/operations.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {reconciliationPlan,reconcile} from '../../server/d1-lab/reconciliation.mjs';
import {createD1Central} from '../../server/sync-lab/d1-server.mjs';
export async function rc3Cases({fixture,centralPool,centralConfig,check}){
 const schemas=['schema','entities','catalog','sync','operations','domain','attachments','business'].map(n=>'d1-lab/'+n+'.sql');
 const A=await fixture.database('local',schemas),B=await fixture.database('local',schemas),workspace=randomUUID(),a=randomUUID(),b=randomUUID(),da=randomUUID(),db=randomUUID(),ta=randomBytes(32).toString('hex'),tb=randomBytes(32).toString('hex');
 for(const [local,actor,device,token] of [[A,a,da,ta],[B,b,db,tb]]){await local.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);await local.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,'disabled-synthetic-login','admin')",[actor,actor+'@example.invalid']);await local.pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actor,device,workspace]);await centralPool.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),device,actor,workspace]);}
 // Actual separate login, not SET ROLE through the owner connection.
 const role='ruy_rc3_service_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 await centralPool.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
 await centralPool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT CONNECT ON DATABASE ${centralConfig.database} TO ${role}; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
 await centralPool.query(`GRANT INSERT,UPDATE ON d1_central_records,d1_business_stock,d1_business_accounts TO ${role}; GRANT UPDATE ON d1_central_clock TO ${role}; GRANT INSERT ON d1_central_changes,d1_central_receipts,d1_business_movements,d1_business_entries,d1_business_settlements,d1_business_reversals,d1_attachment_objects,d1_attachment_receipts,d1_attachment_audit TO ${role}`);
 const service=new pg.Pool({...centralConfig,user:role,password,max:4}),server=createD1Central(service,{business:true,attachments:true});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
 const request=async(token,route,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/d1'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw Object.assign(Error('Synthetic central refused'),{status:r.status});return value;};
 const ua={id:a,role:'admin'},ub={id:b,role:'admin'},syncA=()=>synchronizeD1(A.pool,a,{token:ta,request}),syncB=()=>synchronizeD1(B.pool,b,{token:tb,request});
 const optsA={transport:{token:ta,request}},optsB={transport:{token:tb,request}},save=(entity,id,data,baseVersion=null)=>({operationId:randomUUID(),entity,id,action:'save',baseVersion,data});
 try{
  await check('RC3 least-privilege central login processes transactions but cannot change principals, history or schema',async()=>{
   const current=(await service.query('SELECT current_user AS name')).rows[0];assert.equal(current.name,role);
   for(const sql of ["UPDATE d1_principals SET role='admin'",'DELETE FROM d1_central_records','UPDATE d1_business_entries SET cents=0','DELETE FROM d1_central_receipts','CREATE TABLE forbidden_rc3(id int)'])await assert.rejects(service.query(sql),e=>e.code==='42501');
  });
  const employee=randomUUID();await catalogSave(A.pool,ua,da,'Employee',employee,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO RC3 shared',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});await syncA();await syncB();
  let stale;
  await check('RC3 concurrent edits preserve both proposals and stale reconciliation cannot lose an update',async()=>{
   const ar=(await catalogList(A.pool,ua,'Employee')).find(r=>r.id===employee),br=(await catalogList(B.pool,ub,'Employee')).find(r=>r.id===employee);
   await catalogSave(A.pool,ua,da,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:ar._version,data:{...Object.fromEntries(Object.entries(ar).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k))),name:'FICTICIO RC3 winner'}});
   await catalogSave(B.pool,ub,db,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:br._version,data:{...Object.fromEntries(Object.entries(br).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k))),name:'FICTICIO RC3 preserved proposal'}});
   await syncA();await syncB();
   // Either contender may win. Select the actual loser for the rest of this case.
   const qb=(await B.pool.query("SELECT 1 FROM d1_sync_queue WHERE state='conflict'")).rowCount;
   if(!qb)throw Error('Conflict was not preserved');
   stale=await reconciliationPlan(B.pool,ub,optsB);assert.equal(stale.operations.length,1);assert.equal(stale.operations[0].proposal.record.name,'FICTICIO RC3 preserved proposal');
   const latest=(await catalogList(A.pool,ua,'Employee')).find(r=>r.id===employee);await catalogSave(A.pool,ua,da,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:latest._version,data:{...Object.fromEntries(Object.entries(latest).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k))),name:'FICTICIO RC3 winner later'}});await syncA();
   await assert.rejects(reconcile(B.pool,ub,{operationId:randomUUID(),decision:'accept-central',planHash:stale.hash,reason:'FICTICIO reviewed stale plan'},optsB),e=>e.status===409);
   assert.equal((await B.pool.query('SELECT count(*)::int n FROM d1_reconciliation')).rows[0].n,0);
  });
  await check('RC3 explicit reconciliation archives proposals; fresh edits use current CAS and converge',async()=>{
   const plan=await reconciliationPlan(B.pool,ub,optsB),command={operationId:randomUUID(),decision:'accept-central',planHash:plan.hash,reason:'FICTICIO operator selected central'};
   const result=await reconcile(B.pool,ub,command,optsB);assert.equal(result.archivedOperations,1);assert.equal((await reconcile(B.pool,ub,command,optsB)).replay,true);
   assert.equal((await B.pool.query('SELECT count(*)::int n FROM lab_outbox')).rows[0].n,1);assert.equal((await B.pool.query('SELECT archive FROM d1_reconciliation')).rows[0].archive.local.queue[0].result.record.name,'FICTICIO RC3 preserved proposal');
   const current=(await catalogList(B.pool,ub,'Employee')).find(r=>r.id===employee);assert.equal(current.name,'FICTICIO RC3 winner later');await catalogSave(B.pool,ub,db,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:current._version,data:{...Object.fromEntries(Object.entries(current).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k))),name:'FICTICIO RC3 reviewed new edit'}});assert.equal((await syncB()).lastError,null);await syncA();assert.equal((await catalogList(A.pool,ua,'Employee')).find(r=>r.id===employee).name,'FICTICIO RC3 reviewed new edit');
  });
  await check('RC3 reconciliation includes never-sent dependent edits and invalidates every stale form',async()=>{
   const before=(await catalogList(B.pool,ub,'Employee')).find(r=>r.id===employee),clean=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k)));
   for(let n=0;n<2;n++){const row=(await catalogList(B.pool,ub,'Employee')).find(r=>r.id===employee);await catalogSave(B.pool,ub,db,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:row._version,data:{...clean(row),name:'FICTICIO RC3 dependent proposal '+n}});}
   const current=(await catalogList(A.pool,ua,'Employee')).find(r=>r.id===employee);await catalogSave(A.pool,ua,da,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:current._version,data:{...clean(current),name:'FICTICIO RC3 concurrent later winner'}});await syncA();await syncB();
   const plan=await reconciliationPlan(B.pool,ub,optsB);assert.equal(plan.operations.length,2);await reconcile(B.pool,ub,{operationId:randomUUID(),decision:'accept-central',planHash:plan.hash,reason:'FICTICIO reviewed full dependent chain'},optsB);
   const latest=(await catalogList(B.pool,ub,'Employee')).find(r=>r.id===employee);assert.ok(latest._version>before._version+2);assert.equal(latest.name,'FICTICIO RC3 concurrent later winner');await assert.rejects(catalogSave(B.pool,ub,db,'Employee',employee,{operationId:randomUUID(),operation:'update',baseVersion:before._version+2,data:clean(before)}),e=>e.status===409);const withdrawn=(await B.pool.query("SELECT o.* FROM lab_outbox o JOIN d1_sync_queue q USING(operation_id) WHERE q.state='resolved' AND o.entity='Employee' ORDER BY o.created_at DESC LIMIT 1")).rows[0];await assert.rejects(catalogSave(B.pool,ub,db,'Employee',withdrawn.record_id,{operationId:withdrawn.operation_id,operation:withdrawn.operation,baseVersion:Number(withdrawn.base_version),data:withdrawn.payload}),e=>e.status===409);assert.equal((await syncB()).businessConfirmed,true);
  });
  const raw=randomUUID();await createStockItem(A.pool,ua,da,{operationId:randomUUID(),itemId:raw,data:{name:'FICTICIO RC3 stock',status:'ativo',unit:'kg',minimum_stock:0},initialMilli:10000,unitCents:250});await syncA();await syncB();
  await check('RC3 stock conflict withdrawal archives provisional ledger and restores authoritative balance',async()=>{
   await operationalCommand(A.pool,ua,da,{operationId:randomUUID(),kind:'exit',itemId:raw,quantityMilli:6000,baseVersion:1});await operationalCommand(B.pool,ub,db,{operationId:randomUUID(),kind:'exit',itemId:raw,quantityMilli:7000,baseVersion:1});await syncA();await syncB();
   const plan=await reconciliationPlan(B.pool,ub,optsB);await reconcile(B.pool,ub,{operationId:randomUUID(),decision:'accept-central',planHash:plan.hash,reason:'FICTICIO withdraw conflicting stock'},optsB);assert.equal(Number((await operationalState(B.pool,ub)).balances.find(r=>r.item_id===raw).quantity_milli),4000);assert.equal((await syncB()).businessConfirmed,true);
  });
  const account=randomUUID();await domainCommand(A.pool,ua,da,save('FinancialAccount',account,{name:'FICTICIO RC3 own bank',type:'banco',institution:'FICTICIO bank',status:'ativo',initial_balance:0,current_balance:0}));await operationalCommand(A.pool,ua,da,{operationId:randomUUID(),kind:'journal',entries:[{account:'account:'+account,cents:20000,baseVersion:0},{account:'equity',cents:-20000,baseVersion:0}]});assert.equal((await syncA()).lastError,null);await syncB();
  const expense=randomUUID();
  await check('RC3 owned account settles once and synchronizes its actual ledger to peer',async()=>{
   await domainCommand(A.pool,ua,da,save('FinancialExpense',expense,{description:'FICTICIO own account expense',date:'2026-10-17',amount:12.34,status:'pago',financial_account_id:account,payment_method:'pix'}));assert.equal((await syncA()).lastError,null);await syncB();assert.equal(Number((await operationalState(B.pool,ub)).accounts.find(r=>r.account==='account:'+account).balance_cents),18766);
  });
  await check('RC3 audited reversal cancels document and restores own account exactly once across devices',async()=>{
   const current=(await domainList(B.pool,ub,'FinancialExpense')).find(r=>r.id===expense),body={operationId:randomUUID(),entity:'FinancialExpense',id:expense,baseVersion:current._version,action:'reverse',reason:'FICTICIO authorized financial reversal'};
   await domainCommand(B.pool,ub,db,body);assert.equal((await domainCommand(B.pool,ub,db,body)).replay,true);const status=await syncB();assert.equal(status.conflicts,0);assert.equal(status.lastError,null);await syncA();assert.equal(Number((await operationalState(A.pool,ua)).accounts.find(r=>r.account==='account:'+account).balance_cents),20000);assert.equal((await domainList(A.pool,ua,'FinancialExpense')).find(r=>r.id===expense).status,'cancelado');
   const reversed=(await B.pool.query('SELECT count(*)::int n FROM d1_local_reversals WHERE reference=$1',[expense])).rows[0].n;assert.equal(reversed,1);await assert.rejects(domainCommand(B.pool,ub,db,{...body,operationId:randomUUID(),baseVersion:current._version+1}),e=>e.status===409);
  });
  await check('RC3 reversed settlement cannot be reopened with a fresh UUID or create another debit',async()=>{
   const row=(await centralPool.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,expense])).rows[0],data={...row.data,payload_json:JSON.stringify({...JSON.parse(row.data.payload_json),status:'pago'}),status:'pago'},operationId=randomUUID();
   await assert.rejects(request(ta,'/push',{protocol:'D1LAB/1',operationId,actorId:a,deviceId:da,workspaceId:workspace,changes:[{entity:row.entity,id:row.id,baseVersion:Number(row.version),data}]}),e=>e.status===409);
   assert.equal((await centralPool.query('SELECT 1 FROM d1_central_receipts WHERE operation_id=$1',[operationId])).rowCount,0);assert.equal(Number((await operationalState(A.pool,ua)).accounts.find(r=>r.account==='account:'+account).balance_cents),20000);
  });
  await check('RC3 simultaneous financial confirmations cannot overdraw the same owned account',async()=>{
   const first=randomUUID(),second=randomUUID();
   for(const [local,user,device,id] of [[A,ua,da,first],[B,ub,db,second]])await domainCommand(local.pool,user,device,save('FinancialExpense',id,{description:'FICTICIO concurrent own account',date:'2026-10-17',amount:150,status:'pago',financial_account_id:account,payment_method:'pix'}));
   const statuses=await Promise.all([syncA(),syncB()]);assert.equal(statuses.filter(s=>s.conflicts>0).length,1);
   const accepted=(await centralPool.query('SELECT record_id FROM d1_business_settlements WHERE workspace=$1 AND record_id=ANY($2::uuid[])',[workspace,[first,second]])).rows;assert.equal(accepted.length,1);
   const loser=statuses[0].conflicts>0?[A,ua,optsA]:[B,ub,optsB],plan=await reconciliationPlan(loser[0].pool,loser[1],loser[2]);await reconcile(loser[0].pool,loser[1],{operationId:randomUUID(),decision:'accept-central',planHash:plan.hash,reason:'FICTICIO withdraw insufficient funded proposal'},loser[2]);await syncA();await syncB();assert.equal(Number((await operationalState(B.pool,ub)).accounts.find(r=>r.account==='account:'+account).balance_cents),5000);
  });
  const product=randomUUID(),daily=randomUUID(),order=randomUUID();await domainCommand(A.pool,ua,da,save('ProductionProduct',product,{name:'FICTICIO RC3 recipe',yield_quantity:10,yield_unit:'un',status:'ativo',ingredients:[{inventory_item_id:raw,quantity:2}]}));
  await domainCommand(A.pool,ua,da,save('ProductionOrder',order,{date:'2026-10-17',product_id:product,planned_quantity:10,status:'planejada',unit:'un'}));
  await check('RC3 production loss detail is required and confirmation atomically consumes gross production',async()=>{
   const data={date:'2026-10-17',product_id:product,production_order_id:order,produced_quantity:10,loss_quantity:1,leftover_quantity:0,losses:[],unit:'un'};await assert.rejects(domainCommand(A.pool,ua,da,save('DailyProduction',daily,data)),e=>e.status===400);
   data.losses=[{quantity:1,reason:'FICTICIO process loss',responsible:'FICTICIO operator',date:'2026-10-17',unit:'un'}];await domainCommand(A.pool,ua,da,save('DailyProduction',daily,data));assert.equal((await domainList(A.pool,ua,'ProductionOrder')).find(r=>r.id===order).status,'em_producao');await syncA();await syncB();assert.equal((await domainList(B.pool,ub,'ProductionOrder')).find(r=>r.id===order).produced_quantity,0);
   const preview=await domainPreview(A.pool,ua,daily),command={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:1,action:'confirm',token:preview.token};await domainCommand(A.pool,ua,da,command);const out=(await A.pool.query('SELECT result FROM lab_outbox WHERE operation_id=$1',[command.operationId])).rows[0].result;assert.equal(out.cascata.some(r=>r.entity==='OperationalEvent'&&r.record.id===command.operationId),true);assert.equal((await syncA()).lastError,null);await syncB();assert.equal(Number((await operationalState(B.pool,ub)).balances.find(r=>r.item_id===raw).quantity_milli),2000);assert.equal((await domainList(B.pool,ub,'ProductionOrder')).find(r=>r.id===order).status,'concluida');
  });
  await check('RC3 production reversal is one aggregate and second reversal cannot restore stock again',async()=>{
   const current=(await domainList(A.pool,ua,'DailyProduction')).find(r=>r.id===daily),body={operationId:randomUUID(),entity:'DailyProduction',id:daily,baseVersion:current._version,action:'cancel',reason:'FICTICIO production cancellation'};await domainCommand(A.pool,ua,da,body);await domainCommand(A.pool,ua,da,body);const status=await syncA();assert.equal(status.conflicts,0);assert.equal(status.lastError,null);await syncB();assert.equal(Number((await operationalState(B.pool,ub)).balances.find(r=>r.item_id===raw).quantity_milli),4000);assert.equal((await domainList(B.pool,ub,'ProductionOrder')).find(r=>r.id===order).status,'cancelada');await assert.rejects(domainCommand(A.pool,ua,da,{...body,operationId:randomUUID(),baseVersion:current._version+1}),e=>e.status===409);
  });
  await check('RC3 forged production quantity rolls back the entire document, stock and receipt',async()=>{
   const id=randomUUID();await domainCommand(A.pool,ua,da,save('DailyProduction',id,{date:'2026-10-17',product_id:product,produced_quantity:10,loss_quantity:0,leftover_quantity:0,losses:[],unit:'un'}));await syncA();
   const row=(await centralPool.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows[0],operationId=randomUUID(),balance=(await centralPool.query('SELECT * FROM d1_business_stock WHERE workspace=$1 AND item=$2',[workspace,raw])).rows[0],command={operationId,kind:'consume',inputs:[{itemId:raw,quantityMilli:3000,baseVersion:Number(balance.version)}]},head=(await centralPool.query('SELECT cursor FROM d1_central_clock')).rows[0].cursor;
   await assert.rejects(request(ta,'/push',{protocol:'D1LAB/1',operationId,actorId:a,deviceId:da,workspaceId:workspace,changes:[{entity:'DailyProduction',id,baseVersion:Number(row.version),data:{...row.data,status:'confirmado',payload_json:JSON.stringify({...JSON.parse(row.data.payload_json),local_status:'confirmado',confirmation_id:operationId})}},{entity:'OperationalEvent',id:operationId,baseVersion:null,data:{name:'FICTICIO invalid aggregate',kind:'consume',command_json:JSON.stringify(command),result_json:JSON.stringify({operationId,businessConfirmed:false,externalConfirmed:false}),status:'pending-central',source_device_id:da}}]}),e=>e.status===409);
   assert.deepEqual((await centralPool.query('SELECT * FROM d1_business_stock WHERE workspace=$1 AND item=$2',[workspace,raw])).rows[0],balance);assert.equal((await centralPool.query('SELECT cursor FROM d1_central_clock')).rows[0].cursor,head);assert.equal((await centralPool.query('SELECT 1 FROM d1_central_receipts WHERE operation_id=$1',[operationId])).rowCount,0);
  });
  await check('RC3 reconciliation and reversal deny revoked local admin without changing state',async()=>{
   await B.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[b]);await assert.rejects(reconciliationPlan(B.pool,ub,optsB),e=>e.status===403);await assert.rejects(domainCommand(B.pool,ub,db,{operationId:randomUUID(),entity:'FinancialExpense',id:expense,baseVersion:1,action:'reverse',reason:'FICTICIO unauthorized attempt'}),e=>e.status===403);await B.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[b]);
  });
  await check('RC3 encrypted restore preserves conflict archive, own-account ledger and unique reversals',async()=>{
   const restored=await fixture.roundTrip(B);for(const table of ['d1_reconciliation','d1_local_reversals','d1_financial_accounts','d1_financial_entries']){const before=(await B.pool.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows,after=(await restored.pool.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;assert.deepEqual(after,before);}
  });
 }finally{await new Promise(r=>server.close(r));await service.end();}
}
