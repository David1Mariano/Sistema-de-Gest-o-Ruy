// One matrix shared by C1 authorization and the local UI. The API is authoritative.
export const LOCAL_ROLES=['admin','super_admin','gerente','producao','operator','viewer'];
export const isLocalAdmin=role=>['admin','super_admin'].includes(role);
export const OPERATION_ENTITIES=new Set(['InventoryItem','StockMovement','Supplier','Purchase','PurchaseItem','RecipeIngredient','ProductionProduct','ProductionOrder','DailyProduction','MachineRotation']);
const productionRead=new Set(['InventoryItem','StockMovement','RecipeIngredient','ProductionProduct','ProductionOrder','DailyProduction','MachineRotation']);
export function canLocalEntity(role,entity,write=false){
  if(isLocalAdmin(role))return true;
  if(role==='gerente'&&OPERATION_ENTITIES.has(entity))return true;
  if(role==='producao'&&productionRead.has(entity))return !write||['StockMovement','DailyProduction','ProductionOrder','MachineRotation'].includes(entity);
  return !write&&['operator','viewer'].includes(role)&&productionRead.has(entity)&&entity!=='MachineRotation';
}
export const canOpenOperations=role=>['admin','super_admin','gerente','producao'].includes(role);
