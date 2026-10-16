import {fail,uuid} from './core.mjs';
import {unwrapDomain} from './domain-contract.mjs';
export const isRh = entity => ['Vale','Consumption'].includes(entity);
const cents = value => Math.round(value*100);
const fields = value => Object.fromEntries(Object.entries(value).filter(([key])=>!['id','_version','created_date','updated_date'].includes(key)));
export const discounted = (entity,data) => data?.status===(entity==='Vale'?'descontado':'cobrado');

export async function rhHistoryInsert(c,{owner,id,entity,operation,actor,device,version,action,snapshot}){
 if(!isRh(entity))return;
 await c.query(`INSERT INTO d1_rh_history(owner_id,record_id,entity,operation_id,actor_id,device_id,record_version,action,snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[owner,id,entity,operation,actor,device,version,action,snapshot]);
}

export async function prepareRh({c,actor,deviceId,body,old,data,get,save}){
 if(!['save','cancel'].includes(body.action))throw fail(400,'Ação RH inválida.');
 if(old?.source_device_id&&old.source_device_id!==deviceId)throw fail(409,'Documento RH remoto exige reconciliação no dispositivo de origem.');
 if(old?.status==='cancelado'||discounted(body.entity,old))throw fail(409,'Documento cancelado/descontado é imutável; desconto exige estorno de folha homologado.');
 if(!uuid(data.employee_id))throw fail(400,'Colaborador obrigatório.');
 const employee=(await c.query("SELECT * FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' FOR SHARE",[data.employee_id,actor.id])).rows[0];
 if(!employee||!['ativo','em_experiencia','folga','ferias','afastado'].includes(employee.data.status))throw fail(409,'Colaborador elegível do mesmo usuário obrigatório.');
 if(old&&old.employee_id!==data.employee_id)throw fail(409,'Colaborador do lançamento é imutável; cancele e cadastre outro.');
 data.employee_name=employee.data.name;data.sector=employee.data.sector||'';data.source_device_id=deviceId;
 if(body.entity==='Vale'){
  if(data.authorized_by!==undefined&&typeof data.authorized_by!=='string')throw fail(400,'Responsável pela autorização deve ser texto.');
  if(!['pendente','descontado','cancelado'].includes(data.status)||!['dinheiro','pix','produto','outros'].includes(data.type))throw fail(400,'Tipo/status do vale inválido.');
  data.authorized_by=data.authorized_by?.trim()||actor.id;
 }else{
  if(!['registrado','cobrado','liberado','cancelado'].includes(data.status)||typeof data.product!=='string'||!data.product.trim()||typeof data.quantity!=='number'||!Number.isFinite(data.quantity)||data.quantity<=0||data.quantity>1e6||Math.abs(data.quantity*1000-Math.round(data.quantity*1000))>1e-6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time||''))throw fail(400,'Produto, quantidade, horário ou status de consumo inválido.');
  data.registered_by=actor.id;
 }
 if(!old&&!['pendente','registrado'].includes(data.status))throw fail(409,'Cadastre primeiro o lançamento pendente/registrado antes de alterar seu status.');
 const duplicateKeys=body.entity==='Vale'?['employee_id','date','amount','type','motive']:['employee_id','date','time','product','quantity','amount'];
 const comparable=value=>typeof value==='string'?value.trim().toLocaleLowerCase('pt-BR'):value??'';
 if(data.status!=='cancelado'){
  const candidates=(await c.query('SELECT * FROM d2_catalog WHERE owner_id=$1 AND entity=$2 AND id<>$3',[actor.id,body.entity,body.id])).rows.map(unwrapDomain);
  if(candidates.some(row=>row.status!=='cancelado'&&duplicateKeys.every(key=>comparable(row[key])===comparable(data[key]))))throw fail(409,'Lançamento equivalente já existe; confira o histórico antes de repetir.');
 }
 if(discounted(body.entity,data)){
  if(!uuid(data.deduction_payment_id)||!Number.isSafeInteger(data.deduction_payment_version))throw fail(409,'Selecione o pagamento e sua versão para vincular o desconto de folha.');
  const paymentRow=await get(c,actor.id,'EmployeePayment',data.deduction_payment_id),payment=unwrapDomain(paymentRow);
  if(payment._version!==data.deduction_payment_version||payment.employee_id!==data.employee_id||payment.status!=='pago'||payment.source_device_id!==deviceId)throw fail(409,'Pagamento mudou, não está pago ou pertence a outro colaborador/dispositivo.');
  if(['vale','adiantamento'].includes(payment.payment_type))throw fail(409,'O desconto deve ser vinculado à folha, não a outro vale/adiantamento.');
  const deductions=payment.rh_deductions||[];
  if(deductions.length>=20||deductions.some(item=>item.id===body.id))throw fail(409,'Desconto já vinculado ou limite de vínculos atingido.');
  const used=deductions.reduce((sum,item)=>sum+item.amountCents,0);
  if(!Number.isSafeInteger(cents(payment.discount_amount))||used+cents(data.amount)>cents(payment.discount_amount))throw fail(409,'Desconto de folha insuficiente; nenhum valor será contado duas vezes.');
  if(!payment.financial_expense_id)throw fail(409,'Pagamento sem despesa agregada.');
  const expense=unwrapDomain(await get(c,actor.id,'FinancialExpense',payment.financial_expense_id));
  if(expense.linked_payment_id!==payment.id||expense.status!=='pago'||cents(expense.amount)!==cents(payment.net_amount))throw fail(409,'Pagamento e despesa divergentes; reconciliação necessária.');
  await save('EmployeePayment',payment.id,{...fields(payment),rh_deductions:[...deductions,{entity:body.entity,id:body.id,amountCents:cents(data.amount)}]},paymentRow);
 }else if(data.deduction_payment_id||data.deduction_payment_version)throw fail(400,'Vínculo de folha permitido somente no status descontado/cobrado.');
 delete data.deduction_payment_version;
 return data;
}

export function protectRhPayment(old,data){
 if(!old?.rh_deductions?.length)return;
 for(const key of ['employee_id','gross_amount','discount_amount','net_amount','payment_date','status','payment_type','financial_expense_id']){
  if(data[key]!==old[key])throw fail(409,'Pagamento com descontos RH vinculados exige reconciliação; composição protegida.');
 }
}
