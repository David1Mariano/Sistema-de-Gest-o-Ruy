import {transaction,fail,uuid} from './core.mjs';
import {syncHash,syncTable,validateEnvelope} from './sync-contract.mjs';
import {sectorKey} from '../../src/lib/sectorUtils.js';
import {provisionedRequest} from './tls-provision.mjs';
import {projectBusiness} from './business-projection.mjs';

const withdrawable=q=>['conflict','rejected'].includes(q.state)||q.state===null&&q.envelope===null;
const tables=['d1_records','d2_catalog','d1_operation_events','d1_stock_balances','d1_stock_movements','d1_financial_accounts','d1_financial_entries','d1_local_reversals'];
async function authorize(pool,user){
 const active=(await pool.query("SELECT 1 FROM lab_users WHERE id=$1 AND active AND role='admin'",[user.id])).rowCount;
 if(!active||process.env.RUY_D1_ALLOW_TESTS!=='1')throw fail(403,'Reconciliation restricted to authorized laboratory admin.');
 const binding=(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[user.id])).rows[0];if(!binding)throw fail(403,'Provisioned device required.');return binding;
}
async function localState(c,actor){
 const result={};for(const table of tables)result[table]=(await c.query(`SELECT to_jsonb(t) AS data FROM ${table} t WHERE owner_id=$1 ORDER BY to_jsonb(t)::text`,[actor])).rows.map(r=>r.data);
 result.queue=(await c.query("SELECT o.operation_id,o.payload_hash,o.result,q.state,q.envelope FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id) WHERE o.actor=$1 AND coalesce(q.state,'pending') NOT IN ('acknowledged','resolved') ORDER BY o.operation_id",[actor])).rows;
 result.shadows=(await c.query('SELECT * FROM d1_sync_shadow WHERE actor=$1 ORDER BY record_id',[actor])).rows;
 return result;
}
async function centralState(binding,transport){
 let cursor=0,head=null,business;const records=new Map();
 for(let n=0;n<1000;n++){
  const page=await transport.request(transport.token,'/changes?cursor='+cursor);
  if(page.protocol!=='D1LAB/1'||!Array.isArray(page.events)||page.cursor<cursor||page.hasMore&&page.cursor===cursor||head!==null&&head!==page.head)throw fail(409,'Central changed during reconciliation; refresh plan.');head=page.head;
  for(const event of page.events){if(event.workspace_id!==binding.workspace_id)throw fail(403,'Workspace mismatch.');validateEnvelope({protocol:'D1LAB/1',operationId:event.operation_id,actorId:binding.actor,deviceId:event.device_id,workspaceId:binding.workspace_id,changes:event.changes.map(r=>({...r,baseVersion:r.version===1?null:r.version-1}))});for(const row of event.changes)records.set(row.id,row);}
  cursor=page.cursor;business=page.business;if(!page.hasMore){if(cursor!==head||!business?.complete||business.head!==head||business.workspaceId!==binding.workspace_id)throw fail(409,'Complete authoritative business state required.');return {head,business,records:[...records.values()].sort((a,b)=>a.id.localeCompare(b.id))};}
 }
 throw fail(413,'Reconciliation limit; no changes applied.');
}
export async function reconciliationPlan(pool,user,options={}){
 const binding=await authorize(pool,user),transport=options.transport||await provisionedRequest(binding),central=await centralState(binding,transport);
 return transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);await authorize(c,user);const local=await localState(c,user.id);
  if(!local.queue.length&&!local.shadows.length)throw fail(409,'No conflict to review.');
  if(local.queue.some(q=>!withdrawable(q)))throw fail(409,'Retry all pending/uncertain receipts before reconciliation.');
  const hash=syncHash({actor:user.id,central,local});return {hash,head:central.head,decision:'accept-central',operations:local.queue.map(q=>({id:q.operation_id,state:q.state,proposal:q.result})),shadows:local.shadows,centralRecords:central.records,notice:'Explicitly withdraw these proposals; immutable outbox and full archive are preserved. Re-enter selected changes afterwards with fresh versions.'};
 });
}
export async function reconcile(pool,user,body,options={}){
 if(!uuid(body?.operationId)||body.decision!=='accept-central'||typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>300||!/^[a-f0-9]{64}$/.test(body.planHash||''))throw fail(400,'Explicit decision, plan hash and reason required.');
 const binding=await authorize(pool,user),transport=options.transport||await provisionedRequest(binding),central=await centralState(binding,transport);
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
  const prior=(await c.query('SELECT * FROM d1_reconciliation WHERE id=$1',[body.operationId])).rows[0];
  if(prior){if(prior.actor!==user.id||prior.plan_hash!==body.planHash||prior.reason!==body.reason)throw fail(409,'Reconciliation UUID reused.');return {id:prior.id,replay:true};}
  await authorize(c,user);const local=await localState(c,user.id);
  if(local.queue.some(q=>!withdrawable(q))||syncHash({actor:user.id,central,local})!==body.planHash)throw fail(409,'Stale reconciliation plan; neither proposal changed.');
  await c.query('INSERT INTO d1_reconciliation(id,actor,plan_hash,reason,archive) VALUES($1,$2,$3,$4,$5)',[body.operationId,user.id,body.planHash,body.reason,{local,central,decision:body.decision}]);
  for(const proposal of local.queue)await c.query("INSERT INTO d1_sync_queue(operation_id,state,error) VALUES($1,'resolved','Withdrawn by explicit audited reconciliation') ON CONFLICT(operation_id) DO UPDATE SET state='resolved',lease_until=NULL,error=excluded.error",[proposal.operation_id]);
  // Only replace derived local projections after archiving every proposal and ledger row.
  for(const table of [...tables].reverse())await c.query(`DELETE FROM ${table} WHERE owner_id=$1`,[user.id]);
  await c.query('DELETE FROM d1_sync_versions WHERE actor=$1',[user.id]);await c.query('DELETE FROM d1_sync_shadow WHERE actor=$1',[user.id]);
  for(const row of central.records){const table=syncTable(row.entity),previous=local[table].find(r=>r.id===row.id),version=Math.max(row.version,Number(previous?.version||0)+1);await c.query(`INSERT INTO ${table}(id,owner_id,entity,data,name_key,version) VALUES($1,$2,$3,$4,$5,$6)`,[row.id,user.id,row.entity,row.data,row.entity==='SystemSettings'?'singleton':sectorKey(row.data.name),version]);await c.query('INSERT INTO d1_sync_versions VALUES($1,$2,$3,$4,$5)',[user.id,row.id,row.entity,row.version,version]);}
  await c.query('DELETE FROM d1_business_local WHERE actor=$1',[user.id]);
  await projectBusiness(c,binding,{head:central.head,cursor:central.head,hasMore:false,business:central.business});
  await c.query('UPDATE d1_sync_binding SET cursor=$2,pull_complete=true,last_error=NULL WHERE actor=$1',[user.id,central.head]);
  await c.query("INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,'sync:reconcile:accept-central',$2)",[user.id,body.operationId]);return {id:body.operationId,replay:false,archivedOperations:local.queue.length,operationalSyncEnabled:false};
 });
}
