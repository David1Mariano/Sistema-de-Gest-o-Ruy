import {ledgerAccount,assetAccount} from '../d1-lab/ledger-contract.mjs';
import {fail,uuid} from '../d1-lab/core.mjs';
import {syncHash} from '../d1-lab/sync-contract.mjs';
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min&&value<=1e12;
const safe=value=>{if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw fail(400,'Business numeric limit.');return Number(value);};
const payload=record=>JSON.parse(record?.data.payload_json||'{}');
async function stock(c,workspace,operation,records,input,delta,kind,cost){
 if(!uuid(input.itemId)||!integer(input.baseVersion)||!Number.isSafeInteger(delta)||!delta||Math.abs(delta)>1e12)throw fail(400,'Invalid stock command.');
 const item=records.get(input.itemId);if(item?.entity!=='InventoryItem'||item.data.status!=='ativo')throw fail(409,'Active inventory reference required.');
 const old=(await c.query('SELECT * FROM d1_business_stock WHERE workspace=$1 AND item=$2 FOR UPDATE',[workspace,input.itemId])).rows[0]||{quantity:0,average:0,last_cost:0,version:0};
 if(Number(old.version)!==input.baseVersion)throw fail(409,'Authoritative stock version conflict.');
 if(delta>0&&!integer(cost))throw fail(400,'Invalid stock cost.');
 const quantity=safe(BigInt(old.quantity)+BigInt(delta));if(quantity<0)throw fail(409,'Authoritative stock insufficient.');
 const unit=delta>0?cost:Number(old.average),average=delta>0?safe((BigInt(old.quantity)*BigInt(old.average)+BigInt(delta)*BigInt(unit)+BigInt(Math.floor(quantity/2)))/BigInt(quantity)):Number(old.average);
 await c.query('INSERT INTO d1_business_stock VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace,item) DO UPDATE SET quantity=excluded.quantity,average=excluded.average,last_cost=excluded.last_cost,version=excluded.version',[workspace,input.itemId,quantity,average,delta>0?unit:Number(old.last_cost),Number(old.version)+1]);
 await c.query('INSERT INTO d1_business_movements VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[workspace,operation,input.itemId,delta,unit,quantity,kind,item.data.name,item.data.unit]);return unit;
}
async function journal(c,workspace,operation,entries,cas=true){
 if(!Array.isArray(entries)||entries.length<2||entries.length>5||new Set(entries.map(e=>e.account)).size!==entries.length||entries.some(e=>!ledgerAccount(e.account)||!Number.isSafeInteger(e.cents)||!e.cents||Math.abs(e.cents)>1e12||cas&&!integer(e.baseVersion))||entries.reduce((sum,e)=>sum+BigInt(e.cents),0n)!==0n)throw fail(400,'Balanced integer journal required.');
 for(const entry of [...entries].sort((a,b)=>a.account.localeCompare(b.account))){
  const old=(await c.query('SELECT * FROM d1_business_accounts WHERE workspace=$1 AND account=$2 FOR UPDATE',[workspace,entry.account])).rows[0]||{balance:0,version:0};
  if(cas&&Number(old.version)!==entry.baseVersion)throw fail(409,'Authoritative account version conflict.');
  const balance=safe(BigInt(old.balance)+BigInt(entry.cents));if(assetAccount(entry.account)&&balance<0)throw fail(409,'Authoritative funds insufficient.');
  await c.query('INSERT INTO d1_business_accounts VALUES($1,$2,$3,$4) ON CONFLICT(workspace,account) DO UPDATE SET balance=excluded.balance,version=excluded.version',[workspace,entry.account,balance,Number(old.version)+1]);
  await c.query('INSERT INTO d1_business_entries VALUES($1,$2,$3,$4)',[workspace,operation,entry.account,entry.cents]);
 }
}
async function operation(c,workspace,change,records){
 const command=JSON.parse(change.data.command_json),id=command.operationId;
 if(id!==change.id||Object.keys(command).some(key=>!['operationId','kind','itemId','baseVersion','quantityMilli','targetMilli','unitCents','inputs','output','entries','referenceId','reason'].includes(key)))throw fail(400,'Invalid business command fields.');
 if(command.kind==='journal'){
  for(const entry of command.entries||[])if(entry.account?.startsWith('account:')){const row=records.get(entry.account.slice(8));if(row?.entity!=='FinancialAccount'||payload(row).status!=='ativo')throw fail(409,'Active mapped financial account required.');}
  return journal(c,workspace,id,command.entries);
 }
 if(command.kind==='reversal')return reverse(c,workspace,command,records);
 if(['entry','exit','adjust'].includes(command.kind)){
  if(command.kind==='adjust'?!integer(command.targetMilli):!integer(command.quantityMilli,1))throw fail(400,'Invalid stock quantity.');
  const old=(await c.query('SELECT quantity FROM d1_business_stock WHERE workspace=$1 AND item=$2',[workspace,command.itemId])).rows[0];
  const delta=command.kind==='adjust'?command.targetMilli-Number(old?.quantity||0):command.quantityMilli*(command.kind==='exit'?-1:1);
  return stock(c,workspace,id,records,command,delta,command.kind,command.unitCents??0);
 }
 if(!['production','consume'].includes(command.kind)||!Array.isArray(command.inputs)||!command.inputs.length||command.inputs.length>20||new Set(command.inputs.map(i=>i.itemId)).size!==command.inputs.length)throw fail(400,'Invalid production command.');
 let cost=0n;
 for(const input of command.inputs){if(!integer(input.quantityMilli,1))throw fail(400,'Invalid production input.');cost+=BigInt(input.quantityMilli)*BigInt(await stock(c,workspace,id,records,input,-input.quantityMilli,'consume'));}
 if(command.kind==='production'){
  const out=command.output;if(!out||!integer(out.quantityMilli,1)||command.inputs.some(i=>i.itemId===out.itemId))throw fail(400,'Invalid production output.');
  await stock(c,workspace,id,records,out,out.quantityMilli,'production',safe((cost+BigInt(Math.floor(out.quantityMilli/2)))/BigInt(out.quantityMilli)));
 }
}
async function reverse(c,workspace,command,records){
 if(!uuid(command.referenceId)||typeof command.reason!=='string'||command.reason.trim().length<8||command.reason.length>300)throw fail(400,'Reversal reference and reason required.');
 if((await c.query('SELECT 1 FROM d1_business_reversals WHERE workspace=$1 AND reference=$2',[workspace,command.referenceId])).rowCount)throw fail(409,'Source already reversed.');
 if((await c.query('SELECT 1 FROM d1_business_reversals WHERE workspace=$1 AND operation=$2',[workspace,command.referenceId])).rowCount)throw fail(409,'Reversing a reversal is not supported.');
 const moves=(await c.query('SELECT * FROM d1_business_movements WHERE workspace=$1 AND operation=$2 ORDER BY item',[workspace,command.referenceId])).rows;
 const entries=(await c.query('SELECT * FROM d1_business_entries WHERE workspace=$1 AND operation=$2 ORDER BY account',[workspace,command.referenceId])).rows;
 if(!moves.length&&!entries.length)throw fail(409,'Original central effects required.');
 if((command.inputs?.length||0)!==moves.length||(command.entries?.length||0)!==entries.length)throw fail(400,'Exact reversal scope required.');
 for(const move of moves){const input=command.inputs?.find(i=>i.itemId===move.item);if(!input)throw fail(400,'Reversal stock version required.');await stock(c,workspace,command.operationId,records,input,-Number(move.delta),'reversal',Number(move.cost));}
 if(entries.length)await journal(c,workspace,command.operationId,entries.map(entry=>{const input=command.entries?.find(i=>i.account===entry.account);if(!input)throw fail(400,'Reversal account version required.');return {account:entry.account,cents:-Number(entry.cents),baseVersion:input.baseVersion};}));
 await c.query('INSERT INTO d1_business_reversals VALUES($1,$2,$3,$4)',[workspace,command.referenceId,command.operationId,command.reason]);
}
export async function applyBusiness(c,p,command,records){
 const changed=new Set(command.changes.map(change=>change.id));
 const reversals=command.changes.filter(change=>change.entity==='OperationalEvent'&&change.data.kind==='reversal').map(change=>JSON.parse(change.data.command_json));
 for(const reversal of reversals){
  for(const row of records.values()){const d=payload(row);if(row.entity==='DailyProduction'&&d.confirmation_id===reversal.referenceId&&d.local_status!=='cancelado')throw fail(409,'Reverse production document and consumption together.');if(['EmployeePayment','AccountsPayable'].includes(row.entity)&&d.financial_expense_id===reversal.referenceId&&d.status!=='cancelado')throw fail(409,'Linked financial obligation must be cancelled atomically.');}
  const settled=(await c.query('SELECT 1 FROM d1_business_settlements WHERE workspace=$1 AND record_id=$2',[p.workspace_id,reversal.referenceId])).rowCount;
  if(settled){const change=command.changes.find(item=>item.id===reversal.referenceId);if(!change||payload(records.get(change.id)).status!=='cancelado')throw fail(409,'Reversal requires cancelled financial aggregate.');}
 }
 for(const change of command.changes){
  const d=payload(records.get(change.id));
  if(change.entity==='ProductionOrder'&&d.status==='concluida'){
   const daily=command.changes.find(row=>row.entity==='DailyProduction'&&payload(records.get(row.id)).production_order_id===change.id&&payload(records.get(row.id)).local_status==='confirmado');
   if(!daily||payload(records.get(daily.id)).produced_quantity!==d.produced_quantity)throw fail(409,'Complete order and confirmed production must share one aggregate.');
  }
  if(change.entity==='DailyProduction'){
   if(!Number.isFinite(d.produced_quantity)||d.produced_quantity<=0||!Number.isFinite(d.loss_quantity)||!Number.isFinite(d.leftover_quantity)||d.loss_quantity<0||d.leftover_quantity<0||d.loss_quantity+d.leftover_quantity>d.produced_quantity||!Array.isArray(d.losses)||d.losses.length>20||d.losses.some(l=>!Number.isFinite(l.quantity)||l.quantity<=0||typeof l.reason!=='string'||!l.reason.trim()||l.reason.length>500||typeof l.responsible!=='string'||!l.responsible.trim()||l.responsible.length>500||l.unit!==d.unit||!/^\d{4}-\d{2}-\d{2}$/.test(l.date||''))||d.loss_quantity>0&&!d.losses.length||Math.abs(d.losses.reduce((n,l)=>n+l.quantity,0)-d.loss_quantity)>1e-6)throw fail(400,'Invalid production loss aggregate.');
   const previous=(await c.query('SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,change.id])).rows[0],old=previous?payload({data:previous.data}):null;
   if(d.local_status==='rascunho'){
    const recipe=records.get(d.product_id),source=payload(recipe);
    if(recipe?.entity!=='ProductionProduct'||source.status!=='ativo'||d.recipe_yield!==source.yield_quantity||syncHash(d.recipe_snapshot)!==syncHash(source.ingredients)||d.source_device_id!==command.deviceId)throw fail(409,'Approved production recipe snapshot required.');
   }
   if(old?.local_status==='cancelado'&&syncHash(d)!==syncHash(old)||old?.local_status==='confirmado'&&d.local_status==='confirmado'&&syncHash(d)!==syncHash(old))throw fail(409,'Confirmed/cancelled production is immutable.');
   if(d.production_order_id){
    const order=records.get(d.production_order_id);if(order?.entity!=='ProductionOrder'||payload(order).product_id!==d.product_id)throw fail(409,'Production order mismatch.');
    if(d.local_status!=='cancelado'&&[...records.values()].some(row=>row.entity==='DailyProduction'&&row.id!==change.id&&payload(row).production_order_id===d.production_order_id&&payload(row).local_status!=='cancelado'))throw fail(409,'Production order already assigned.');
   }
   if(d.local_status==='confirmado'&&old?.local_status!=='confirmado'){
    if(old?.local_status!=='rascunho'||d.confirmation_id!==command.operationId)throw fail(409,'Production confirmation aggregate required.');
    if(syncHash(d.recipe_snapshot)!==syncHash(old.recipe_snapshot)||d.recipe_yield!==old.recipe_yield||d.produced_quantity!==old.produced_quantity||d.loss_quantity!==old.loss_quantity||syncHash(d.losses)!==syncHash(old.losses))throw fail(409,'Production changed during confirmation.');
    if(!Number.isFinite(d.produced_quantity)||d.produced_quantity<=0||!Number.isFinite(d.recipe_yield)||d.recipe_yield<=0||!Array.isArray(d.recipe_snapshot)||!d.recipe_snapshot.length||!Array.isArray(d.losses)||d.loss_quantity<0||d.loss_quantity>d.produced_quantity||d.loss_quantity>0&&!d.losses.length||Math.abs(d.losses.reduce((n,l)=>n+l.quantity,0)-d.loss_quantity)>1e-6)throw fail(400,'Invalid production losses/recipe.');
    const event=command.changes.find(e=>e.entity==='OperationalEvent'),input=event&&JSON.parse(event.data.command_json);
    if(input?.kind!=='consume'||input.inputs.length!==d.recipe_snapshot.length)throw fail(409,'Atomic production consumption required.');
    for(const line of d.recipe_snapshot){const item=input.inputs.find(i=>i.itemId===line.inventory_item_id),exact=line.quantity*d.produced_quantity/d.recipe_yield*1000,required=Math.round(exact);if(Math.abs(exact-required)>1e-6||!item||required<=0||item.quantityMilli!==required)throw fail(409,'Production consumption differs from recipe.');}
   }
   if(d.local_status==='cancelado'&&old?.local_status==='confirmado'&&!reversals.some(r=>r.referenceId===old.confirmation_id))throw fail(409,'Production cancellation requires exact reversal.');
  }
  if(change.entity==='InventoryItem'){
   const old=(await c.query('SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,change.id])).rows[0];
   if(old&&old.data.unit!==change.data.unit&&(await c.query('SELECT 1 FROM d1_business_movements WHERE workspace=$1 AND item=$2 LIMIT 1',[p.workspace_id,change.id])).rowCount)throw fail(409,'Stock unit conversion requires an explicit migration; history preserved.');
  }
  if(['EmployeePayment','AccountsPayable','CardReceivable','DeliverySettlement'].includes(change.entity)){
   const previous=(await c.query('SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,change.id])).rows[0],old=previous?payload({data:previous.data}):null;
   if(old&&['pago','recebido'].includes(old.status)&&!['pago','recebido'].includes(d.status)){
    const reference=old.financial_expense_id||old.accounts_receivable_id;
    if(d.status!=='cancelado'||!reference||!changed.has(reference)||!reversals.some(r=>r.referenceId===reference))throw fail(409,'Linked settlement requires exact atomic reversal.');
   }
  }
  if(change.entity==='EmployeePayment'&&d.status==='pago'){
   const expense=records.get(d.financial_expense_id),e=payload(expense);
   if(expense?.entity!=='FinancialExpense'||!changed.has(expense.id)||e.status!=='pago'||e.linked_payment_id!==change.id||e.amount!==d.net_amount||e.beneficiary_id!==d.employee_id||typeof d.gross_amount!=='number'||typeof d.discount_amount!=='number'||d.discount_amount<0||Math.round((d.gross_amount-d.discount_amount)*100)!==Math.round(d.net_amount*100))throw fail(409,'Paid payroll requires its balanced expense aggregate.');
  }
  if(change.entity==='AccountsPayable'&&d.status==='pago'){
   const expense=records.get(d.financial_expense_id),e=payload(expense);
   if(expense?.entity!=='FinancialExpense'||!changed.has(expense.id)||e.accounts_payable_id!==change.id||e.amount!==d.amount||e.status!=='pago')throw fail(409,'Paid payable requires its expense aggregate.');
  }
  if(['CardReceivable','DeliverySettlement'].includes(change.entity)&&d.status==='recebido'){
   const receivable=records.get(d.accounts_receivable_id),r=payload(receivable);
   if(receivable?.entity!=='AccountsReceivable'||!changed.has(receivable.id)||r.source_id!==change.id||r.net_amount!==d.net_amount||r.status!=='recebido')throw fail(409,'Received origin requires its receivable aggregate.');
  }
 }

 for(const change of command.changes)if(change.entity==='OperationalEvent')await operation(c,p.workspace_id,change,records);
 for(const change of command.changes){
  const d=payload(records.get(change.id));
  if(!['FinancialExpense','Revenue','AccountsReceivable'].includes(change.entity))continue;
  const debit=change.entity==='FinancialExpense',paid=d.status===(debit?'pago':'recebido');
  const old=(await c.query('SELECT * FROM d1_business_settlements WHERE workspace=$1 AND record_id=$2',[p.workspace_id,change.id])).rows[0];
  if(!paid){if(old&&!reversals.some(r=>r.referenceId===change.id))throw fail(409,'Settled document requires an explicit reversal.');continue;}
  if(d.financial_account_id){const row=records.get(d.financial_account_id);if(row?.entity!=='FinancialAccount'||payload(row).status!=='ativo')throw fail(409,'Active owned financial account required.');}
  const amount=debit?d.amount:d.net_amount,cents=Math.round(amount*100);if(typeof amount!=='number'||!integer(cents,1)||Math.abs(amount*100-cents)>1e-6)throw fail(400,'Invalid settled amount.');
  const account=d.financial_account_id?'account:'+d.financial_account_id:change.entity==='AccountsReceivable'?'bank':['dinheiro','cash'].includes(d.payment_method||'dinheiro')?'cash':'bank';
  // One obligation may be paid once even if devices generate different expense UUIDs.
  let obligation=change.entity+':'+change.id;
  if(debit&&d.document_number&&!d.accounts_payable_id&&!d.linked_payment_id){
   const vendor=d.beneficiary_id||d.beneficiary_name;
   if(typeof vendor!=='string'||!vendor.trim()||typeof d.document_number!=='string')throw fail(409,'Invoice settlement requires supplier identity.');
   obligation='invoice:'+vendor.trim().toLowerCase()+':'+d.document_number.trim().toLowerCase();
  }
  if(debit&&d.accounts_payable_id){
   const payable=payload(records.get(d.accounts_payable_id));if(payable.status!=='pago'||!changed.has(d.accounts_payable_id)||payable.financial_expense_id!==change.id||payable.amount!==d.amount)throw fail(409,'Payable settlement aggregate mismatch.');
   obligation='payable:'+d.accounts_payable_id;
  }
  else if(debit&&d.linked_payment_id){
   const payment=payload(records.get(d.linked_payment_id));
   if(payment.financial_expense_id!==change.id||!changed.has(d.linked_payment_id)||payment.status!=='pago'||payment.net_amount!==d.amount||payment.employee_id!==d.beneficiary_id)throw fail(409,'Payroll settlement aggregate mismatch.');
   if(['salario','diaria'].includes(payment.payment_type)){
    const period=payment.payment_type==='salario'?payment.reference_start+'..'+payment.reference_end:payment.work_date;
    if(!/^\d{4}-\d{2}-\d{2}(?:\.\.\d{4}-\d{2}-\d{2})?$/.test(period||''))throw fail(409,'Payroll obligation period required.');
    obligation='payroll:'+payment.employee_id+':'+payment.payment_type+':'+period;
   }else obligation='payment:'+d.linked_payment_id;
  }
  const signature=syncHash({obligation,cents,account,beneficiary:d.beneficiary_id||null});
  if(old){if((await c.query('SELECT 1 FROM d1_business_reversals WHERE workspace=$1 AND reference=$2',[p.workspace_id,change.id])).rowCount)throw fail(409,'Reversed settlement cannot be reopened.');if(old.signature!==signature||old.obligation!==obligation)throw fail(409,'Settled amount/obligation is immutable.');continue;}
  const duplicate=(await c.query('SELECT record_id FROM d1_business_settlements WHERE workspace=$1 AND obligation=$2',[p.workspace_id,obligation])).rows[0];
  if(duplicate)throw fail(409,'Obligation already settled by another command.');
  const id=change.id;
  await journal(c,p.workspace_id,id,[{account,cents:debit?-cents:cents},{account:debit?'expense':'revenue',cents:debit?cents:-cents}],false);
  await c.query('INSERT INTO d1_business_settlements VALUES($1,$2,$3,$4)',[p.workspace_id,obligation,id,signature]);
 }
}
export async function businessSnapshot(c,workspace,head){
 const legacy=(await c.query("SELECT 1 FROM d1_central_receipts WHERE workspace_id=$1 AND coalesce(result->'business'->>'confirmed','false')<>'true' LIMIT 1",[workspace])).rowCount;
 const result={protocol:'D1BUS/1',workspaceId:workspace,head,complete:!legacy};
 for(const [key,table,order] of [['stock','stock','item'],['accounts','accounts','account'],['movements','movements','operation,item'],['entries','entries','operation,account'],['settlements','settlements','obligation'],['reversals','reversals','reference']])result[key]=(await c.query(`SELECT * FROM d1_business_${table} WHERE workspace=$1 ORDER BY ${order}`,[workspace])).rows;
 return result;
}
