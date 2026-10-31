import {fail,uuid} from '../d1-lab/core.mjs';
// Commands, never offline snapshots, enter the existing authoritative ledger.
// No modern payroll/Delivery settlement is accepted by this adapter.
export function onlineOperation(principal,body){
 if(body?.kind==='create-item'){
  if(!uuid(body.operationId)||!uuid(body.itemId)||!Number.isSafeInteger(body.initialMilli)||body.initialMilli<0||body.initialMilli>1e12||!Number.isSafeInteger(body.unitCents)||body.unitCents<0||body.unitCents>1e12||Object.keys(body).some(k=>!['kind','operationId','itemId','data','initialMilli','unitCents'].includes(k)))throw fail(400,'Cadastro inicial de estoque inválido.');
  const command=onlineOperation(principal,{operationId:body.operationId,kind:'entry',itemId:body.itemId,quantityMilli:body.initialMilli,baseVersion:0,unitCents:body.unitCents});
  command.changes.unshift({entity:'InventoryItem',id:body.itemId,baseVersion:null,data:body.data});if(!body.initialMilli)command.changes.pop();return command;
 }
 if(!uuid(body?.operationId)||!['entry','exit','adjust','consume','production','journal'].includes(body.kind))throw fail(400,'Comando central não autorizado.');
 const fields={entry:['itemId','quantityMilli','baseVersion','unitCents'],exit:['itemId','quantityMilli','baseVersion'],adjust:['itemId','targetMilli','baseVersion','unitCents'],consume:['inputs'],production:['inputs','output'],journal:['entries']};
 if(Object.keys(body).some(k=>!['operationId','kind',...fields[body.kind]].includes(k)))throw fail(400,'Campos fora do comando central.');
 const id=body.operationId;
 return {protocol:'D1LAB/1',operationId:id,deviceId:principal.device_id,actorId:principal.actor_id,workspaceId:principal.workspace_id,changes:[{entity:'OperationalEvent',id,baseVersion:null,data:{name:'FICTICIO Comando central '+id,kind:body.kind,status:'pending-central',source_device_id:principal.device_id,command_json:JSON.stringify(body),result_json:JSON.stringify({operationId:id,businessConfirmed:false,externalConfirmed:false})}}]};
}
