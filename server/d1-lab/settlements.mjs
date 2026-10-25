import {randomUUID} from 'node:crypto';
import {fail,uuid,transaction} from './core.mjs';
import {syncHash} from './sync-contract.mjs';
import {unwrapDomain} from './domain-contract.mjs';
import {applyOperational} from './operations.mjs';
import {preparePayroll} from './payroll.mjs';
import {rhHistoryInsert} from './rh-domain.mjs';
import {assertDeliveryDatabase} from './delivery.mjs';
const fields=p=>Object.fromEntries(Object.entries(p).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k)));
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const accounts=['cash','bank'];
async function ledger(c,actor){return (await c.query('SELECT account,balance_cents::text,version::int FROM d1_financial_accounts WHERE owner_id=$1 ORDER BY account FOR UPDATE',[actor])).rows;}
export async function settlementPreview(c,actor,entity,id){
 if(!['PayrollRun','DeliveryOrder'].includes(entity)||!uuid(id))throw fail(400,'Origem de liquidacao invalida.');
 const row=(await c.query('SELECT * FROM d2_catalog WHERE owner_id=$1 AND entity=$2 AND id=$3 FOR UPDATE',[actor,entity,id])).rows[0];if(!row)throw fail(404,'Origem nao encontrada.');
 const source=unwrapDomain(row),balances=await ledger(c,actor),receipt=(await c.query('SELECT * FROM d1_local_settlements WHERE owner_id=$1 AND entity=$2 AND record_id=$3',[actor,entity,id])).rows[0];
 const reversed=!!(await c.query('SELECT 1 FROM d1_local_settlement_reversals WHERE owner_id=$1 AND entity=$2 AND record_id=$3',[actor,entity,id])).rowCount;
 const amountCents=entity==='PayrollRun'?source.calculation?.netCents:source.netCents;
 return {token:syncHash({entity,id,version:Number(row.version),source,balances,receipt:receipt?.operation_id||null,reversed}),source,balances,amountCents,canPay:!receipt&&(entity==='PayrollRun'?source.status==='fechado':source.status==='concluded'&&source.financialStatus==='unpaid'),canReverse:!!receipt&&!reversed,receipt};
}
export async function previewSettlement(pool,user,entity,id){if(user.role!=='admin')throw fail(403,'Administrador obrigatorio.');return transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);const p=await settlementPreview(c,user.id,entity,id);return {token:p.token,balances:p.balances,amountCents:p.amountCents,canPay:p.canPay,canReverse:p.canReverse};});}
export async function prepareSettlement({c,actor,deviceId,body,old,save,changes,get}){
 if(body.entity==='DeliveryOrder')await assertDeliveryDatabase(c);
 if(!old)throw fail(409,'Documento inexistente.');
 const plan=await settlementPreview(c,actor.id,body.entity,body.id);if(plan.token!==body.token)throw fail(409,'Conferencia financeira mudou; recarregue.');
 const current=account=>plan.balances.find(b=>b.account===account)||{version:0,balance_cents:'0'};
 const data=fields(old),push=result=>changes.push({entity:'OperationalEvent',record:result.record});
 if(body.action==='pay'){
  if(!plan.canPay||!Number.isSafeInteger(plan.amountCents)||plan.amountCents<=0)throw fail(409,'Documento ja liquidado ou nao elegivel.');
  const input=body.data;if(!input||Object.keys(input).some(k=>!['account','payment_date','payment_method'].includes(k))||!accounts.includes(input.account)||!date(input.payment_date)||!['dinheiro','pix','transferencia','debito','credito'].includes(input.payment_method))throw fail(400,'Conta, data e meio de liquidacao obrigatorios.');
  let deductions=[];
  if(body.entity==='PayrollRun'){
   await preparePayroll({c,actor,body:{...body,action:'confirm',token:old.calculation.fingerprint},old:{...old,status:'rascunho'},data:{...data,status:'rascunho'}});
   const equivalent=(await c.query("SELECT data FROM d2_catalog WHERE owner_id=$1 AND entity='EmployeePayment'",[actor.id])).rows.map(r=>JSON.parse(r.data.payload_json)).some(p=>p.status!=='cancelado'&&p.employee_id===old.employee_id&&p.reference_start<=old.reference_end&&old.reference_start<=p.reference_end);
   if(equivalent)throw fail(409,'Pagamento ja existente no periodo.');
   deductions=old.calculation.sources||[];
  }
  const ledgerId=randomUUID(),documentId=randomUUID(),expenseId=body.entity==='PayrollRun'?randomUUID():null,contra=body.entity==='PayrollRun'?'expense':'revenue',sign=body.entity==='PayrollRun'?-1:1;
  push(await applyOperational(c,actor,deviceId,{operationId:ledgerId,kind:'journal',entries:[{account:input.account,baseVersion:current(input.account).version,cents:sign*plan.amountCents},{account:contra,baseVersion:current(contra).version,cents:-sign*plan.amountCents}]},async()=>{},{enqueue:false}));
  if(body.entity==='PayrollRun'){
   const employee=(await c.query("SELECT data FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' AND coalesce(data->>'_deleted','false')<>'true'",[old.employee_id,actor.id])).rows[0];if(!employee)throw fail(409,'Colaborador indisponivel.');
   const rh=[];for(const s of deductions){const row=await get(c,actor.id,s.entity,s.id),p=unwrapDomain(row);if(p._version!==s.version||p.employee_id!==old.employee_id||p.source_device_id!==deviceId||p.status!==(s.entity==='Vale'?'pendente':'registrado'))throw fail(409,'Desconto mudou; recalcule a folha.');const next={...fields(p),status:s.entity==='Vale'?'descontado':'cobrado',deduction_payment_id:documentId};const saved=await save(s.entity,s.id,next,row);rh.push({entity:s.entity,id:s.id,amountCents:Math.round(p.amount*100)});await rhHistoryInsert(c,{owner:actor.id,id:s.id,entity:s.entity,operation:body.operationId,actor:actor.id,device:deviceId,version:saved._version,action:'payroll-pay',snapshot:saved});}
   await save('EmployeePayment',documentId,{employee_id:old.employee_id,employee_name:employee.data.name,payment_type:'salario',reference_start:old.reference_start,reference_end:old.reference_end,gross_amount:old.calculation.grossCents/100,discount_amount:old.calculation.discountCents/100,net_amount:plan.amountCents/100,payment_date:input.payment_date,payment_method:input.payment_method,status:'pago',financial_expense_id:expenseId,source_device_id:deviceId,payroll_run_id:body.id,settlement_id:ledgerId,rh_deductions:rh},null);
   await save('FinancialExpense',expenseId,{description:'Folha - '+employee.data.name,date:input.payment_date,paid_date:input.payment_date,amount:plan.amountCents/100,status:'pago',beneficiary_type:'colaborador',beneficiary_id:old.employee_id,linked_payment_id:documentId,payroll_run_id:body.id,settlement_id:ledgerId,payment_method:input.payment_method,origin_type:'folha',origin_id:body.id},null);data.status='pago';data.payment_id=documentId;
  }else{
   await save('Revenue',documentId,{date:input.payment_date,description:'Pedido Delivery',gross_amount:old.totalCents/100,fee_amount:(old.totalCents-old.netCents)/100,net_amount:old.netCents/100,status:'recebido',payment_method:input.payment_method,delivery_order_id:body.id,settlement_id:ledgerId},null);data.financialStatus='paid';data.revenue_id=documentId;
  }
  data.settlement_id=ledgerId;await c.query('INSERT INTO d1_local_settlements(owner_id,entity,record_id,operation_id,ledger_id,document_id,amount_cents,account,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor.id,body.entity,body.id,body.operationId,ledgerId,documentId,plan.amountCents,input.account,{sourceVersion:old._version,expenseId,date:input.payment_date,amountCents:plan.amountCents}]);return data;
 }
 if(body.action!=='reverse'||!plan.canReverse||typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>300)throw fail(409,'Estorno exige liquidacao ativa e motivo.');
 const receipt=plan.receipt,contra=body.entity==='PayrollRun'?'expense':'revenue',ledgerId=randomUUID();
 push(await applyOperational(c,actor,deviceId,{operationId:ledgerId,kind:'reversal',referenceId:receipt.ledger_id,reason:body.reason,entries:[{account:receipt.account,baseVersion:current(receipt.account).version},{account:contra,baseVersion:current(contra).version}]},async()=>{},{enqueue:false}));
 if(body.entity==='PayrollRun'){
  const row=await get(c,actor.id,'EmployeePayment',receipt.document_id),p=unwrapDomain(row);if(p.payroll_run_id!==body.id||p.status!=='pago'||Math.round(p.net_amount*100)!==Number(receipt.amount_cents))throw fail(409,'Pagamento divergente.');
  for(const s of p.rh_deductions||[]){const row=await get(c,actor.id,s.entity,s.id),d=unwrapDomain(row);if(d.deduction_payment_id!==p.id)throw fail(409,'Vinculo RH divergente.');const next={...fields(d),status:s.entity==='Vale'?'pendente':'registrado'};delete next.deduction_payment_id;const saved=await save(s.entity,s.id,next,row);await rhHistoryInsert(c,{owner:actor.id,id:s.id,entity:s.entity,operation:body.operationId,actor:actor.id,device:deviceId,version:saved._version,action:'payroll-reverse',snapshot:saved});}
  await save('EmployeePayment',p.id,{...fields(p),status:'cancelado'},row);const expense=await get(c,actor.id,'FinancialExpense',p.financial_expense_id);await save('FinancialExpense',expense.id,{...fields(unwrapDomain(expense)),status:'cancelado'},expense);data.status='estornado';
 }else{const row=await get(c,actor.id,'Revenue',receipt.document_id),r=unwrapDomain(row);if(r.delivery_order_id!==body.id||r.status!=='recebido')throw fail(409,'Receita divergente.');await save('Revenue',row.id,{...fields(r),status:'cancelado'},row);data.financialStatus='refunded';}
 await c.query('INSERT INTO d1_local_settlement_reversals(owner_id,entity,record_id,operation_id,ledger_id,reason) VALUES($1,$2,$3,$4,$5,$6)',[actor.id,body.entity,body.id,body.operationId,ledgerId,body.reason.trim()]);return data;
}
export async function settlementReconciliation(pool,user){
 if(user.role!=='admin')throw fail(403,'Administrador obrigatorio.');
 const rows=(await pool.query('SELECT s.*,r.operation_id reversed FROM d1_local_settlements s LEFT JOIN d1_local_settlement_reversals r USING(owner_id,entity,record_id) WHERE s.owner_id=$1 ORDER BY s.created_at',[user.id])).rows,result=[];
 for(const s of rows){
  const document=(await pool.query('SELECT entity,data FROM d2_catalog WHERE id=$1 AND owner_id=$2',[s.document_id,user.id])).rows[0],d=document&&JSON.parse(document.data.payload_json),source=(await pool.query('SELECT data FROM d2_catalog WHERE id=$1 AND entity=$2 AND owner_id=$3',[s.record_id,s.entity,user.id])).rows[0],p=source&&JSON.parse(source.data.payload_json);
  const entries=(await pool.query('SELECT account,cents::text FROM d1_financial_entries WHERE owner_id=$1 AND operation_id=$2',[user.id,s.ledger_id])).rows,amount=Number(s.amount_cents),sign=s.entity==='PayrollRun'?-1:1,contra=s.entity==='PayrollRun'?'expense':'revenue';
  let consistent=!!d&&!!p&&document.entity===(s.entity==='PayrollRun'?'EmployeePayment':'Revenue')&&Math.round(d.net_amount*100)===amount&&d.settlement_id===s.ledger_id&&p.settlement_id===s.ledger_id&&entries.length===2&&entries.some(e=>e.account===s.account&&Number(e.cents)===sign*amount)&&entries.some(e=>e.account===contra&&Number(e.cents)===-sign*amount)&&d.status===(s.reversed?'cancelado':s.entity==='PayrollRun'?'pago':'recebido');
  if(s.entity==='PayrollRun'){const e=(await pool.query("SELECT data FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity='FinancialExpense'",[d?.financial_expense_id||s.document_id,user.id])).rows[0],expense=e&&JSON.parse(e.data.payload_json);consistent=consistent&&p.payment_id===s.document_id&&d.payroll_run_id===s.record_id&&expense?.linked_payment_id===s.document_id&&expense?.settlement_id===s.ledger_id&&Math.round(expense?.amount*100)===amount&&expense?.status===(s.reversed?'cancelado':'pago')&&p.status===(s.reversed?'estornado':'pago');}
  else consistent=consistent&&p.revenue_id===s.document_id&&d.delivery_order_id===s.record_id&&p.financialStatus===(s.reversed?'refunded':'paid');
  if(s.reversed){const r=(await pool.query('SELECT ledger_id FROM d1_local_settlement_reversals WHERE owner_id=$1 AND entity=$2 AND record_id=$3',[user.id,s.entity,s.record_id])).rows[0],reversed=r?(await pool.query('SELECT account,cents::text FROM d1_financial_entries WHERE owner_id=$1 AND operation_id=$2',[user.id,r.ledger_id])).rows:[];consistent=consistent&&reversed.length===2&&entries.every(e=>reversed.some(r=>r.account===e.account&&Number(r.cents)===-Number(e.cents)));}
  result.push({entity:s.entity,recordId:s.record_id,documentId:s.document_id,amountCents:amount,reversed:!!s.reversed,consistent:Boolean(consistent)});
 }
 return {records:result,consistent:result.every(r=>r.consistent)};
}
