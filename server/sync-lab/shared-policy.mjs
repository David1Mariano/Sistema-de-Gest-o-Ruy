import {fail} from '../d1-lab/core.mjs';
export const sharedCapabilities=Object.freeze({protocol:'D1LAB/1',contract:'RUY-SHARED-LAB/1',mode:'synthetic-only',operationalEnabled:false,polling:true,events:false,individualCentralLogin:true,deviceAuthentication:'mTLS',criticalOffline:false,payrollPayments:false,stockConsumption:false,deliveryReceipts:false});
const catalogs=new Set(['Employee','Sector','JobRole','ExpenseCategory','Supplier','CostCenter','DeliveryCustomer','DeliveryMenuItem']);
export function sharedCommandPolicy(command,{offline=false}={}){
 if(!Array.isArray(command?.changes)||!command.changes.length)throw fail(400,'Changes required.');
 for(const change of command.changes){
  if(catalogs.has(change.entity))continue;
  if(!offline&&change.entity==='FinancialExpense'){
   let payload;try{payload=JSON.parse(change.data?.payload_json);}catch{throw fail(400,'Invalid financial draft.');}
   if(payload.status==='pendente'&&(!payload.origin_type||payload.origin_type==='manual')&&!payload.linked_payment_id&&!payload.payroll_run_id&&!payload.settlement_id)continue;
  }
  throw fail(403,'This operation requires an authoritative central command contract; offline effects and snapshot replay refused.');
 }
 return true;
}
