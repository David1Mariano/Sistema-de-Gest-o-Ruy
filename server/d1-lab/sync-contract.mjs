import {catalogFields} from './catalog-contract.mjs';
import {digest,fail,uuid} from './core.mjs';
export const syncFields={Sector:['name','description','role_purpose','responsible_name','status'],JobRole:['name','sector_id','sector_name','status'],...catalogFields,OperationalEvent:['name','kind','command_json','result_json','status','source_device_id']};
export const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const syncHash=value=>digest(canonical(value));
export const syncTable=entity=>entity==='OperationalEvent'?'d1_operation_events':['Sector','JobRole','Employee'].includes(entity)?'d1_records':'d2_catalog';
export const dataOf=record=>Object.fromEntries(Object.entries(record).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k)));
export function validateEnvelope(command){
 if(command?.protocol!=='D1LAB/1'||![command.operationId,command.deviceId,command.actorId,command.workspaceId].every(uuid)||!Array.isArray(command.changes)||!command.changes.length||command.changes.length>1000)throw fail(400,'Envelope D1 inválido.');
 const seen=new Set();
 for(const change of command.changes){
  if(!syncFields[change.entity]||!uuid(change.id)||seen.has(change.id)||(change.baseVersion!==null&&(!Number.isSafeInteger(change.baseVersion)||change.baseVersion<1)))throw fail(400,'Identificador/versão D1 inválido.');
  seen.add(change.id);
  const d=change.data;
  if(!d||Array.isArray(d)||typeof d!=='object'||Object.keys(d).some(k=>!syncFields[change.entity].includes(k))||Object.values(d).some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number')||Object.values(d).some(v=>typeof v==='string'&&v.length>4000))throw fail(400,'Campos D1 inválidos.');
  if(change.entity!=='SystemSettings'&&(!d.name?.startsWith('FICTICIO ')||d.name.length>120))throw fail(400,'Somente dados sintéticos D1.');
  if(d.photo_url)throw fail(400,'Anexos exigem protocolo próprio.');
  if(change.entity==='OperationalEvent'){
   if(change.baseVersion!==null||change.id!==command.operationId||!['entry','exit','adjust','production','journal'].includes(d.kind)||d.status!=='pending-central'||d.source_device_id!==command.deviceId)throw fail(400,'Evento operacional deve ser imutável e sintético.');
   try{const input=JSON.parse(d.command_json),result=JSON.parse(d.result_json);if(input.operationId!==change.id||result.operationId!==change.id||result.businessConfirmed!==false||result.externalConfirmed!==false)throw Error();}catch{throw fail(400,'Recibo de negócio inválido.');}
  }
  if(change.entity==='Employee')for(const k of ['cpf','rg','pix_key','bank'])if(d[k]&&!String(d[k]).startsWith('FICTICIO'))throw fail(400,'Documento sintético obrigatório.');
 }
}
