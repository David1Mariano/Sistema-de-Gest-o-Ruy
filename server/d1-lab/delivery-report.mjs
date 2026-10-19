import {deliveryFields,deliveryUUID,validateDeliveryPayload} from './delivery-contract.mjs';
const error=()=>{throw Object.assign(Error('Relatório Delivery inválido ou excede limite.'),{status:400});};
function rows(records){
 if(!Array.isArray(records)||records.length>1000)error();const unique=new Map();
 for(const row of records){if(!deliveryUUID(row.id))error();const payload=Object.fromEntries(Object.entries(row).filter(([key])=>deliveryFields.DeliveryOrder.includes(key)));validateDeliveryPayload('DeliveryOrder',payload);if(unique.has(row.id)&&JSON.stringify(unique.get(row.id))!==JSON.stringify(payload))error();unique.set(row.id,payload);}
 return [...unique].map(([id,payload])=>({id,...payload})).sort((a,b)=>a.id.localeCompare(b.id));
}
export function deliveryReport(records){
 const unique=rows(records),done=unique.filter(r=>r.status==='concluded');
 const sum=key=>{const n=Number(done.reduce((total,row)=>total+BigInt(row[key]),0n));if(!Number.isSafeInteger(n))error();return n;};
 return {ordersCount:unique.length,concludedCount:done.length,cancelledCount:unique.filter(r=>r.status==='cancelled').length,estimatedGrossCents:sum('grossCents'),estimatedTotalCents:sum('totalCents'),estimatedNetCents:sum('netCents'),averageCents:done.length?Math.round(sum('totalCents')/done.length):null,receivedCents:null};
}
export function deliveryCSV(records){
 // Only typed fields: no customer/driver IDs, names, notes, contacts or provider bodies.
 const fields=['id','date','provider','status','grossCents','totalCents','netCents'];
 return fields.join(',')+'\r\n'+rows(records).map(row=>fields.map(key=>row[key]).join(',')).join('\r\n')+'\r\n';
}
