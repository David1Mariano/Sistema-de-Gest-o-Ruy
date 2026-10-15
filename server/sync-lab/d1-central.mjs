import {transaction,fail,digest} from '../d1-lab/core.mjs';
import {validateEnvelope,syncHash} from '../d1-lab/sync-contract.mjs';
import {sectorKey} from '../../src/lib/sectorUtils.js';
import {domainSyncFields} from '../d1-lab/domain-contract.mjs';
async function authorize(c,token){
 const p=(await c.query('SELECT * FROM d1_principals WHERE token_hash=$1',[digest(token||'')])).rows[0];
 if(!p?.active||p.role!=='admin')throw fail(403,'Ponte D1 restrita a administrador sintético autorizado.');
 return p;
}
export async function acceptD1(pool,token,command){
 validateEnvelope(command);
 return transaction(pool,async c=>{
  const p=await authorize(c,token);
  if(command.deviceId!==p.device_id||command.actorId!==p.actor_id||command.workspaceId!==p.workspace_id)throw fail(403,'Identidade D1 recusada.');
  await c.query('SELECT cursor FROM d1_central_clock WHERE singleton FOR UPDATE');
  const hash=syncHash(command),prior=(await c.query('SELECT * FROM d1_central_receipts WHERE operation_id=$1',[command.operationId])).rows[0];
  if(prior){if(prior.payload_hash!==hash||prior.device_id!==p.device_id||prior.actor_id!==p.actor_id)throw fail(409,'UUID D1 reutilizado.');return {...prior.result,replay:true};}
  const known=(await c.query('SELECT * FROM d1_central_records WHERE workspace_id=$1',[p.workspace_id])).rows;
  const records=new Map(known.map(r=>[r.id,r]));
  for(const change of command.changes){
   const row=records.get(change.id);
   if(row&&(row.entity!==change.entity))throw fail(409,'Entidade remota divergente.');
   if(change.baseVersion===null?!!row:!row||Number(row.version)!==change.baseVersion)throw fail(409,'Conflito remoto D1; proposta local preservada.');
   records.set(change.id,{id:change.id,entity:change.entity,data:change.data,version:row?Number(row.version)+1:1});
  }
  // Verifica referências no estado resultante de TODO o agregado, antes de escrever.
  const values=[...records.values()];
  for(const change of command.changes){
   const d=change.data;
   if(domainSyncFields[change.entity]){
    const payload=JSON.parse(d.payload_json);
    const reference=(id,entity)=>{if(id&&records.get(id)?.entity!==entity)throw fail(409,'Referência de domínio remoto inexistente.');};
    if(['ProductionOrder','DailyProduction'].includes(change.entity))reference(payload.product_id,'ProductionProduct');
    if(change.entity==='ProductionProduct')for(const line of payload.ingredients)reference(line.inventory_item_id,'InventoryItem');
    if(change.entity==='EmployeePayment'){reference(payload.employee_id,'Employee');reference(payload.financial_expense_id,'FinancialExpense');}
    if(change.entity==='FinancialExpense'){reference(payload.linked_payment_id,'EmployeePayment');reference(payload.accounts_payable_id,'AccountsPayable');}
    if(['CardReceivable','DeliverySettlement'].includes(change.entity))reference(payload.accounts_receivable_id,'AccountsReceivable');
    if(change.entity==='AccountsReceivable'&&payload.source_id)reference(payload.source_id,payload.source_type==='cartao'?'CardReceivable':'DeliverySettlement');
    if(change.entity==='AccountsPayable')reference(payload.recurring_expense_id,'RecurringExpense');
   }
   if(change.entity==='JobRole'&&d.sector_id){const sector=records.get(d.sector_id);if(!sector||sector.entity!=='Sector'||sector.data.name!==d.sector_name)throw fail(409,'Referência de setor remota inválida.');}
   if(change.entity==='Employee'&&d.sector&&!values.some(r=>r.entity==='Sector'&&r.data.name===d.sector))throw fail(409,'Setor de colaborador remoto inexistente.');
   if(change.entity==='Employee'&&d.function&&!values.some(r=>r.entity==='JobRole'&&r.data.name===d.function&&(!r.data.sector_name||r.data.sector_name===d.sector)))throw fail(409,'Função remota incompatível.');
   if(change.entity==='InventoryItem'&&d.preferred_supplier_id){const supplier=records.get(d.preferred_supplier_id);if(!supplier||supplier.entity!=='Supplier'||supplier.data.name!==d.preferred_supplier_name)throw fail(409,'Fornecedor remoto inexistente.');}
  }
  const changes=[];
  for(const change of command.changes){
   const row=records.get(change.id),nameKey=change.entity==='SystemSettings'?'singleton':sectorKey(row.data.name);
   await c.query('INSERT INTO d1_central_records(workspace_id,entity,id,data,name_key,version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,id) DO UPDATE SET data=excluded.data,name_key=excluded.name_key,version=excluded.version',[p.workspace_id,row.entity,row.id,row.data,nameKey,row.version]);
   changes.push({entity:row.entity,id:row.id,version:row.version,data:row.data});
  }
  const cursor=Number((await c.query('UPDATE d1_central_clock SET cursor=cursor+1 WHERE singleton RETURNING cursor')).rows[0].cursor);
  const receipt={protocol:'D1LAB/1',operationId:command.operationId,deviceId:p.device_id,actorId:p.actor_id,workspaceId:p.workspace_id,payloadHash:hash,cursor,confirmedAt:new Date().toISOString(),changes:changes.map(r=>({entity:r.entity,id:r.id,version:r.version,dataHash:syncHash(r.data)}))};
  await c.query('INSERT INTO d1_central_receipts VALUES($1,$2,$3,$4,$5,$6)',[command.operationId,p.device_id,p.actor_id,p.workspace_id,hash,receipt]);
  await c.query('INSERT INTO d1_central_changes VALUES($1,$2,$3,$4,$5)',[cursor,command.operationId,p.workspace_id,p.device_id,JSON.stringify(changes)]);
  return receipt;
 });
}
export async function changesD1(pool,token,cursor){
 if(!Number.isSafeInteger(cursor)||cursor<0)throw fail(400,'Cursor D1 inválido.');
 const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const p=await authorize(c,token);
  const head=Number((await c.query('SELECT cursor FROM d1_central_clock WHERE singleton')).rows[0].cursor);
  if(cursor>head)throw fail(409,'Central anterior ao cursor; reconciliação obrigatória.');
  const events=(await c.query('SELECT * FROM d1_central_changes WHERE workspace_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 100',[p.workspace_id,cursor])).rows.map(e=>({...e,cursor:Number(e.cursor)}));
  const hasMore=events.length===100;
  await c.query('COMMIT');return {protocol:'D1LAB/1',events,head,cursor:hasMore?events.at(-1).cursor:head,hasMore};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
