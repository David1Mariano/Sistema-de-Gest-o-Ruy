import {createHash} from 'node:crypto';
import {fail} from './core.mjs';
import {isLocalAdmin} from '../../src/lib/localPermissions.mjs';
import {guardFinanceWrite} from '../../scripts/local-finance/commands.mjs';

// Called only with the operations transaction's client and verified C1 actor.
// It deliberately opens no transaction and never commits independently.
export async function createPurchasePayable(client,actor,operationId,purchase,params) {
  if(!isLocalAdmin(actor.role))throw fail(403,'Permissão financeira necessária.');
  const recordId=`${operationId}_payable`;
  const data={description:`Compra - ${purchase.supplier_name}`,date:purchase.date,issue_date:purchase.date,due_date:params.dueDate,amount:purchase.total_amount,status:'pending',beneficiary_name:purchase.supplier_name,beneficiary_type:'fornecedor',supplier_id:purchase.supplier_id,purchase_id:purchase.id,payment_method_planned:String(params.paymentMethod||''),document_number:purchase.document_number,responsible_user:actor.id,observation:purchase.observation};
  const relations=[];
  for(const [field,entity] of [['category_id','ExpenseCategory'],['cost_center_id','CostCenter']]) {
    if(!params[field])continue;
    const row=(await client.query('SELECT * FROM ruy_finance.record WHERE entity=$1 AND id=$2 FOR SHARE',[entity,params[field]])).rows[0];
    if(!row)throw fail(422,'Categoria ou centro de custo inexistente.');
    data[field]=row.id;data[field.replace('_id','_name')]=row.data.name;relations.push({field,entity,id:row.id});
  }
  guardFinanceWrite({entity:'AccountsPayable',data},null,data);
  const row=(await client.query("INSERT INTO ruy_finance.record(entity,id,data) VALUES('AccountsPayable',$1,$2::jsonb) RETURNING *",[recordId,JSON.stringify(data)])).rows[0];
  const saved={...row.data,id:row.id,entity:'AccountsPayable',version:row.version,created_date:row.created_date,updated_date:row.updated_date};
  for(const rel of relations)await client.query("INSERT INTO ruy_finance.relationship VALUES('AccountsPayable',$1,$2,$3,$4)",[recordId,rel.field,rel.entity,rel.id]);
  const requestHash=createHash('sha256').update(JSON.stringify({purchaseId:purchase.id,data})).digest('hex');
  await client.query('INSERT INTO ruy_finance.operation(id,actor_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',[operationId,actor.id,requestHash,JSON.stringify([saved])]);
  await client.query("INSERT INTO ruy_finance.audit(operation_id,actor_id,entity,record_id,before_data,after_data) VALUES($1,$2,'AccountsPayable',$3,null,$4::jsonb)",[operationId,actor.id,recordId,JSON.stringify(saved)]);
  return saved;
}
