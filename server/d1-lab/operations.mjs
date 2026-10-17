import {businessConfirmation} from './business-projection.mjs';
import {transaction,fail,uuid} from './core.mjs';
import {randomUUID} from 'node:crypto';
import {syncHash} from './sync-contract.mjs';
import {record} from './entities.mjs';
import {catalogSave} from './catalog.mjs';
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min&&n<=1e12;
const safe=n=>{if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw fail(400,'Limite numérico excedido.');return Number(n);};
const stableId=value=>{const hex=syncHash(value);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);};
async function changeStock(c,actor,operationId,input,delta,type,unitCents){
 if(!uuid(input.itemId)||!integer(input.baseVersion)||!Number.isSafeInteger(delta)||!delta||Math.abs(delta)>1e12)throw fail(400,'Item, versão ou quantidade inválidos.');
 const item=(await c.query("SELECT * FROM d2_catalog WHERE owner_id=$1 AND id=$2 AND entity='InventoryItem' FOR UPDATE",[actor,input.itemId])).rows[0];
 if(!item||item.data.status!=='ativo')throw fail(409,'Item ativo obrigatório no escopo local.');
 await c.query('INSERT INTO d1_stock_balances(owner_id,item_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor,input.itemId]);
 const old=(await c.query('SELECT * FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2 FOR UPDATE',[actor,input.itemId])).rows[0];
 if(Number(old.version)!==input.baseVersion)throw fail(409,'Saldo alterado por outro comando; recarregue.');
 if(delta<0&&BigInt(old.quota_milli)<BigInt(-delta))throw fail(409,'Limite local insuficiente; saldo global não pode ser confirmado offline.');
 if(delta>0&&!integer(unitCents))throw fail(400,'Custo em centavos inválido.');
 const quantity=safe(BigInt(old.quantity_milli)+BigInt(delta)),quota=safe(BigInt(old.quota_milli)+BigInt(delta));
 if(quantity<0||quota<0)throw fail(409,'Estoque/limite insuficiente.');
 const cost=delta>0?unitCents:Number(old.average_cents);
 const average=delta>0&&quantity>0?safe((BigInt(old.quantity_milli)*BigInt(old.average_cents)+BigInt(delta)*BigInt(cost)+BigInt(Math.floor(quantity/2)))/BigInt(quantity)):Number(old.average_cents);
 await c.query('UPDATE d1_stock_balances SET quantity_milli=$3,quota_milli=$4,average_cents=$5,last_cents=$6,version=version+1 WHERE owner_id=$1 AND item_id=$2',[actor,input.itemId,quantity,quota,average,delta>0?cost:Number(old.last_cents)]);
 const movement={id:randomUUID(),itemId:input.itemId,itemName:item.data.name,quantityMilli:delta,balanceMilli:quantity,unitCents:cost,version:input.baseVersion+1};
 await c.query('INSERT INTO d1_stock_movements(id,owner_id,operation_id,item_id,item_name,unit,quantity_milli,unit_cents,balance_after,movement_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[movement.id,actor,operationId,input.itemId,item.data.name,item.data.unit,delta,cost,quantity,type]);
 return movement;
}
export async function applyOperational(c,user,deviceId,body,hook=async()=>{}){
 if(!uuid(body?.operationId)||!['entry','exit','adjust','production','consume','journal'].includes(body.kind))throw fail(400,'Comando operacional inválido.');
 if(Object.keys(body).some(k=>!['operationId','kind','itemId','baseVersion','quantityMilli','targetMilli','unitCents','inputs','output','entries'].includes(k)))throw fail(400,'Campos operacionais não permitidos.');
 const actor=(await c.query("SELECT id,role FROM lab_users WHERE id=$1 AND active FOR SHARE",[user.id])).rows[0];
 if(actor?.role!=='admin')throw fail(403,'Operações críticas exigem administrador sintético neste piloto.');
 const hash=syncHash(body),prior=(await c.query('SELECT * FROM lab_outbox WHERE operation_id=$1',[body.operationId])).rows[0];
 if(prior){if(prior.actor!==actor.id||prior.payload_hash!==hash||prior.entity!=='OperationalEvent')throw fail(409,'UUID operacional reutilizado.');return {...prior.result,replay:true};}
 const effects=[];
 if(['entry','exit','adjust'].includes(body.kind)){
  let delta=body.kind==='entry'?body.quantityMilli:-body.quantityMilli;
  if(body.kind==='adjust'){
   if(!integer(body.targetMilli))throw fail(400,'Saldo alvo inválido.');
   const previous=(await c.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2',[actor.id,body.itemId])).rows[0];
   delta=body.targetMilli-Number(previous?.quantity_milli??0);
  }else if(!integer(body.quantityMilli,1))throw fail(400,'Quantidade inválida.');
  effects.push(await changeStock(c,actor.id,body.operationId,body,delta,body.kind==='entry'?'entrada_manual':body.kind==='exit'?'saida_manual':'inventario',body.unitCents??0));
 }else if(['production','consume'].includes(body.kind)){
  if(!Array.isArray(body.inputs)||!body.inputs.length||body.inputs.length>20||new Set(body.inputs.map(i=>i.itemId)).size!==body.inputs.length||(body.kind==='production'&&(!body.output||body.inputs.some(i=>i.itemId===body.output.itemId)||!integer(body.output.quantityMilli,1))))throw fail(400,'Insumos e produto inválidos.');
  let total=0n;
  for(const input of body.inputs){if(!integer(input.quantityMilli,1))throw fail(400,'Quantidade de insumo inválida.');const used=await changeStock(c,actor.id,body.operationId,input,-input.quantityMilli,'consumo_producao');effects.push(used);total+=BigInt(input.quantityMilli)*BigInt(used.unitCents);}
  if(body.kind==='production')effects.push(await changeStock(c,actor.id,body.operationId,body.output,body.output.quantityMilli,'entrada_producao',safe((total+BigInt(Math.floor(body.output.quantityMilli/2)))/BigInt(body.output.quantityMilli))));
 }else{
  const entries=body.entries;
  if(!Array.isArray(entries)||entries.length<2||entries.length>5||new Set(entries.map(e=>e.account)).size!==entries.length||entries.some(e=>!['cash','bank','expense','revenue','equity'].includes(e.account)||!Number.isSafeInteger(e.cents)||!e.cents||Math.abs(e.cents)>1e12||!integer(e.baseVersion))||entries.reduce((s,e)=>s+BigInt(e.cents),0n)!==0n)throw fail(400,'Partidas devem ser balanceadas em centavos e versionadas.');
  for(const entry of entries){
   await c.query('INSERT INTO d1_financial_accounts(owner_id,account) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.id,entry.account]);
   const old=(await c.query('SELECT * FROM d1_financial_accounts WHERE owner_id=$1 AND account=$2 FOR UPDATE',[actor.id,entry.account])).rows[0];
   if(Number(old.version)!==entry.baseVersion)throw fail(409,'Conta financeira alterada; recarregue.');
   const balance=safe(BigInt(old.balance_cents)+BigInt(entry.cents));
   if(['cash','bank'].includes(entry.account)&&balance<0)throw fail(409,'Limite financeiro local insuficiente.');
   await c.query('UPDATE d1_financial_accounts SET balance_cents=$3,version=version+1 WHERE owner_id=$1 AND account=$2',[actor.id,entry.account,balance]);
   await c.query('INSERT INTO d1_financial_entries(owner_id,operation_id,account,cents) VALUES($1,$2,$3,$4)',[actor.id,body.operationId,entry.account,entry.cents]);
   effects.push({account:entry.account,cents:entry.cents,balanceCents:balance,version:entry.baseVersion+1});
  }
 }
 const result={operationId:body.operationId,effects,replay:false,businessConfirmed:false,externalConfirmed:false};
 const data={name:'FICTICIO '+body.kind+' '+body.operationId,kind:body.kind,command_json:JSON.stringify(body),result_json:JSON.stringify(result),status:'pending-central',source_device_id:deviceId};
 if(Object.values(data).some(v=>v.length>4000))throw fail(413,'Agregado excede o limite de homologação.');
 const row=(await c.query("INSERT INTO d1_operation_events(id,owner_id,entity,data,name_key) VALUES($1,$2,'OperationalEvent',$3,$4) RETURNING *",[body.operationId,actor.id,data,body.operationId])).rows[0];
 result.record=record(row);
 await c.query("INSERT INTO lab_outbox(operation_id,device_id,actor,entity,record_id,operation,base_version,record_version,payload_hash,payload,result) VALUES($1,$2,$3,'OperationalEvent',$1,'create',NULL,1,$4,$5,$6)",[body.operationId,deviceId,actor.id,hash,data,result]);
 await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[actor.id,'operational:'+body.kind,body.operationId]);
 await hook(c);return result;
}
export async function operationalCommand(pool,user,deviceId,body,hook=async()=>{}){
 return transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);return applyOperational(c,user,deviceId,body,hook);});
}
export async function createStockItem(pool,user,deviceId,body){
 if(!uuid(body?.itemId)||!uuid(body.operationId)||!integer(body.initialMilli)||!integer(body.unitCents))throw fail(400,'Cadastro/estoque inicial inválido.');
 const {itemId,operationId,data,initialMilli,unitCents}=body;
 return catalogSave(pool,user,deviceId,'InventoryItem',itemId,{operationId,operation:'create',baseVersion:null,data},async c=>{
  if(initialMilli>0)await applyOperational(c,user,deviceId,{operationId:stableId(operationId),kind:'entry',itemId,baseVersion:0,quantityMilli:initialMilli,unitCents},async()=>{});
 },{initialMilli,unitCents});
}
export async function operationalState(pool,user){
 if(user.role!=='admin')throw fail(403,'Estado operacional restrito ao administrador sintético.');
 const movements=(await pool.query('SELECT * FROM d1_stock_movements WHERE owner_id=$1 ORDER BY created_at DESC,id',[user.id])).rows.map(r=>({id:r.id,item_id:r.item_id,item_name:r.item_name,unit:r.unit,quantity:Math.abs(Number(r.quantity_milli))/1000,unit_cost:Number(r.unit_cents)/100,total_cost:Math.abs(Number(r.quantity_milli))*Number(r.unit_cents)/100000,balance_after:Number(r.balance_after)/1000,movement_type:r.movement_type,date:r.created_at,created_date:r.created_at,responsible_user:'Operador fictício local'}));
 return {movements,balances:(await pool.query('SELECT * FROM d1_stock_balances WHERE owner_id=$1',[user.id])).rows,accounts:(await pool.query('SELECT * FROM d1_financial_accounts WHERE owner_id=$1 ORDER BY account',[user.id])).rows,businessConfirmed:await businessConfirmation(pool,user.id),operationalSyncEnabled:false};
}
