import {centralOperational} from '../central/context.mjs';
import {fail} from '../d1-lab/core.mjs';
export const sharedCapabilities=Object.freeze({protocol:'D1LAB/1',contract:'RUY-SHARED-LAB/1',mode:'synthetic-only',operationalEnabled:false,polling:true,events:false,individualCentralLogin:true,deviceAuthentication:'mTLS',criticalOffline:false,payrollPayments:true,stockConsumption:true,manualFinancialCommands:true,manualFinancialReversal:true,deliveryReceipts:true});
const catalogs=new Set(['Employee','Sector','JobRole','ExpenseCategory','Supplier','InventoryItem','CostCenter','DeliveryCustomer','DeliveryMenuItem']);
export function sharedCommandPolicy(command,{offline=false}={}){
 if(!Array.isArray(command?.changes)||!command.changes.length)throw fail(400,'Changes required.');
 for(const change of command.changes){
  if(catalogs.has(change.entity))continue;
  if(!offline&&change.entity==='FinancialExpense'){
   let payload;try{payload=JSON.parse(change.data?.payload_json);}catch{throw fail(400,'Invalid financial draft.');}
   const validDate=typeof payload.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(payload.date)&&Number.isFinite(Date.parse(payload.date+'T00:00:00Z'))&&new Date(payload.date+'T00:00:00Z').toISOString().slice(0,10)===payload.date;
   if(payload.status==='pendente'&&typeof payload.description==='string'&&(centralOperational()?!!payload.description.trim():payload.description.startsWith('FICTICIO '))&&validDate&&typeof payload.amount==='number'&&Number.isFinite(payload.amount)&&payload.amount>0&&payload.amount<=1e9&&Math.abs(payload.amount*100-Math.round(payload.amount*100))<1e-6&&(!payload.origin_type||payload.origin_type==='manual')&&!payload.linked_payment_id&&!payload.accounts_payable_id&&!payload.payroll_run_id&&!payload.settlement_id)continue;
  }
  throw fail(403,'This operation requires an authoritative central command contract; offline effects and snapshot replay refused.');
 }
 return true;
}
