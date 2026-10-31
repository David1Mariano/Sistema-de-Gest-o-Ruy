import {centralOperational} from '../central/context.mjs';
import {fail,uuid} from '../d1-lab/core.mjs';
import {domainFields,validateDomainSnapshot} from '../d1-lab/domain-contract.mjs';
import {syncHash} from '../d1-lab/sync-contract.mjs';
import {acceptD1} from './d1-central.mjs';

// Adapt the existing forms to the existing central ledger. No client-supplied
// snapshots or local payroll/Delivery effects can enter this route.
export async function sharedDomainCommand(pool,deviceToken,sessionToken,auth,body){
 const p=await auth.authorize(deviceToken,sessionToken);
 if(p.role!=='admin')throw fail(403,'Administrador central obrigatório.');
 if(!body||!uuid(body.operationId)||!uuid(body.id)||!['FinancialExpense','Revenue','AccountsPayable','FinancialAccount','CostCenter'].includes(body.entity)||!['save','cancel','reverse'].includes(body.action)||Object.keys(body).some(k=>!['operationId','id','entity','action','baseVersion','data','reason'].includes(k)))throw fail(403,'Agregado ainda não integrado ao servidor compartilhado.');
 const current=(await pool.query('SELECT entity,data,version FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,body.id])).rows[0];
 const sourceRequestHash=syncHash(body);
 const prior=(await pool.query('SELECT * FROM d1_central_receipts WHERE operation_id=$1',[body.operationId])).rows[0];
 if(prior){
  if(prior.device_id!==p.device_id||prior.actor_id!==p.actor_id||prior.workspace_id!==p.workspace_id||prior.result.sourceRequestHash!==sourceRequestHash)throw fail(409,'Identificador já utilizado por outra intenção.');
  return {...prior.result,replay:true};
 }
 if(current&&current.entity!==body.entity)throw fail(409,'Identidade pertence a outro agregado.');
 const old=current?JSON.parse(current.data.payload_json):null;
 const supplied=body.data||{};
 if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!domainFields[body.entity].includes(k))||Object.values(supplied).some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='string'&&v.length>1000||typeof v==='number'&&!Number.isFinite(v)))throw fail(400,'Campos inválidos.');
 let data={...old,...supplied};const changes=[];
 const paid=d=>d&&(d.status==='pago'||d.status==='recebido');
 if(old?.status==='cancelado')throw fail(409,'Documento cancelado permanece imutável.');
 if(body.action==='reverse'){
  if(!paid(old)||!['FinancialExpense','Revenue'].includes(body.entity)||typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>300)throw fail(409,'Estorno exige documento liquidado e motivo conferido.');
  const entries=(await pool.query('SELECT e.account,a.version FROM d1_business_entries e JOIN d1_business_accounts a USING(workspace,account) WHERE e.workspace=$1 AND e.operation=$2 ORDER BY e.account',[p.workspace_id,body.id])).rows;
  if(entries.length<2)throw fail(409,'Partidas originais não encontradas.');
  const input={operationId:body.operationId,kind:'reversal',referenceId:body.id,reason:body.reason,entries:entries.map(e=>({account:e.account,baseVersion:Number(e.version)}))};
  changes.push({id:body.operationId,entity:'OperationalEvent',baseVersion:null,data:{name:'FICTICIO Estorno '+body.operationId,kind:'reversal',status:'pending-central',source_device_id:p.device_id,command_json:JSON.stringify(input),result_json:JSON.stringify({operationId:body.operationId,businessConfirmed:false,externalConfirmed:false})}});
  data={...old,status:'cancelado'};
 }else if(body.action==='cancel'){
  if(!old||paid(old))throw fail(409,'Documento liquidado exige estorno transacional.');data={...old,status:'cancelado'};
 }else{
  const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const money=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9&&Math.abs(v*100-Math.round(v*100))<1e-6;
  if(['FinancialExpense','Revenue','AccountsPayable'].includes(body.entity)){
   if(!(centralOperational()?typeof data.description==='string'&&data.description.trim():data.description?.startsWith('FICTICIO '))||!date(body.entity==='AccountsPayable'?data.due_date:data.date))throw fail(400,'Descrição e data válida obrigatórias.');
   if(Object.entries(data).some(([k,v])=>(k.endsWith('_url')&&v)||(['accounts_payable_id','linked_payment_id','origin_id','purchase_id','recurring_expense_id','payroll_run_id','delivery_order_id','settlement_id'].includes(k)&&v))||data.origin_type&&!['manual','avulso'].includes(data.origin_type))throw fail(403,'Este vínculo exige o fluxo específico de pagamento, compra ou folha. Nenhuma movimentação foi executada.');
   if(data.employee_id){
    if(body.entity!=='FinancialExpense'||data.status!=='pendente'||!uuid(data.employee_id)||data.beneficiary_id!==data.employee_id||data.beneficiary_type!=='colaborador')throw fail(422,'O vínculo ao colaborador permite registrar uma obrigação pendente. Para pagar, utilize o fluxo de RH.');
    const employee=(await pool.query("SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2 AND entity='Employee'",[p.workspace_id,data.employee_id])).rows[0];
    if(!employee||employee.data._deleted==='true')throw fail(409,'Colaborador não encontrado nesta central. Recarregue a lista antes de salvar.');
    data.beneficiary_name=employee.data.name;
   }
  }
  if(body.entity==='FinancialExpense'&&(!money(data.amount)||data.amount<=0||!['pendente','pago'].includes(data.status)||data.status==='pago'&&(!data.document_number?.trim()||!(centralOperational()?typeof data.beneficiary_name==='string'&&data.beneficiary_name.trim():data.beneficiary_name?.startsWith('FICTICIO ')))))throw fail(400,'Despesa exige valor válido e obrigação identificada antes do pagamento.');
  if(body.entity==='FinancialExpense'&&data.status==='pago'&&!data.financial_account_id&&data.payment_method!=='dinheiro')throw fail(422,'Selecione a conta de origem para confirmar o pagamento. O cadastro pendente não movimenta saldo.');
  if(body.entity==='Revenue'&&(!money(data.gross_amount)||data.gross_amount<=0||!money(data.fee_amount)||!money(data.net_amount)||Math.round(data.gross_amount*100)-Math.round(data.fee_amount*100)!==Math.round(data.net_amount*100)||!['pendente','recebido'].includes(data.status)))throw fail(400,'Receita e taxas devem conferir em centavos.');
  if(body.entity==='Revenue'){
   if(!(centralOperational()?typeof data.source==='string'&&data.source.trim():data.source?.startsWith('FICTICIO '))||data.source_type&&!['manual','manual-shared-receipt'].includes(data.source_type)||data.origin_mode&&data.origin_mode!=='manual')throw fail(400,'Recebimento manual exige referência de origem própria e conferida.');
   data.source_type='manual-shared-receipt';
  }
  for(const [key,entity,nameKey] of [['category_id','ExpenseCategory','category_name'],['cost_center_id','CostCenter','cost_center_name'],['financial_account_id','FinancialAccount','financial_account_name']])if(data[key]){
   const ref=(await pool.query('SELECT entity,data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[p.workspace_id,data[key]])).rows[0];
   if(!ref||ref.entity!==entity)throw fail(409,'Referência fora do espaço autorizado.');
   const value=ref.data.payload_json?JSON.parse(ref.data.payload_json):ref.data;if(value.status!=='ativo')throw fail(409,'Referência financeira inativa.');data[nameKey]=value.name;
  }
  if(body.entity==='AccountsPayable'&&(!money(data.amount)||data.amount<=0||data.status!=='pendente'))throw fail(403,'Liquidação de contas a pagar ainda requer integração do agregado.');
  if(['FinancialAccount','CostCenter'].includes(body.entity)&&(!(centralOperational()?typeof data.name==='string'&&data.name.trim():data.name?.startsWith('FICTICIO '))||!['ativo','inativo'].includes(data.status)))throw fail(400,'Cadastro fictício inválido.');
  if(body.entity==='FinancialAccount'){data.initial_balance=0;data.current_balance=0;}
  if(paid(old)&&syncHash(old)!==syncHash(data))throw fail(409,'Documento liquidado só pode mudar por estorno.');
 }
 validateDomainSnapshot(body.entity,{payload_json:JSON.stringify(data)});
 changes.unshift({id:body.id,entity:body.entity,baseVersion:body.baseVersion,data:{name:'FICTICIO '+body.entity+' '+body.id,payload_json:JSON.stringify(data),status:data.status}});
 const command={protocol:'D1LAB/1',operationId:body.operationId,actorId:p.actor_id,deviceId:p.device_id,workspaceId:p.workspace_id,changes};
 return acceptD1(pool,sessionToken,command,{business:true,sourceRequestHash,authorizeSession:c=>auth.authorize(deviceToken,sessionToken,c,true)});
}
