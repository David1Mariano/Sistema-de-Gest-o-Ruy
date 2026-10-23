import {historicalEntities} from './history-readonly.mjs';
import {domainFields} from './domain-contract.mjs';
import {catalogFields} from './catalog-contract.mjs';
export async function moduleStatus(pool,{historical=false}={}){
 const state=(await pool.query("SELECT to_regclass('public.d1_attendance_history') IS NOT NULL attendance,to_regclass('public.d1_payroll_history') IS NOT NULL payroll,to_regclass('public.d1_purchase_history') IS NOT NULL purchases")).rows[0];
 const entities=new Set(historical?historicalEntities:['Sector','JobRole',...Object.keys(domainFields),...Object.keys(catalogFields)]);
 return {historical,readOnly:historical,sources:Object.fromEntries([...entities].map(e=>[e,true])),attendance:!historical&&state.attendance,payrollCalculation:!historical&&state.payroll,payrollPayments:false,payrollReopen:false,purchaseReceipt:!historical&&state.purchases,socialConnected:false,socialSending:false};
}
