// Pure contract adapted from A1 money/UX and A2 canonical order states. No provider calls.
export const deliveryFields={
 DeliveryCustomer:['name','status'],DeliveryMenuItem:['name','status','unitCents'],DeliveryDriver:['name','status'],
 DeliveryOrder:['date','provider','fulfillment','customerId','driverId','items','discountCents','deliveryCents','platformCents','paymentFeeCents','grossCents','totalCents','netCents','status','financialStatus','cancelReason'],
};
export const isDelivery=entity=>Object.hasOwn(deliveryFields,entity);
export const deliveryStates=['placed','confirmed','preparing','ready','dispatched','concluded','cancelled'];
export const deliveryProviders=Object.freeze({own:'Canal próprio',ifood:'iFood','99food':'99Food',whatsapp:'WhatsApp'});
export const canonicalProvider=value=>value==='food99'?'99food':Object.hasOwn(deliveryProviders,value)?value:null;
const bad=message=>{throw Object.assign(Error(message),{status:400});};
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))bad('Campos Delivery fora do contrato.');};
export const deliveryUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const integer=(n,min=0,max=1e9)=>{if(!Number.isSafeInteger(n)||n<min||n>max)bad('Valor Delivery deve ser inteiro limitado.');return n;};
const safe=value=>{if(value<0n||value>1000000000000n)bad('Total Delivery fora do limite.');return Number(value);};
export function deliveryTotals(data){
 if(!Array.isArray(data.items)||!data.items.length||data.items.length>10)bad('Pedido exige entre 1 e 10 itens.');
 const grossCents=safe(data.items.reduce((sum,item)=>sum+(BigInt(integer(item.quantityMilli,1))*BigInt(integer(item.unitCents))+500n)/1000n,0n));
 const discountCents=integer(data.discountCents),deliveryCents=integer(data.deliveryCents),platformCents=integer(data.platformCents),paymentFeeCents=integer(data.paymentFeeCents);
 if(discountCents>grossCents)bad('Desconto excede bruto.');const totalCents=safe(BigInt(grossCents)-BigInt(discountCents)+BigInt(deliveryCents));
 const netCents=safe(BigInt(totalCents)-BigInt(platformCents)-BigInt(paymentFeeCents));return {grossCents,totalCents,netCents};
}
export function nextDeliveryStates(order){
 const flow={placed:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:[order.fulfillment==='delivery'?'dispatched':'concluded','cancelled'],dispatched:['concluded','cancelled'],concluded:[],cancelled:[]};return flow[order.status]||[];
}
export function validateDeliveryPayload(entity,payload){
 keys(payload,deliveryFields[entity]||[]);
 if(entity!=='DeliveryOrder'){
  if(!payload.name?.startsWith('FICTICIO ')||payload.name.length>80||!['ativo','inativo'].includes(payload.status))bad('Cadastro Delivery deve ser sintético e possuir status.');
  if(entity==='DeliveryMenuItem')integer(payload.unitCents);return;
 }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.date||'')||!Number.isFinite(Date.parse(payload.date+'T00:00:00Z'))||new Date(payload.date+'T00:00:00Z').toISOString().slice(0,10)!==payload.date||payload.provider!=='own'||!['delivery','pickup','local'].includes(payload.fulfillment)||!deliveryUUID(payload.customerId)||(payload.driverId!==''&&!deliveryUUID(payload.driverId))||!deliveryStates.includes(payload.status)||payload.financialStatus!=='unpaid'||typeof payload.cancelReason!=='string'||payload.cancelReason.length>200)bad('Pedido, canal ou financeiro Delivery inválido.');
 const totals=deliveryTotals(payload);for(const [key,value] of Object.entries(totals))if(payload[key]!==value)bad('Totais Delivery divergentes.');
 const ids=new Set();for(const item of payload.items){keys(item,['id','menuItemId','name','quantityMilli','unitCents','lineCents']);if(!deliveryUUID(item.id)||ids.has(item.id)||!deliveryUUID(item.menuItemId)||!item.name?.startsWith('FICTICIO ')||item.name.length>80||item.lineCents!==safe((BigInt(item.quantityMilli)*BigInt(item.unitCents)+500n)/1000n))bad('Item Delivery inválido.');ids.add(item.id);}
 if(payload.status==='cancelled'?!payload.cancelReason.trim():payload.cancelReason!=='')bad('Motivo de cancelamento divergente.');
 if(payload.fulfillment==='delivery'&&!payload.driverId)bad('Modalidade entrega exige entregador neste laboratório.');
}
export function validateDeliveryEvolution(old,next){
 if(!old){if(next.status!=='placed')bad('Pedido nasce em placed.');return;}
 if(old.status===next.status){if(old.status!=='placed')bad('Pedido avançado não permite regravação.');return;}
 if(!nextDeliveryStates(old).includes(next.status))bad('Transição Delivery inválida.');
 for(const key of deliveryFields.DeliveryOrder.filter(k=>!['status','cancelReason'].includes(k)))if(JSON.stringify(old[key])!==JSON.stringify(next[key]))bad('Transição não pode alterar itens ou valores.');
}
