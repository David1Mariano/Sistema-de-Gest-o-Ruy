import {applyBusiness} from './business.mjs';
import {randomUUID} from 'node:crypto';
import {transaction,fail,uuid} from '../d1-lab/core.mjs';
import {syncHash,syncTable,dataOf} from '../d1-lab/sync-contract.mjs';
import {domainCommand,domainPreview} from '../d1-lab/domain.mjs';
import {previewSettlement,settlementReconciliation} from '../d1-lab/settlements.mjs';

// Reuse the D1 engine inside the already-owned central transaction. Nested
// engine operations use savepoints; none can commit the central transaction.
function nestedPool(c){let sequence=0;return {query:(...a)=>c.query(...a),async connect(){const savepoint='shared_domain_'+(++sequence);return {async query(sql,args){if(sql==='BEGIN')return c.query('SAVEPOINT '+savepoint);if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT '+savepoint);if(sql==='ROLLBACK'){await c.query('ROLLBACK TO SAVEPOINT '+savepoint);return c.query('RELEASE SAVEPOINT '+savepoint);}return c.query(sql,args);},release(){}};}};}
const stableId=value=>{const h=syncHash(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
async function scope(c,p){
 let row=(await c.query('SELECT owner_id FROM shared_execution_scopes WHERE workspace_id=$1',[p.workspace_id])).rows[0];
 if(!row){const id=randomUUID();await c.query("INSERT INTO lab_users VALUES($1,$2,'disabled:central-data-scope','admin',true)",[id,id+'@workspace.invalid']);await c.query('INSERT INTO shared_execution_scopes VALUES($1,$2)',[p.workspace_id,id]);row={owner_id:id};}
 let device=(await c.query('SELECT id FROM lab_device WHERE singleton')).rows[0];if(!device){device={id:randomUUID()};await c.query('INSERT INTO lab_device(id) VALUES($1)',[device.id]);}
 return {user:{id:row.owner_id,role:'admin',auditId:p.actor_id},device:device.id};
}
async function hydrate(c,p,owner){
 const rows=(await c.query('SELECT * FROM d1_central_records WHERE workspace_id=$1',[p.workspace_id])).rows;
 for(const r of rows){const table=syncTable(r.entity);if(table==='d1_operation_events')continue;
  await c.query(`INSERT INTO ${table}(id,owner_id,entity,data,name_key,version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET data=excluded.data,name_key=excluded.name_key,version=excluded.version WHERE ${table}.owner_id=excluded.owner_id`,[r.id,owner,r.entity,r.data,r.name_key,r.version]);
  if(!(await c.query(`SELECT 1 FROM ${table} WHERE id=$1 AND owner_id=$2`,[r.id,owner])).rowCount)throw fail(409,'Identidade de outro workspace.');
 }
 await c.query('INSERT INTO d1_stock_balances(owner_id,item_id,quantity_milli,quota_milli,average_cents,last_cents,version) SELECT $2,item,quantity,quantity,average,last_cost,version FROM d1_business_stock WHERE workspace=$1 ON CONFLICT(owner_id,item_id) DO UPDATE SET quantity_milli=excluded.quantity_milli,quota_milli=excluded.quota_milli,average_cents=excluded.average_cents,last_cents=excluded.last_cents,version=excluded.version',[p.workspace_id,owner]);
 await c.query('INSERT INTO d1_financial_accounts(owner_id,account,balance_cents,version) SELECT $2,account,balance,version FROM d1_business_accounts WHERE workspace=$1 ON CONFLICT(owner_id,account) DO UPDATE SET balance_cents=excluded.balance_cents,version=excluded.version',[p.workspace_id,owner]);
 await c.query('INSERT INTO d1_financial_entries(owner_id,operation_id,account,cents) SELECT $2,operation,account,cents FROM d1_business_entries WHERE workspace=$1 ON CONFLICT(operation_id,account) DO NOTHING',[p.workspace_id,owner]);
 for(const m of (await c.query('SELECT * FROM d1_business_movements WHERE workspace=$1',[p.workspace_id])).rows)await c.query('INSERT INTO d1_stock_movements(id,owner_id,operation_id,item_id,item_name,unit,quantity_milli,unit_cents,balance_after,movement_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(operation_id,item_id) DO NOTHING',[stableId([p.workspace_id,m.operation,m.item]),owner,m.operation,m.item,m.item_name,m.unit,m.delta,m.cost,m.balance,m.kind]);
 await c.query('INSERT INTO d1_local_reversals(owner_id,reference,operation,reason) SELECT $2,reference,operation,reason FROM d1_business_reversals WHERE workspace=$1 ON CONFLICT(owner_id,reference) DO NOTHING',[p.workspace_id,owner]);
}
async function projectLedger(c,p,owner){
 await c.query('INSERT INTO d1_business_stock(workspace,item,quantity,average,last_cost,version) SELECT $2,item_id,quantity_milli,average_cents,last_cents,version FROM d1_stock_balances WHERE owner_id=$1 ON CONFLICT(workspace,item) DO UPDATE SET quantity=excluded.quantity,average=excluded.average,last_cost=excluded.last_cost,version=excluded.version',[owner,p.workspace_id]);
 await c.query('INSERT INTO d1_business_accounts(workspace,account,balance,version) SELECT $2,account,balance_cents,version FROM d1_financial_accounts WHERE owner_id=$1 ON CONFLICT(workspace,account) DO UPDATE SET balance=excluded.balance,version=excluded.version',[owner,p.workspace_id]);
 await c.query('INSERT INTO d1_business_entries(workspace,operation,account,cents) SELECT $2,operation_id,account,cents FROM d1_financial_entries WHERE owner_id=$1 ON CONFLICT(workspace,operation,account) DO NOTHING',[owner,p.workspace_id]);
 await c.query('INSERT INTO d1_business_movements(workspace,operation,item,delta,cost,balance,kind,item_name,unit) SELECT $2,operation_id,item_id,quantity_milli,unit_cents,balance_after,movement_type,item_name,unit FROM d1_stock_movements WHERE owner_id=$1 ON CONFLICT(workspace,operation,item) DO NOTHING',[owner,p.workspace_id]);
 await c.query('INSERT INTO d1_business_reversals(workspace,reference,operation,reason) SELECT $2,reference,operation,reason FROM d1_local_reversals WHERE owner_id=$1 ON CONFLICT(workspace,reference) DO NOTHING',[owner,p.workspace_id]);
}
export async function executeSharedDomain(pool,deviceToken,sessionToken,auth,body){
 if(!uuid(body?.operationId)||!uuid(body.id))throw fail(400,'Identificadores obrigatórios.');
 return transaction(pool,async c=>{
  let p=await auth.authorize(deviceToken,sessionToken,c);if(p.role!=='admin')throw fail(403,'Administrador central obrigatório.');
  await c.query('SELECT cursor FROM d1_central_clock WHERE singleton FOR UPDATE');
  p=await auth.authorize(deviceToken,sessionToken,c,true);
  const hash=syncHash(body),prior=(await c.query('SELECT * FROM d1_central_receipts WHERE operation_id=$1',[body.operationId])).rows[0];
  if(prior){if(prior.actor_id!==p.actor_id||prior.device_id!==p.device_id||prior.workspace_id!==p.workspace_id||prior.result.sourceRequestHash!==hash)throw fail(409,'UUID reutilizado com outra intenção.');return {...prior.result,replay:true};}
  const s=await scope(c,p);await hydrate(c,p,s.user.id);
  const result=await domainCommand(nestedPool(c),s.user,s.device,body);
  await projectLedger(c,p,s.user.id);
  const aggregate=[{entity:body.entity,record:result.record},...(result.cascata||[])];
  // The original domain engine creates payable/payment documents. Its legacy
  // finance effects are applied by the existing central business engine; modern
  // PayrollRun/Delivery settlements already journal inside domainCommand.
  const mapped=aggregate.map(({entity,record:r})=>({entity,id:r.id,data:dataOf(r),version:r._version}));
  const financial=mapped.filter(r=>['FinancialExpense','Revenue','AccountsReceivable','AccountsPayable','EmployeePayment','CardReceivable','DeliverySettlement'].includes(r.entity)&&!JSON.parse(r.data.payload_json||'{}').settlement_id);
  if(financial.length){
   const records=new Map((await c.query('SELECT * FROM d1_central_records WHERE workspace_id=$1',[p.workspace_id])).rows.map(r=>[r.id,r]));for(const r of mapped)records.set(r.id,r);
   const reversals=mapped.filter(r=>r.entity==='OperationalEvent'&&r.data.kind==='reversal'&&financial.some(f=>f.id===JSON.parse(r.data.command_json).referenceId));
   await applyBusiness(c,p,{operationId:body.operationId,deviceId:s.device,changes:[...financial,...reversals]},records,{operationalApplied:true});
  }
  const emitted=[];
  for(const item of [{entity:body.entity,record:result.record},...(result.cascata||[])]){
   const r=item.record,data=dataOf(r);
   await c.query('INSERT INTO d1_central_records(workspace_id,entity,id,data,name_key,version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,id) DO UPDATE SET data=excluded.data,version=excluded.version,name_key=excluded.name_key',[p.workspace_id,item.entity,r.id,data,String(data.name||r.id).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(),r._version]);
   emitted.push({entity:item.entity,id:r.id,version:r._version,data});
  }
  if(financial.length)await hydrate(c,p,s.user.id);
  const cursor=Number((await c.query('UPDATE d1_central_clock SET cursor=cursor+1 WHERE singleton RETURNING cursor')).rows[0].cursor);
  const receipt={protocol:'D1LAB/1',operationId:body.operationId,deviceId:p.device_id,actorId:p.actor_id,workspaceId:p.workspace_id,sourceRequestHash:hash,cursor,business:{confirmed:true,mode:'existing-central-domain-engine'},changes:emitted.map(r=>({id:r.id,entity:r.entity,version:r.version})),confirmedAt:new Date().toISOString()};
  await c.query('INSERT INTO d1_central_receipts VALUES($1,$2,$3,$4,$5,$6)',[body.operationId,p.device_id,p.actor_id,p.workspace_id,hash,receipt]);
  await c.query('INSERT INTO d1_central_changes VALUES($1,$2,$3,$4,$5)',[cursor,body.operationId,p.workspace_id,p.device_id,JSON.stringify(emitted)]);
  return receipt;
 });
}
export async function sharedDomainQuery(pool,deviceToken,sessionToken,auth,route){
 if(typeof route==='string'&&route.startsWith('/domain/financial-audit')){
  const p=await auth.authorize(deviceToken,sessionToken);if(p.role!=='admin')throw fail(403,'Auditoria financeira restrita ao administrador autorizado.');
  const url=new URL(route,'http://127.0.0.1');const record=url.searchParams.get('record'),offset=url.searchParams.get('offset')||'0';
  if(url.pathname!=='/domain/financial-audit'||[...url.searchParams.keys()].some(k=>!['record','offset'].includes(k)||url.searchParams.getAll(k).length!==1)||record&&!uuid(record)||!/^\d{1,7}$/.test(offset))throw fail(400,'Filtro de auditoria inválido.');
  const rows=(await pool.query(`SELECT r.operation_id,r.actor_id,r.result->>'confirmedAt' confirmed_at,e.value->>'id' record_id,e.value->>'entity' entity,e.value->>'version' version,e.value->'data'->>'status' status
   FROM d1_central_receipts r JOIN d1_central_changes c USING(operation_id) CROSS JOIN LATERAL jsonb_array_elements(c.changes) e(value)
   WHERE r.workspace_id=$1 AND c.workspace_id=$1 AND e.value->>'entity' IN ('FinancialExpense','AccountsPayable','Revenue') AND ($2::text IS NULL OR e.value->>'id'=$2)
   ORDER BY c.cursor DESC,e.value->>'id' LIMIT 51 OFFSET $3`,[p.workspace_id,record,Number(offset)])).rows;
  return {records:rows.slice(0,50),hasMore:rows.length>50,offset:Number(offset),readOnly:true};
 }
 return transaction(pool,async c=>{
  let p=await auth.authorize(deviceToken,sessionToken,c);if(p.role!=='admin')throw fail(403,'Consulta restrita.');await c.query('SELECT cursor FROM d1_central_clock WHERE singleton FOR UPDATE');p=await auth.authorize(deviceToken,sessionToken,c,true);const s=await scope(c,p);await hydrate(c,p,s.user.id);const pool=nestedPool(c);
  const preview=route.match(/^\/domain\/preview\/([a-f0-9-]{36})$/);if(preview)return domainPreview(pool,s.user,preview[1]);
  const settlement=route.match(/^\/settlements\/preview\/(PayrollRun|DeliveryOrder)\/([a-f0-9-]{36})$/);if(settlement)return previewSettlement(pool,s.user,settlement[1],settlement[2]);
  if(route==='/settlements/reconciliation')return settlementReconciliation(pool,s.user);
  const history=route.match(/^\/domain\/history\/(Vale|Consumption)\/([a-f0-9-]{36})$/);if(history)return {records:(await c.query('SELECT * FROM d1_rh_history WHERE owner_id=$1 AND entity=$2 AND record_id=$3 ORDER BY created_at',[s.user.id,history[1],history[2]])).rows};
  throw fail(404,'Consulta desconhecida.');
 });
}
