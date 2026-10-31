import {fail,uuid} from '../d1-lab/core.mjs';
import {syncFields,syncHash} from '../d1-lab/sync-contract.mjs';
import {acceptD1} from './d1-central.mjs';
const catalogs=new Set(['Employee','Sector','JobRole','ExpenseCategory','Supplier','InventoryItem','DeliveryCustomer','DeliveryMenuItem']);
export async function sharedCatalogCommand(pool,deviceToken,sessionToken,auth,body){
 const p=await auth.authorize(deviceToken,sessionToken);
 if(p.role!=='admin')throw fail(403,'Administrador central obrigatório.');
 if(!body||!catalogs.has(body.entity)||!uuid(body.id)||!uuid(body.operationId)||!['create','update'].includes(body.operation)||Object.keys(body).some(k=>!['entity','id','operationId','operation','baseVersion','data'].includes(k)))throw fail(400,'Comando de cadastro inválido.');
 const current=(await pool.query('SELECT entity,data,version FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,body.id])).rows[0];
 const sourceRequestHash=syncHash(body),prior=(await pool.query('SELECT * FROM d1_central_receipts WHERE operation_id=$1',[body.operationId])).rows[0];
 if(prior){if(prior.device_id!==p.device_id||prior.actor_id!==p.actor_id||prior.workspace_id!==p.workspace_id||prior.result.sourceRequestHash!==sourceRequestHash)throw fail(409,'UUID reutilizado com outra intenção.');return {...prior.result,replay:true};}
 if(body.operation==='create'?body.baseVersion!==null:!Number.isSafeInteger(body.baseVersion)||body.baseVersion<1)throw fail(400,'Versão obrigatória.');
 if(current&&current.entity!==body.entity||body.operation==='update'&&!current||current?.data._deleted==='true')throw fail(409,'Identidade indisponível.');
 if(!body.data||Array.isArray(body.data)||typeof body.data!=='object'||Object.keys(body.data).some(k=>!syncFields[body.entity].includes(k)||k.startsWith('_')))throw fail(400,'Campos de cadastro inválidos.');
 const data={...(body.operation==='update'?current.data:{}),...body.data};
 // Cascading a legacy name-based relationship requires a separate reviewed
 // aggregate. Do not silently orphan employees through a catalog rename.
 if(current&&current.data.name!==data.name&&['Sector','JobRole'].includes(body.entity)){
  const field=body.entity==='Sector'?'sector':'function';
  if((await pool.query("SELECT 1 FROM d1_central_records WHERE workspace_id=$1 AND entity='Employee' AND data->>$2=$3 AND coalesce(data->>'_deleted','false')<>'true' LIMIT 1",[p.workspace_id,field,current.data.name])).rowCount)throw fail(409,'Renomeação vinculada requer conferência de todos os colaboradores.');
  if(body.entity==='Sector'&&(await pool.query("SELECT 1 FROM d1_central_records WHERE workspace_id=$1 AND entity='JobRole' AND (data->>'sector_id'=$2 OR data->>'sector_name'=$3) LIMIT 1",[p.workspace_id,body.id,current.data.name])).rowCount)throw fail(409,'Renomeação vinculada requer conferência das funções do setor.');
 }
 const command={protocol:'D1LAB/1',operationId:body.operationId,actorId:p.actor_id,deviceId:p.device_id,workspaceId:p.workspace_id,changes:[{entity:body.entity,id:body.id,baseVersion:body.baseVersion,data}]};
 return acceptD1(pool,sessionToken,command,{business:true,sourceRequestHash,authorizeSession:c=>auth.authorize(deviceToken,sessionToken,c,true)});
}
