// Versioned document snapshots. Monetary documents do not execute bank payments.
const fields = text => text.split(' ');
const common = 'date status observation responsible_user';
export const domainFields = {
 ProductionProduct: fields('name category yield_quantity yield_unit preparation_time_minutes instructions status total_cost unit_cost ingredients'),
 ProductionOrder: fields('date product_id product_name planned_quantity produced_quantity priority status responsible observation unit'),
 DailyProduction: fields('date product_id product_name production_order_id produced_quantity loss_quantity leftover_quantity responsible observation losses unit'),
 FinancialExpense: fields(common+' paid_date due_date description classification category_id category_name cost_center_id cost_center_name beneficiary_type beneficiary_id beneficiary_name employee_id amount payment_method account financial_account_id financial_account_name document_number proof_url invoice_url origin_type origin_id accounts_payable_id'),
  EmployeePayment: fields(common+' employee_id employee_name sector function payment_type reference_start reference_end work_date days_quantity daily_rate gross_amount discount_amount net_amount payment_date payment_method proof_url vale_id financial_expense_id payments'),
 Revenue: fields(common+' description gross_amount fee_amount net_amount financial_account_id financial_account_name payment_method origin_mode source source_type channel'),
 AccountsPayable: fields(common+' description issue_date due_date amount category_id category_name cost_center_id cost_center_name beneficiary_name beneficiary_type payment_method_planned document_number document_url priority paid_date financial_account_id financial_account_name proof_url financial_expense_id recurring_expense_id'),
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
export const readOnlyDomains = ['Vale','Consumption'];
export const isDomain = entity => Object.hasOwn(domainFields,entity) || readOnlyDomains.includes(entity);
export const domainSyncFields = Object.fromEntries(Object.keys(domainFields).map(entity=>[entity,['name','payload_json','status']]));
export function validateDomainSnapshot(entity,data){
 if(!domainSyncFields[entity])return;
 const payload=JSON.parse(data.payload_json);
 const derived=['recipe_snapshot','recipe_yield','local_status','source_device_id','consumption_effects','confirmation_id','cancellation_id','linked_payment_id'];
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!domainFields[entity].includes(k)&&!derived.includes(k)))throw Error('Invalid domain snapshot');
 if(entity==='ProductionProduct'&&(!payload.name?.startsWith('FICTICIO ')||!Array.isArray(payload.ingredients)))throw Error('Invalid recipe');
 if(entity==='DailyProduction'&&(!Array.isArray(payload.recipe_snapshot)||!['rascunho','confirmado','cancelado'].includes(payload.local_status)))throw Error('Invalid production');
}
export function unwrapDomain(row) {
 return {...JSON.parse(row.data.payload_json),id:row.id,_version:Number(row.version),created_date:new Date(row.created_at).toISOString(),updated_date:new Date(row.updated_at).toISOString()};
}
