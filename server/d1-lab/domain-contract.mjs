import {deliveryFields,isDelivery,validateDeliveryPayload} from './delivery-contract.mjs';
import {attendanceFields} from './attendance-contract.mjs';
import {payrollFields} from './payroll-contract.mjs';
import {purchaseFields,validatePurchaseSnapshot} from './purchase-contract.mjs';
// Versioned document snapshots. Monetary documents do not execute bank payments.
const fields = text => text.split(' ');
const common = 'date status observation responsible_user';
export const domainFields = {
 ...attendanceFields,
 ...payrollFields,
 ...purchaseFields,
 ...deliveryFields,
 Vale: fields('employee_id employee_name sector date amount type motive payment_method authorized_by status observation proof_url deduction_payment_id deduction_payment_version'),
 Consumption: fields('employee_id employee_name sector date time product quantity amount registered_by status deduction_payment_id deduction_payment_version'),
 ProductionProduct: fields('name category yield_quantity yield_unit preparation_time_minutes instructions status total_cost unit_cost ingredients'),
 ProductionOrder: fields('date product_id product_name planned_quantity produced_quantity priority status responsible observation unit'),
 DailyProduction: fields('date product_id product_name production_order_id produced_quantity loss_quantity leftover_quantity responsible observation losses unit'),
 FinancialExpense: fields(common+' paid_date due_date description classification category_id category_name cost_center_id cost_center_name beneficiary_type beneficiary_id beneficiary_name employee_id amount payment_method account financial_account_id financial_account_name document_number proof_url invoice_url origin_type origin_id accounts_payable_id'),
  EmployeePayment: fields(common+' employee_id employee_name sector function payment_type reference_start reference_end work_date days_quantity daily_rate gross_amount discount_amount net_amount payment_date payment_method proof_url vale_id financial_expense_id payments'),
 Revenue: fields(common+' description gross_amount fee_amount net_amount financial_account_id financial_account_name payment_method origin_mode source source_type channel'),
 AccountsPayable: fields(common+' description issue_date due_date amount category_id category_name cost_center_id cost_center_name beneficiary_name beneficiary_type purchase_id supplier_id payment_method_planned document_number document_url priority paid_date financial_account_id financial_account_name proof_url financial_expense_id recurring_expense_id'),
 FinancialAccount: fields('name type institution status initial_balance current_balance'),
 CostCenter: fields('name status'),
 Sangria: fields(common+' time cashier amount operator_name responsible purpose destination registered_by'),
 CashMovement: fields(common+' source channel operator_name machine_accounts account_allocations cash pix debit credit voucher withdrawals expenses opening_fund counted_balance expected_balance difference'),
 FechamentoCaixa: fields(common+' cashier shift operator_name reviewer_name opening_time closing_time opening_fund cash_sales pix_total debit_total credit_total ifood_total food99_total brendi_total other_payments pix_machine debit_machine credit_machine machine_system_difference withdrawals_total counted_cash expected_cash difference attachment_url finalized_by finalized_at created_by_name'),
 AccountsReceivable: fields(common+' description source_type source_id reference_date expected_date received_date gross_amount fee_amount net_amount financial_account_id financial_account_name reconciled'),
 CardReceivable: fields(common+' sale_date expected_date received_date gross_amount fee_amount net_amount financial_account_id financial_account_name acquirer terminal payment_type origin_mode accounts_receivable_id'),
 DeliverySettlement: fields(common+' channel reference_start reference_end expected_date received_date orders_count gross_amount discount_amount commission_amount delivery_fee_amount other_fee_amount net_amount financial_account_id financial_account_name origin_mode accounts_receivable_id'),
 ManualReconciliation: fields(common+' reference_type reference_description expected_amount actual_amount difference financial_account_id financial_account_name'),
 MachineRotation: fields('weekday operator terminal sales_goal transaction_goal manager_name manager_phone start_time end_time status observation'),
 RecurringExpense: fields(common+' name amount frequency start_date automatic_generation next_due_date day_of_month category_id category_name cost_center_id cost_center_name financial_account_id financial_account_name beneficiary_name payment_method_planned'),
 DailyFinancialClose: fields(common+' expenses_total employee_payments_total vales_total pending_payables_total pending_items closed_by closed_at'),
};
export const readOnlyDomains = [];
export const isDomain = entity => Object.hasOwn(domainFields,entity) || readOnlyDomains.includes(entity);
export const domainSyncFields = Object.fromEntries(Object.keys(domainFields).map(entity=>[entity,['name','payload_json','status']]));
export function validateDomainSnapshot(entity,data){
 if(!domainSyncFields[entity])return;
 const payload=JSON.parse(data.payload_json);
 if(entity==='Purchase')validatePurchaseSnapshot(payload);
 if(isDelivery(entity))validateDeliveryPayload(entity,payload);
 const derived=['recipe_snapshot','recipe_yield','local_status','source_device_id','consumption_effects','confirmation_id','cancellation_id','linked_payment_id','rh_deductions','payroll_run_id','delivery_order_id','settlement_id'];
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!domainFields[entity].includes(k)&&!derived.includes(k)))throw Error('Invalid domain snapshot');
 if(entity==='ProductionProduct'&&(!payload.name?.startsWith('FICTICIO ')||!Array.isArray(payload.ingredients)))throw Error('Invalid recipe');
 if(entity==='DailyProduction'&&(!Array.isArray(payload.recipe_snapshot)||!['rascunho','confirmado','cancelado'].includes(payload.local_status)))throw Error('Invalid production');
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
 if(['Vale','Consumption'].includes(entity)){
  const states=entity==='Vale'?['pendente','descontado','cancelado']:['registrado','cobrado','liberado','cancelado'];
  if(!uuid(payload.employee_id)||!uuid(payload.source_device_id)||typeof payload.amount!=='number'||!Number.isFinite(payload.amount)||payload.amount<=0||payload.amount>1e9||Math.abs(payload.amount*100-Math.round(payload.amount*100))>1e-6||!states.includes(payload.status)||!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)||!Number.isFinite(Date.parse(payload.date+'T00:00:00Z'))||new Date(payload.date+'T00:00:00Z').toISOString().slice(0,10)!==payload.date||payload.proof_url)throw Error('Invalid RH snapshot');
  if(entity==='Vale'&&!['dinheiro','pix','produto','outros'].includes(payload.type))throw Error('Invalid advance');
  if(entity==='Consumption'&&(!payload.product?.trim()||!Number.isFinite(payload.quantity)||payload.quantity<=0||!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.time||'')))throw Error('Invalid consumption');
  if(['descontado','cobrado'].includes(payload.status)?!uuid(payload.deduction_payment_id):!!payload.deduction_payment_id)throw Error('Invalid payroll link');
 }
 if(payload.rh_deductions!==undefined){
  if(entity!=='EmployeePayment'||!Array.isArray(payload.rh_deductions)||payload.rh_deductions.length>20||new Set(payload.rh_deductions.map(item=>item.id)).size!==payload.rh_deductions.length||payload.rh_deductions.some(item=>!['Vale','Consumption'].includes(item.entity)||!uuid(item.id)||!Number.isSafeInteger(item.amountCents)||item.amountCents<=0)||payload.rh_deductions.reduce((s,item)=>s+item.amountCents,0)>Math.round(payload.discount_amount*100))throw Error('Invalid payroll deductions');
 }
}
export function unwrapDomain(row) {
 return {...JSON.parse(row.data.payload_json),id:row.id,_version:Number(row.version),created_date:new Date(row.created_at).toISOString(),updated_date:new Date(row.updated_at).toISOString()};
}
