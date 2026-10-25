import {installation,validateHome,database} from './environment.mjs';
import {deliveryCapability} from './capabilities.mjs';
import {fail} from './core.mjs';
import {deliveryFields,isDelivery,validateDeliveryPayload,deliveryTotals,validateDeliveryEvolution} from './delivery-contract.mjs';
export const deliveryEnabled=deliveryCapability;
export function assertDeliveryLab(){if(!deliveryEnabled())throw fail(403,'Delivery restrito ao laboratório isolado autorizado.');}
export async function assertDeliveryDatabase(c){
 assertDeliveryLab();const target=(await c.query("SELECT current_setting('port') AS port,current_database() AS database")).rows[0];
 if(installation?.delivery){
  const marker=await validateHome();
  if(target.port!==String(installation.dbPort)||!(target.database===database||/^ruy_d1_rc_[a-f0-9]{16}$/.test(target.database)))throw fail(403,'Delivery installation target mismatch.');
  if(target.database===database&&(await c.query('SELECT id FROM lab_device WHERE singleton')).rows[0]?.id!==marker.deviceId)throw fail(403,'Delivery device identity mismatch.');
  return;
 }
 if(target.port!=='55437'||!/^ruy_d1_rc_[a-f0-9]{16}$/.test(target.database))throw fail(403,'Delivery exige banco novo no clone descartável 55437.');
}
const conflict=message=>{throw fail(409,message);};
export async function prepareDelivery(c,actor,body,old){
 await assertDeliveryDatabase(c);
 if(body.entity!=='DeliveryOrder'){
  if(body.action!=='save')throw fail(409,'Cadastro Delivery usa edição versionada e inativação.');
  const supplied=body.data;if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!deliveryFields[body.entity].includes(k)&&!['id','_version','created_date','updated_date'].includes(k)))throw fail(400,'Campos de cadastro Delivery inválidos.');
  const payload=Object.fromEntries(Object.entries(supplied).filter(([k])=>deliveryFields[body.entity].includes(k)));validateDeliveryPayload(body.entity,payload,{synthetic:!installation?.operationalCandidate});return payload;
 }
 if(!['save','transition','cancel'].includes(body.action))conflict('Pagamento e reembolso Delivery não integrados ao financeiro central.');
 const supplied=body.data||{};
 if(Object.keys(supplied).some(k=>!deliveryFields.DeliveryOrder.includes(k)&&!['id','_version','created_date','updated_date'].includes(k)))throw fail(400,'Campos Delivery inválidos.');
 const reference=async(id,entity)=>{const row=(await c.query('SELECT data FROM d2_catalog WHERE owner_id=$1 AND id=$2 AND entity=$3 FOR SHARE',[actor.id,id,entity])).rows[0];const data=row?JSON.parse(row.data.payload_json):null;if(!data||data.status!=='ativo')conflict('Referência Delivery ausente ou inativa.');return data;};
 let next;
 if(body.action==='save'){
  if(old&&old.status!=='placed')conflict('Somente pedido novo permite editar itens.');
  if(supplied.financialStatus&&supplied.financialStatus!=='unpaid'||supplied.status&&supplied.status!=='placed')conflict('Estado derivado exige transição autorizada.');
  await reference(supplied.customerId,'DeliveryCustomer');if(supplied.driverId)await reference(supplied.driverId,'DeliveryDriver');
  if(!Array.isArray(supplied.items)||!supplied.items.length||supplied.items.length>10)throw fail(400,'Pedido exige entre 1 e 10 itens.');
  const items=[];for(const item of supplied.items){const menu=await reference(item.menuItemId,'DeliveryMenuItem');items.push({id:item.id,menuItemId:item.menuItemId,name:menu.name,quantityMilli:item.quantityMilli,unitCents:menu.unitCents,lineCents:0});}
  next={date:supplied.date,provider:supplied.provider,fulfillment:supplied.fulfillment,customerId:supplied.customerId,driverId:supplied.driverId||'',items,discountCents:supplied.discountCents,deliveryCents:supplied.deliveryCents,platformCents:supplied.platformCents,paymentFeeCents:supplied.paymentFeeCents,status:'placed',financialStatus:'unpaid',cancelReason:''};
  Object.assign(next,deliveryTotals(next));for(const item of items)item.lineCents=Number((BigInt(item.quantityMilli)*BigInt(item.unitCents)+500n)/1000n);
 }else{
  if(!old)conflict('Pedido não encontrado.');
  if(body.action==='transition'&&Object.keys(supplied).some(k=>k!=='status'))throw fail(400,'Transição aceita apenas o novo status.');
  if(body.action==='cancel'&&Object.keys(supplied).length)throw fail(400,'Cancelamento não aceita alteração do pedido.');
  const payload=Object.fromEntries(Object.entries(old).filter(([k])=>deliveryFields.DeliveryOrder.includes(k)));
  next={...payload,status:body.action==='cancel'?'cancelled':supplied.status,cancelReason:body.action==='cancel'?body.reason||'':''};
  if(next.status==='dispatched')await reference(next.driverId,'DeliveryDriver');
 }
 validateDeliveryPayload(body.entity,next,{synthetic:!installation?.operationalCandidate});try{validateDeliveryEvolution(old,next);}catch{conflict('Transição ou edição Delivery inválida.');}return next;
}
export async function validateDeliveryChanges(c,command,records,known){
 if(!command.changes.some(change=>isDelivery(change.entity)))return;
 await assertDeliveryDatabase(c);if(command.changes.length!==1)throw fail(400,'Envelope Delivery deve conter um único agregado.');
 for(const change of command.changes){
  const next=JSON.parse(change.data.payload_json);validateDeliveryPayload(change.entity,next);
  if(change.entity!=='DeliveryOrder')continue;
  const prior=known.find(row=>row.id===change.id),old=prior?JSON.parse(prior.data.payload_json):null;
  try{validateDeliveryEvolution(old,next);}catch{conflict('Transição Delivery central inválida.');}
  const reference=(id,entity)=>{const row=records.get(id),payload=row?.entity===entity?JSON.parse(row.data.payload_json):null;if(!payload||payload.status!=='ativo')conflict('Referência Delivery central ausente/inativa.');return payload;};
  if(!old||old.status===next.status){
   reference(next.customerId,'DeliveryCustomer');if(next.driverId)reference(next.driverId,'DeliveryDriver');
   for(const item of next.items){const menu=reference(item.menuItemId,'DeliveryMenuItem');if(menu.name!==item.name||menu.unitCents!==item.unitCents)conflict('Preço/cardápio Delivery mudou; revisar proposta.');}
  }
  if(next.status==='dispatched')reference(next.driverId,'DeliveryDriver');
 }
}
