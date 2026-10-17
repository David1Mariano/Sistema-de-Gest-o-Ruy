import {ledgerAccount,assetAccount} from './ledger-contract.mjs';
import {fail,uuid} from './core.mjs';
import {syncHash} from './sync-contract.mjs';
const numeric=(value,min=-Number.MAX_SAFE_INTEGER)=>(typeof value==='number'||typeof value==='string'&&/^-?\d+$/.test(value))&&Number.isSafeInteger(Number(value))&&Number(value)>=min;
const idFor=value=>{const h=syncHash(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
export async function projectBusiness(c,binding,page){
 const state=page.business;if(!state)return;
 if(page.hasMore)return;
 if(page.cursor!==page.head||state.protocol!=='D1BUS/1'||state.workspaceId!==binding.workspace_id||state.head!==page.head||typeof state.complete!=='boolean')throw fail(503,'Business projection identity mismatch.');
 if(!(await c.query("SELECT to_regclass('public.d1_business_local') AS name")).rows[0].name)throw fail(409,'Business projection schema absent.');
 for(const key of ['stock','accounts','movements','entries','settlements'])if(!Array.isArray(state[key])||state[key].length>20000)throw fail(503,'Invalid business projection.');
 for(const row of state.stock)if(row.workspace!==binding.workspace_id||!uuid(row.item)||!['quantity','average','last_cost','version'].every(k=>numeric(row[k],0)))throw fail(503,'Invalid stock projection.');
 for(const row of state.accounts)if(row.workspace!==binding.workspace_id||!ledgerAccount(row.account)||!numeric(row.balance)||!numeric(row.version,0)||assetAccount(row.account)&&Number(row.balance)<0)throw fail(503,'Invalid account projection.');
 for(const row of state.movements)if(row.workspace!==binding.workspace_id||!uuid(row.item)||!uuid(row.operation)||!numeric(row.delta)||!numeric(row.cost,0)||!numeric(row.balance,0)||typeof row.item_name!=='string'||typeof row.unit!=='string'||!['entry','exit','adjust','consume','production','reversal'].includes(row.kind))throw fail(503,'Invalid movement projection.');
 for(const row of state.entries)if(row.workspace!==binding.workspace_id||!uuid(row.operation)||!numeric(row.cents)||!state.accounts.some(a=>a.account===row.account))throw fail(503,'Invalid entry projection.');
 for(const row of state.settlements)if(row.workspace!==binding.workspace_id||!uuid(row.record_id)||typeof row.obligation!=='string'||!/^[a-f0-9]{64}$/.test(row.signature))throw fail(503,'Invalid settlement projection.');
 for(const [rows,key] of [[state.stock,r=>r.item],[state.accounts,r=>r.account],[state.movements,r=>r.operation+':'+r.item],[state.entries,r=>r.operation+':'+r.account],[state.settlements,r=>r.obligation],[state.settlements,r=>r.record_id]])if(new Set(rows.map(key)).size!==rows.length)throw fail(503,'Duplicate business projection identity.');
 for(const row of state.stock)if(state.movements.filter(m=>m.item===row.item).reduce((sum,m)=>sum+BigInt(m.delta),0n)!==BigInt(row.quantity))throw fail(503,'Stock projection does not match movements.');
 for(const row of state.accounts)if(state.entries.filter(e=>e.account===row.account).reduce((sum,e)=>sum+BigInt(e.cents),0n)!==BigInt(row.balance))throw fail(503,'Account projection does not match journal.');
 const dirty=(await c.query("SELECT 1 FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id) WHERE o.actor=$1 AND coalesce(q.state,'pending') NOT IN ('acknowledged','resolved') LIMIT 1",[binding.actor])).rowCount||(await c.query('SELECT 1 FROM d1_sync_shadow WHERE actor=$1 LIMIT 1',[binding.actor])).rowCount;
 const prior=(await c.query('SELECT head,applied FROM d1_business_local WHERE actor=$1',[binding.actor])).rows[0];
 if(prior&&Number(prior.head)>state.head)throw fail(409,'Business projection cursor rollback.');
 if(prior&&Number(prior.head)===state.head&&prior.applied&&!dirty)return;
 await c.query('INSERT INTO d1_business_local VALUES($1,$2,$3,$4,false) ON CONFLICT(actor) DO UPDATE SET workspace=excluded.workspace,head=excluded.head,state=excluded.state,applied=false',[binding.actor,binding.workspace_id,state.head,state]);
 if(dirty||!state.complete)return; // Keep both the authoritative state and the local proposal. No silent overwrite.
 const localItems=(await c.query('SELECT item_id FROM d1_stock_balances WHERE owner_id=$1',[binding.actor])).rows;
 if(localItems.some(row=>!state.stock.some(item=>item.item===row.item_id)))throw fail(409,'Unreconciled local stock is preserved.');
 for(const row of state.stock){
  if(!(await c.query("SELECT id FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity='InventoryItem'",[row.item,binding.actor])).rowCount)throw fail(409,'Stock projection reference missing.');
  await c.query('INSERT INTO d1_stock_balances VALUES($1,$2,$3,$3,$4,$5,$6) ON CONFLICT(owner_id,item_id) DO UPDATE SET quantity_milli=excluded.quantity_milli,quota_milli=excluded.quota_milli,average_cents=excluded.average_cents,last_cents=excluded.last_cents,version=excluded.version',[binding.actor,row.item,row.quantity,row.average,row.last_cost,row.version]);
 }
 for(const row of state.accounts)await c.query('INSERT INTO d1_financial_accounts VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,account) DO UPDATE SET balance_cents=excluded.balance_cents,version=excluded.version',[binding.actor,row.account,row.balance,row.version]);
 for(const row of state.movements){
  const item=(await c.query('SELECT data FROM d2_catalog WHERE id=$1 AND owner_id=$2',[row.item,binding.actor])).rows[0];
  if(!item)throw fail(409,'Movement reference missing.');
  const old=(await c.query('SELECT owner_id FROM d1_stock_movements WHERE operation_id=$1 AND item_id=$2',[row.operation,row.item])).rows[0];
  if(old&&old.owner_id!==binding.actor)throw fail(403,'Movement scope collision.');
  await c.query('INSERT INTO d1_stock_movements(id,owner_id,operation_id,item_id,item_name,unit,quantity_milli,unit_cents,balance_after,movement_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(operation_id,item_id) DO NOTHING',[idFor([row.operation,row.item]),binding.actor,row.operation,row.item,row.item_name,row.unit,row.delta,row.cost,row.balance,({entry:'entrada_manual',exit:'saida_manual',adjust:'inventario',consume:'consumo_producao',production:'entrada_producao',reversal:'estorno'})[row.kind]]);
 }
 for(const row of state.entries){
  const old=(await c.query('SELECT owner_id FROM d1_financial_entries WHERE operation_id=$1 AND account=$2',[row.operation,row.account])).rows[0];if(old&&old.owner_id!==binding.actor)throw fail(403,'Journal scope collision.');
  await c.query('INSERT INTO d1_financial_entries(owner_id,operation_id,account,cents) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id,account) DO NOTHING',[binding.actor,row.operation,row.account,row.cents]);
 }
 for(const row of state.reversals||[]){if(row.workspace!==binding.workspace_id||!uuid(row.reference)||!uuid(row.operation)||typeof row.reason!=='string')throw fail(503,'Invalid reversal projection.');await c.query('INSERT INTO d1_local_reversals VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,reference) DO NOTHING',[binding.actor,row.reference,row.operation,row.reason]);}
 await c.query('UPDATE d1_business_local SET applied=true WHERE actor=$1',[binding.actor]);
 await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'business:projection')",[binding.actor]);
}
export async function businessConfirmation(pool,actor){
 if(!(await pool.query("SELECT to_regclass('public.d1_business_local') AS name")).rows[0].name)return false;
 const projection=(await pool.query('SELECT p.applied,p.head,b.cursor,b.pull_complete,b.last_error FROM d1_business_local p JOIN d1_sync_binding b USING(actor) WHERE p.actor=$1',[actor])).rows[0];
 if(!projection?.applied||Number(projection.head)!==Number(projection.cursor)||!projection.pull_complete||projection.last_error)return false;
 const dirty=(await pool.query("SELECT 1 FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id) WHERE o.actor=$1 AND(coalesce(q.state,'pending') NOT IN ('acknowledged','resolved') OR(q.state='acknowledged' AND coalesce(q.receipt->'business'->>'confirmed','false')<>'true')) LIMIT 1",[actor])).rowCount;
 return !dirty&&!(await pool.query('SELECT 1 FROM d1_sync_shadow WHERE actor=$1 LIMIT 1',[actor])).rowCount;
}
