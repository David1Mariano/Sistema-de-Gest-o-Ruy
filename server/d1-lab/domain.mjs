import {assertActiveIntent} from './core.mjs';
import {isDelivery} from './delivery-contract.mjs';
import {assertDeliveryLab,assertDeliveryDatabase,prepareDelivery} from './delivery.mjs';
import {randomUUID} from 'node:crypto';
import {transaction,fail,uuid} from './core.mjs';
import {record} from './entities.mjs';
import {domainFields,isDomain,readOnlyDomains,unwrapDomain} from './domain-contract.mjs';
import {syncHash} from './sync-contract.mjs';
import {applyOperational} from './operations.mjs';
import {isRh,prepareRh,rhHistoryInsert,protectRhPayment} from './rh-domain.mjs';
import {validatePaymentBatch} from './payment-batch.mjs';

const metadata = ['id','_version','created_date','updated_date'];
const money = key => /(?:amount|cost|balance|fund|total|cash|sales|withdrawals|expenses|pix|debit|credit|voucher|difference|daily_rate|sales_goal)$/.test(key);
const positive = n => typeof n==='number' && Number.isFinite(n) && n>0 && n<=1e9;
function date(value){return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function validate(entity,data){
 if(!domainFields[entity]||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!domainFields[entity].includes(k)))throw fail(400,'Campos fora do contrato de domínio.');
  for(const [key,value] of Object.entries(data)){
   if(['ingredients','losses','payments'].includes(key))continue;
  if(money(key)&&value!==null&&typeof value!=='number')throw fail(400,'Campo monetário deve ser numérico.');
  if(!['string','number','boolean'].includes(typeof value)&&value!==null)throw fail(400,'Tipo de campo inválido.');
  if(typeof value==='string'&&(value.length>1000||(/(?:url)$/.test(key)&&value)))throw fail(400,'Anexos ainda exigem transporte privado homologado.');
  if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>1e9||(money(key)&&Math.abs(value*100-Math.round(value*100))>1e-6)))throw fail(400,'Valor monetário deve ter no máximo dois decimais.');
  if(typeof value==='number'&&money(key)&&value<0&&!['difference','machine_system_difference','expected_balance','expected_cash'].includes(key))throw fail(400,'Valor monetário negativo não permitido neste campo.');
  if((key==='date'||key.endsWith('_date'))&&value&&!date(value))throw fail(400,'Data inválida.');
 }
 if(entity==='ProductionProduct'&&(!data.name?.startsWith('FICTICIO ')||!positive(data.yield_quantity)||!data.yield_unit||!['ativo','inativo'].includes(data.status)))throw fail(400,'Ficha sintética, rendimento, unidade e status obrigatórios.');
 if(['ProductionOrder','DailyProduction'].includes(entity)&&(!date(data.date)||!uuid(data.product_id)))throw fail(400,'Data e produto obrigatórios.');
 if(entity==='ProductionOrder'&&(!positive(data.planned_quantity)||!['planejada','em_producao','concluida','cancelada'].includes(data.status)))throw fail(400,'Ordem inválida.');
 if(isRh(entity)&&(!positive(data.amount)||!date(data.date)))throw fail(400,'Data válida e valor positivo em centavos obrigatórios.');
 if(entity==='DailyProduction'){
  if(!positive(data.produced_quantity)||![data.loss_quantity,data.leftover_quantity].every(n=>typeof n==='number'&&n>=0&&n<=data.produced_quantity)||data.loss_quantity+data.leftover_quantity>data.produced_quantity)throw fail(400,'Quantidades de produção/perda/sobra inválidas.');
  if(!Array.isArray(data.losses)||data.losses.length>20||data.losses.some(l=>!positive(l.quantity)||!l.reason?.trim()||!l.responsible?.trim()||!date(l.date)||l.unit!==data.unit||Object.values(l).some(v=>typeof v==='string'&&v.length>500)))throw fail(400,'Detalhamento de perdas inválido.');
  if(data.loss_quantity>0&&!data.losses.length)throw fail(400,'Detalhamento de perdas obrigatorio.');
  if(data.losses.length&&Math.abs(data.losses.reduce((s,l)=>s+l.quantity,0)-data.loss_quantity)>1e-6)throw fail(400,'Total de perdas divergente.');
 }
 if(['FinancialExpense','AccountsPayable','Sangria'].includes(entity)&&!positive(data.amount))throw fail(400,'Valor positivo obrigatório.');
 if(entity==='FinancialExpense'&&(!data.description?.trim()||!date(data.date)||!['pago','pendente','cancelado'].includes(data.status)))throw fail(400,'Descrição, data e situação do gasto obrigatórias.');
 if(entity==='Revenue'&&(!date(data.date)||!positive(data.gross_amount)||typeof data.fee_amount!=='number'||data.fee_amount<0||data.fee_amount>data.gross_amount||Math.round((data.gross_amount-data.fee_amount)*100)!==Math.round(data.net_amount*100)||!['recebido','pendente','cancelado'].includes(data.status)))throw fail(400,'Receita/valor líquido inválido.');
 if(entity==='AccountsPayable'&&(!data.description?.trim()||!date(data.due_date)||!['pendente','pago','cancelado'].includes(data.status)))throw fail(400,'Conta a pagar inválida.');
 if(entity==='FinancialAccount'&&(!data.name?.startsWith('FICTICIO ')||data.initial_balance!==0||data.current_balance!==0))throw fail(400,'Conta sintética com saldos informativos zero obrigatória; use o razão para movimentação.');
 if(entity==='Sangria'&&(!date(data.date)||!data.responsible?.trim()||!data.purpose?.trim()||!['ativo','cancelado'].includes(data.status)))throw fail(400,'Sangria inválida.');
 if(['CashMovement','FechamentoCaixa'].includes(entity)&&(!date(data.date)||!data.operator_name?.trim()))throw fail(400,'Data e operador obrigatórios.');
}
async function get(c,owner,entity,id){
 if(!uuid(id))throw fail(400,'UUID obrigatório.');
 const row=(await c.query('SELECT * FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity=$3 FOR UPDATE',[id,owner,entity])).rows[0];
 if(!row)throw fail(409,'Documento/referência não encontrado no escopo local.');return row;
}
async function rows(c,owner,entity){return (await c.query('SELECT * FROM d2_catalog WHERE owner_id=$1 AND entity=$2 ORDER BY id',[owner,entity])).rows;}
export async function domainList(pool,user,entity){
 if(isDelivery(entity))await assertDeliveryDatabase(pool);
 if(!isDomain(entity))throw fail(404,'Domínio desconhecido.');
 if(user.role!=='admin')throw fail(403,'Domínio restrito ao administrador sintético.');
 if(readOnlyDomains.includes(entity))throw fail(501,'Fonte '+entity+' ainda não portada; relatório completo indisponível.');
 const result=(await rows(pool,user.id,entity)).map(unwrapDomain);
 if(entity==='FinancialAccount'){const balances=(await pool.query('SELECT account,balance_cents FROM d1_financial_accounts WHERE owner_id=$1',[user.id])).rows;return result.map(row=>({...row,current_balance:Number(balances.find(b=>b.account==='account:'+row.id)?.balance_cents||0)/100}));}
 return result;
}
async function recipe(c,owner,product,ingredients){
 if(!Array.isArray(ingredients)||!ingredients.length||ingredients.length>20||new Set(ingredients.map(l=>l.inventory_item_id)).size!==ingredients.length)throw fail(400,'Ficha exige 1 a 20 insumos distintos.');
 const result=[];let total=0;
 for(const line of ingredients){
  if(!positive(line.quantity))throw fail(400,'Quantidade de insumo inválida.');
  const item=await get(c,owner,'InventoryItem',line.inventory_item_id);
  if(item.data.status!=='ativo')throw fail(409,'Insumo inativo.');
  const balance=(await c.query('SELECT average_cents FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2',[owner,item.id])).rows[0];
  const unitCost=Number(balance?.average_cents??0)/100;
  const totalCost=Math.round(line.quantity*unitCost*100)/100;total+=Math.round(totalCost*100);
  result.push({id:line.id&&uuid(line.id)?line.id:randomUUID(),product_id:product.id,product_name:product.name,inventory_item_id:item.id,inventory_item_name:item.data.name,quantity:line.quantity,unit:item.data.unit,unit_cost:unitCost,total_cost:totalCost});
 }
 return {ingredients:result,total_cost:total/100,unit_cost:Math.round(total/product.yield_quantity)/100};
}
async function preview(c,owner,row){
 const d=unwrapDomain(row);
 if(!d.recipe_snapshot?.length||d.local_status==='cancelado')throw fail(409,'Produção sem ficha ou cancelada.');
 const inputs=[];
 for(const line of d.recipe_snapshot){
  const exact=line.quantity*d.produced_quantity/d.recipe_yield*1000;
  // Never silently discard a fraction of a milliunit during stock deduction.
  if(!Number.isSafeInteger(Math.round(exact))||Math.abs(exact-Math.round(exact))>1e-6||exact<=0)throw fail(409,'Consumo exige conversão de unidade/precisão antes da baixa.');
  const item=await get(c,owner,'InventoryItem',line.inventory_item_id);
  if(item.data.unit!==line.unit||item.data.status!=='ativo')throw fail(409,'Unidade ou situação do insumo mudou; revise a ficha.');
  const b=(await c.query('SELECT * FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2 FOR UPDATE',[owner,item.id])).rows[0];
  inputs.push({itemId:item.id,itemName:item.data.name,unit:line.unit,quantityMilli:Math.round(exact),baseVersion:Number(b?.version??0),availableMilli:Number(b?.quantity_milli??0)});
 }
 return {recordId:row.id,baseVersion:Number(row.version),inputs,token:syncHash({id:row.id,version:Number(row.version),inputs}),alreadyConfirmed:d.local_status==='confirmado',canConfirm:d.local_status!=='confirmado'&&inputs.every(i=>i.availableMilli>=i.quantityMilli),businessConfirmed:false};
}
export async function domainPreview(pool,user,id){
 return transaction(pool,async c=>{if(user.role!=='admin')throw fail(403,'Administrador obrigatório.');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);return preview(c,user.id,await get(c,user.id,'DailyProduction',id));});
}
export async function domainCommand(pool,user,deviceId,body,hook=async()=>{}){
  if(!uuid(body?.operationId)||!uuid(body.id)||!domainFields[body.entity]||!['save','confirm','cancel','reverse','generate','batch','transition'].includes(body.action)||body.action==='transition'&&!isDelivery(body.entity)||Object.keys(body).some(k=>!['operationId','entity','id','action','baseVersion','data','token','payments','reason'].includes(k)))throw fail(400,'Comando de domínio inválido.');
 if(isDelivery(body.entity))assertDeliveryLab();
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
  const actor=(await c.query('SELECT id,role FROM lab_users WHERE id=$1 AND active FOR SHARE',[user.id])).rows[0];
  if(actor?.role!=='admin')throw fail(403,'Administrador sintético obrigatório.');
  const hash=syncHash(body),prior=(await c.query('SELECT * FROM lab_outbox WHERE operation_id=$1',[body.operationId])).rows[0];
  if(prior){await assertActiveIntent(c,prior.operation_id);if(prior.actor!==actor.id||prior.payload_hash!==hash)throw fail(409,'UUID reutilizado com outra intenção.');return {...prior.result,replay:true};}
  const current=(await c.query('SELECT * FROM d2_catalog WHERE id=$1 FOR UPDATE',[body.id])).rows[0];
  if(current&&(current.owner_id!==actor.id||current.entity!==body.entity))throw fail(403,'Documento fora do escopo.');
  if(current?Number(current.version)!==body.baseVersion:body.baseVersion!==null)throw fail(409,'Documento alterado; recarregue.');
  const old=current?unwrapDomain(current):null,changes=[];
  const save=async(entity,id,payload,base)=>{
   const data={name:'FICTICIO '+entity+' '+id,payload_json:JSON.stringify(payload),status:payload.local_status||payload.status||'ativo'};
   if(data.payload_json.length>4000)throw fail(413,'Documento excede limite do laboratório.');
   const row=base?(await c.query('UPDATE d2_catalog SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,data])).rows[0]:(await c.query('INSERT INTO d2_catalog(id,owner_id,entity,data,name_key) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,actor.id,entity,data,data.name.toLowerCase()])).rows[0];
   changes.push({entity,record:record(row)});return unwrapDomain(row);
  };
  let data;
  if(isDelivery(body.entity))data=await prepareDelivery(c,actor,body,old);
  else if(body.action==='save'){
   if(old?.status==='cancelado')throw fail(409,'Documento cancelado é imutável; reabertura exige fluxo homologado.');
   if(old?.local_status&&old.local_status!=='rascunho')throw fail(409,'Produção confirmada/cancelada é imutável; use cancelamento.');
   const supplied=Object.fromEntries(Object.entries(body.data||{}).filter(([k])=>!metadata.includes(k)));
   // Derived fields sent back by the original forms are never accepted as authority.
   for(const key of ['recipe_snapshot','recipe_yield','local_status','source_device_id','consumption_effects','confirmation_id','cancellation_id','linked_payment_id','rh_deductions'])delete supplied[key];
   if(body.entity==='ProductionProduct'){delete supplied.total_cost;delete supplied.unit_cost;}
   if(body.entity==='ProductionOrder'&&supplied.status==='concluida')throw fail(409,'Conclua a ordem pela confirmacao agregada da producao.');
   data={...(old?Object.fromEntries(Object.entries(old).filter(([k])=>!metadata.includes(k))):{}),...supplied};
   if(['ProductionOrder','DailyProduction'].includes(body.entity)){
    const p=unwrapDomain(await get(c,actor.id,'ProductionProduct',data.product_id));data.product_name=p.name;data.unit=p.yield_unit;
   }
   if(body.entity==='FinancialAccount'){data.initial_balance=0;data.current_balance=0;}
   validate(body.entity,Object.fromEntries(Object.entries(data).filter(([k])=>domainFields[body.entity].includes(k))));
   if(Object.keys(supplied).some(k=>!domainFields[body.entity].includes(k)))throw fail(400,'Campo não permitido.');
   if(isRh(body.entity))data=await prepareRh({c,actor,deviceId,body,old,data,get,save});
   for(const [field,entity,nameField] of [['financial_account_id','FinancialAccount','financial_account_name'],['cost_center_id','CostCenter','cost_center_name'],['category_id','ExpenseCategory','category_name']])if(data[field]){
    const ref=await get(c,actor.id,entity,data[field]);const value=entity==='ExpenseCategory'?ref.data:unwrapDomain(ref);
    if(value.status!=='ativo')throw fail(409,'Referência financeira inativa.');data[nameField]=value.name;
   }
   if(body.entity==='ProductionProduct')Object.assign(data,await recipe(c,actor.id,{id:body.id,...data},data.ingredients));
   if(['AccountsReceivable','CardReceivable','DeliverySettlement'].includes(body.entity)){
    if(body.entity==='AccountsReceivable'&&data.source_id&&(!old||data.source_id!==old.source_id||data.source_type!==old.source_type))throw fail(409,'Vínculo de recebível deve nascer pelo agregado da origem.');
    const cents=v=>Math.round(Number(v)*100);
    const fees=body.entity==='DeliverySettlement'?['discount_amount','commission_amount','delivery_fee_amount','other_fee_amount'].reduce((s,k)=>s+cents(data[k]||0),0):cents(data.fee_amount||0);
    if(!positive(data.gross_amount)||fees<0||fees>cents(data.gross_amount)||cents(data.net_amount)!==cents(data.gross_amount)-fees||!date(data.expected_date))throw fail(400,'Recebível, taxas ou vencimento inválidos.');
    if(['CardReceivable','DeliverySettlement'].includes(body.entity)){
     if(old)throw fail(409,'Edite/receba pelo título vinculado; origem não pode ser regravada separadamente.');
     const receivableId=randomUUID();data.accounts_receivable_id=receivableId;data.status='a_receber';
     await save('AccountsReceivable',receivableId,{description:(body.entity==='CardReceivable'?'Cartão ':'Repasse ')+(data.acquirer||data.channel||''),source_type:body.entity==='CardReceivable'?'cartao':'delivery',source_id:body.id,reference_date:data.sale_date||data.reference_end,expected_date:data.expected_date,gross_amount:data.gross_amount,fee_amount:fees/100,net_amount:data.net_amount,financial_account_id:data.financial_account_id||'',financial_account_name:data.financial_account_name||'',status:'pendente'},null);
    }else if(data.status==='recebido'){
     if(!old||old.status!=='pendente'||!date(data.received_date))throw fail(409,'Recebimento exige título pendente e data válida.');
     data.reconciled=false;
     if(data.source_id){
      const entity=data.source_type==='cartao'?'CardReceivable':data.source_type==='delivery'?'DeliverySettlement':null;
      if(!entity)throw fail(409,'Origem vinculada não suportada.');
      const source=await get(c,actor.id,entity,data.source_id),s=unwrapDomain(source);
      if(s.accounts_receivable_id!==body.id)throw fail(409,'Recebível e origem divergentes.');
      await save(entity,source.id,{...Object.fromEntries(Object.entries(s).filter(([k])=>!metadata.includes(k))),status:'recebido',received_date:data.received_date},source);
     }
    }else if(!['pendente','cancelado'].includes(data.status)||old?.status==='recebido')throw fail(409,'Alteração de recebível liquidado exige estorno homologado.');
    else if(data.status==='cancelado'&&data.source_id){
     const entity=data.source_type==='cartao'?'CardReceivable':data.source_type==='delivery'?'DeliverySettlement':null;
     if(!entity)throw fail(409,'Origem vinculada não suportada.');
     const source=await get(c,actor.id,entity,data.source_id),s=unwrapDomain(source);
     if(s.accounts_receivable_id!==body.id)throw fail(409,'Recebível e origem divergentes.');
     await save(entity,source.id,{...Object.fromEntries(Object.entries(s).filter(([k])=>!metadata.includes(k))),status:'cancelado'},source);
    }
   }
   if(body.entity==='ManualReconciliation'){
    if(!date(data.date)||![data.expected_amount,data.actual_amount].every(n=>typeof n==='number'&&n>=0&&Number.isFinite(n)))throw fail(400,'Conferência financeira inválida.');
    data.difference=(Math.round(data.actual_amount*100)-Math.round(data.expected_amount*100))/100;data.status=data.difference===0?'conciliado':'divergente';
   }
   if(body.entity==='MachineRotation'&&(!data.operator?.trim()||!data.terminal?.trim()||!['segunda','terca','quarta','quinta','sexta','sabado','domingo'].includes(data.weekday)||!['ativo','inativo'].includes(data.status)))throw fail(400,'Rodízio inválido.');
   if(body.entity==='RecurringExpense'&&(!data.name?.trim()||!positive(data.amount)||!date(data.next_due_date)||!['mensal','semanal','quinzenal','anual'].includes(data.frequency)))throw fail(400,'Recorrência inválida.');
   if(body.entity==='DailyFinancialClose')throw fail(409,'Fechamento global depende da integração de vales/RH; nenhuma gravação parcial executada.');
   if(['ProductionOrder','DailyProduction'].includes(body.entity)){
    const p=unwrapDomain(await get(c,actor.id,'ProductionProduct',data.product_id));
    if(p.status!=='ativo')throw fail(409,'Ficha inativa.');
    data.product_name=p.name;data.unit=p.yield_unit;
    if(body.entity==='DailyProduction'){
     if(old?.production_order_id&&old.production_order_id!==data.production_order_id)throw fail(409,'Troca de ordem vinculada exige cancelamento do registro anterior.');
     data.recipe_snapshot=p.ingredients;data.recipe_yield=p.yield_quantity;data.local_status='rascunho';data.source_device_id=deviceId;
     if(data.production_order_id){
      const order=await get(c,actor.id,'ProductionOrder',data.production_order_id),o=unwrapDomain(order);
      if(o.product_id!==p.id||o.status==='cancelada')throw fail(409,'Ordem incompatível.');
      const duplicate=(await rows(c,actor.id,'DailyProduction')).map(unwrapDomain).find(r=>r.id!==body.id&&r.production_order_id===o.id&&r.local_status!=='cancelado');
      if(duplicate)throw fail(409,'Ordem já vinculada a outra produção.');
      await save('ProductionOrder',o.id,{...Object.fromEntries(Object.entries(o).filter(([k])=>!metadata.includes(k))),status:'em_producao',produced_quantity:0},order);
     }
    }
   }
   if(body.entity==='EmployeePayment'){
    protectRhPayment(old,data);
    if(data.vale_id||data.payment_type==='vale')throw fail(409,'Vale não gera nova despesa por pagamento; use o vínculo de desconto RH.');
    const employee=(await c.query("SELECT * FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' AND coalesce(data->>'_deleted','false')<>'true'",[data.employee_id,actor.id])).rows[0];
    if(!employee||!['ativo','em_experiencia','folga','ferias','afastado'].includes(employee.data.status)||!positive(data.net_amount)||!positive(data.gross_amount)||typeof data.discount_amount!=='number'||data.discount_amount<0||Math.round((data.gross_amount-data.discount_amount)*100)!==Math.round(data.net_amount*100)||!date(data.payment_date)||!['pago','pendente','cancelado'].includes(data.status))throw fail(400,'Colaborador, data ou valores do pagamento inválidos.');
    if(old?.source_device_id&&old.source_device_id!==deviceId)throw fail(409,'Pagamento remoto exige reconciliação.');
    const linked=old?.financial_expense_id?await get(c,actor.id,'FinancialExpense',old.financial_expense_id):null;
    const expenseId=linked?.id||randomUUID();
    data.employee_name=employee.data.name;data.sector=employee.data.sector||'';data.function=employee.data.function||'';data.financial_expense_id=expenseId;data.source_device_id=deviceId;
    const priorExpense=linked?unwrapDomain(linked):{};
    await save('FinancialExpense',expenseId,{...Object.fromEntries(Object.entries(priorExpense).filter(([k])=>!metadata.includes(k))),description:'Pagamento - '+employee.data.name,date:data.payment_date,paid_date:data.status==='pago'?data.payment_date:'',amount:data.net_amount,beneficiary_type:'colaborador',beneficiary_id:employee.id,beneficiary_name:employee.data.name,payment_method:data.payment_method,status:data.status,origin_type:'pagamento_colaborador',origin_id:body.id,linked_payment_id:body.id,observation:data.observation||''},linked);
   }
   if(body.entity==='CashMovement'){
    const cents=k=>Math.round(Number(data[k]||0)*100);
    const expected=cents('opening_fund')+['cash','pix','debit','credit','voucher'].reduce((s,k)=>s+cents(k),0)-cents('withdrawals')-cents('expenses');
    data.expected_balance=expected/100;data.difference=(cents('counted_balance')-expected)/100;
    if(data.status!=='em_preenchimento')data.status=Math.abs(data.difference)<=0.01?'conferido':'divergente';
    try{const allocations=JSON.parse(data.account_allocations||'{}');if(!allocations||Array.isArray(allocations)||Object.values(allocations).some(v=>typeof v!=='number'||v<0||!Number.isFinite(v)||Math.abs(v*100-Math.round(v*100))>1e-6))throw Error();}catch{throw fail(400,'Distribuição por conta inválida.');}
   }
   if(body.entity==='FechamentoCaixa'){
    const duplicate=(await rows(c,actor.id,'FechamentoCaixa')).map(unwrapDomain).some(r=>r.id!==body.id&&r.date===data.date&&r.cashier===data.cashier&&r.shift===data.shift&&r.status!=='cancelado');
    if(duplicate)throw fail(409,'Fechamento já existe para data, caixa e turno.');
    const cents=k=>Math.round(Number(data[k]||0)*100);
    data.expected_cash=(cents('opening_fund')+cents('cash_sales')-cents('withdrawals_total'))/100;
    data.difference=(cents('counted_cash')-Math.round(data.expected_cash*100))/100;
    data.machine_system_difference=(cents('pix_total')-cents('pix_machine')+cents('debit_total')-cents('debit_machine')+cents('credit_total')-cents('credit_machine'))/100;
    if(data.status!=='em_preenchimento')data.status=data.difference===0?'fechado':data.difference<0?'com_falta':'com_sobra';
   }
   if(body.entity==='AccountsPayable'&&data.status==='pago'){
    if(!old||old.status!=='pendente'||!date(data.paid_date))throw fail(409,'Conta pendente existente e data de pagamento obrigatórias.');
    const expenseId=randomUUID();data.financial_expense_id=expenseId;
    await save('FinancialExpense',expenseId,{description:data.description,date:data.paid_date,paid_date:data.paid_date,due_date:data.due_date,amount:data.amount,payment_method:data.payment_method_planned,status:'pago',beneficiary_type:data.beneficiary_type||'fornecedor',beneficiary_name:data.beneficiary_name||'',origin_type:'conta_pagar',origin_id:body.id,accounts_payable_id:body.id,category_id:data.category_id||'',category_name:data.category_name||'',financial_account_id:data.financial_account_id||'',financial_account_name:data.financial_account_name||'',observation:data.observation||''},null);
   }else if(body.entity==='AccountsPayable'&&old?.status==='pago')throw fail(409,'Conta quitada exige cancelamento agregado específico.');
   if(body.entity==='FinancialExpense'&&((data.origin_type&&!['manual','pagamento_colaborador'].includes(data.origin_type))||old?.origin_type==='conta_pagar'))throw fail(409,'Despesa vinculada exige comando do agregado de origem.');
   if(body.entity==='FinancialExpense'&&data.beneficiary_type==='colaborador'){
    const employee=(await c.query("SELECT * FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' AND coalesce(data->>'_deleted','false')<>'true'",[data.beneficiary_id,actor.id])).rows[0];
    if(!employee||!['ativo','em_experiencia','folga','ferias','afastado'].includes(employee.data.status))throw fail(409,'Colaborador elegível obrigatório.');
    const linked=old?.linked_payment_id?await get(c,actor.id,'EmployeePayment',old.linked_payment_id):null;
    const linkedData=linked?unwrapDomain(linked):{};
    if(linkedData.rh_deductions?.length)throw fail(409,'Despesa de folha com descontos RH deve ser preservada; reconciliação necessária.');
    if(linked&&linkedData.payment_type&&!['outros','adiantamento'].includes(linkedData.payment_type))throw fail(409,'Edite este pagamento pela tela de pagamentos para preservar a composição salarial.');
    const paymentId=linked?.id||randomUUID();data.linked_payment_id=paymentId;
    await save('EmployeePayment',paymentId,{...Object.fromEntries(Object.entries(linkedData).filter(([k])=>!metadata.includes(k))),employee_id:employee.id,employee_name:employee.data.name,payment_type:linkedData.payment_type||'outros',gross_amount:data.amount,discount_amount:0,net_amount:data.amount,payment_date:data.paid_date||data.date,payment_method:data.payment_method,status:data.status,financial_expense_id:body.id,source_device_id:deviceId},linked);
   }else if(old?.linked_payment_id)throw fail(409,'Troca de favorecido exige cancelamento do agregado anterior.');
  }else if(body.action==='generate'){
   if(body.entity!=='RecurringExpense'||!old||old.status!=='ativo')throw fail(409,'Recorrência ativa obrigatória.');
   data=Object.fromEntries(Object.entries(old).filter(([k])=>!metadata.includes(k)));
   const duplicate=(await rows(c,actor.id,'AccountsPayable')).map(unwrapDomain).some(p=>p.recurring_expense_id===body.id&&p.due_date===data.next_due_date&&p.status!=='cancelado');
   if(duplicate)throw fail(409,'Título já gerado para este vencimento.');
   await save('AccountsPayable',randomUUID(),{description:data.name,issue_date:data.next_due_date,due_date:data.next_due_date,amount:data.amount,category_id:data.category_id||'',category_name:data.category_name||'',cost_center_id:data.cost_center_id||'',cost_center_name:data.cost_center_name||'',beneficiary_name:data.beneficiary_name||'',beneficiary_type:'fornecedor',financial_account_id:data.financial_account_id||'',financial_account_name:data.financial_account_name||'',recurring_expense_id:body.id,status:'pendente'},null);
   const next=new Date(data.next_due_date+'T12:00:00Z');
   if(data.frequency==='mensal'||data.frequency==='anual'){
    const day=next.getUTCDate();next.setUTCDate(1);next.setUTCMonth(next.getUTCMonth()+(data.frequency==='anual'?12:1));const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();next.setUTCDate(Math.min(day,last));
   }else next.setUTCDate(next.getUTCDate()+(data.frequency==='quinzenal'?15:7));
   data.next_due_date=next.toISOString().slice(0,10);
  }else   if(body.action==='batch'){
   if(body.entity!=='EmployeePayment')throw fail(409,'Lote de pagamentos suportado apenas para EmployeePayment.');
   if(current)throw fail(409,'Lote processado é imutável; registre um novo lote após conferência.');
   const items=validatePaymentBatch(body);
   const results=[];
   for(const p of items){
    if(p.vale_id||p.payment_type==='vale')throw fail(409,'Vale exige fluxo RH, sem nova despesa em lote.');
    const employee=(await c.query("SELECT * FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' AND coalesce(data->>'_deleted','false')<>'true' FOR SHARE",[p.employee_id,actor.id])).rows[0];
    if(!employee||!['ativo','em_experiencia','folga','ferias','afastado'].includes(employee.data.status))throw fail(409,'Colaborador '+String(p.employee_id)+' não elegível.');
    if(!positive(p.net_amount)||!positive(p.gross_amount)||typeof p.discount_amount!=='number'||p.discount_amount<0||Math.round((p.gross_amount-p.discount_amount)*100)!==Math.round(p.net_amount*100)||!date(p.payment_date)||!['pago','pendente'].includes(p.status||'pago'))throw fail(400,'Valores do pagamento '+String(p.employee_id)+' inválidos.');
    const equivalent=(await rows(c,actor.id,'EmployeePayment')).map(unwrapDomain).some(existing=>['employee_id','gross_amount','discount_amount','net_amount','payment_date'].every(key=>existing[key]===p[key])&&(existing.payment_type||'outros')===(p.payment_type||'outros')&&(existing.observation||'')===(p.observation||'')&&existing.status!=='cancelado');
    if(equivalent)throw fail(409,'Pagamento equivalente já registrado; confira antes de repetir.');
    const expenseId=randomUUID();const paymentId=randomUUID();
    await save('FinancialExpense',expenseId,{description:'Pagamento lote - '+employee.data.name,date:p.payment_date,paid_date:(p.status||'pago')==='pago'?p.payment_date:'',amount:p.net_amount,beneficiary_type:'colaborador',beneficiary_id:employee.id,beneficiary_name:employee.data.name,payment_method:p.payment_method,status:p.status||'pago',origin_type:'pagamento_colaborador',origin_id:paymentId,linked_payment_id:paymentId,observation:(p.observation||'').slice(0,500)},null);
    await save('EmployeePayment',paymentId,{employee_id:employee.id,employee_name:employee.data.name,sector:employee.data.sector||'',function:employee.data.function||'',payment_type:p.payment_type||'outros',reference_start:p.reference_start||'',reference_end:p.reference_end||'',work_date:p.work_date||'',days_quantity:p.days_quantity||1,daily_rate:p.daily_rate||0,gross_amount:p.gross_amount,discount_amount:p.discount_amount,net_amount:p.net_amount,payment_date:p.payment_date,payment_method:p.payment_method,status:p.status||'pago',financial_expense_id:expenseId,source_device_id:deviceId,observation:(p.observation||'').slice(0,500)},null);
    results.push({employee_id:employee.id,payment_id:paymentId,expense_id:expenseId});
   }
   const obs='Lote de '+results.length+' pagamento(s).';
   data={date:new Date().toISOString().slice(0,10),status:'processado',observation:obs,responsible_user:actor.id};
   body.id=body.id||crypto.randomUUID();
  }else if(isRh(body.entity)&&body.action==='cancel'){
   if(!old)throw fail(409,'Lançamento RH inexistente.');
   data=await prepareRh({c,actor,deviceId,body,old,data:{...Object.fromEntries(Object.entries(old).filter(([k])=>!metadata.includes(k))),status:'cancelado'},get,save});
  }else if(body.action==='reverse'){
   if(!old||!['FinancialExpense','Revenue','AccountsReceivable'].includes(body.entity)||!['pago','recebido'].includes(old.status))throw fail(409,'Settled financial document required.');
   if(old.rh_deductions?.length)throw fail(409,'Linked obligation reversal requires complete linked aggregate; preserve original.');
   for(const [id,entity] of [[old.linked_payment_id,'EmployeePayment'],[old.accounts_payable_id,'AccountsPayable'],[old.source_id,old.source_type==='cartao'?'CardReceivable':'DeliverySettlement']])if(id){const linked=await get(c,actor.id,entity,id),d=unwrapDomain(linked);if(d.rh_deductions?.length)throw fail(409,'Payroll deductions require explicit release aggregate.');await save(entity,id,{...Object.fromEntries(Object.entries(d).filter(([k])=>!metadata.includes(k))),status:'cancelado',cancellation_id:body.operationId},linked);}
   const entries=(await c.query('SELECT e.account,a.version FROM d1_financial_entries e JOIN d1_financial_accounts a ON a.owner_id=e.owner_id AND a.account=e.account WHERE e.owner_id=$1 AND e.operation_id=$2 ORDER BY e.account',[actor.id,body.id])).rows;
   const op=await applyOperational(c,actor,deviceId,{operationId:body.operationId,kind:'reversal',referenceId:body.id,reason:body.reason,entries:entries.map(e=>({account:e.account,baseVersion:Number(e.version)}))},async()=>{},{enqueue:false});
   changes.push({entity:'OperationalEvent',record:op.record});
   data={...Object.fromEntries(Object.entries(old).filter(([k])=>!metadata.includes(k))),status:'cancelado',cancellation_id:body.operationId};
  }else{
   if(!old)throw fail(409,'Documento inexistente.');
   if(body.entity!=='DailyProduction')throw fail(409,'Cancelamento agregado deste domínio ainda não homologado.');
   if(old.source_device_id!==deviceId)throw fail(409,'Movimento de outro dispositivo exige reconciliação, sem reaplicação local.');
   data=Object.fromEntries(Object.entries(old).filter(([k])=>!metadata.includes(k)));
   if(body.action==='confirm'){
    const p=await preview(c,actor.id,current);
    if(old.local_status!=='rascunho'||p.token!==body.token||!p.canConfirm)throw fail(409,'Conferência/saldo mudou ou baixa já realizada. Reabra a conferência.');
    const op=await applyOperational(c,actor,deviceId,{operationId:body.operationId,kind:'consume',inputs:p.inputs.map(({itemId,quantityMilli,baseVersion})=>({itemId,quantityMilli,baseVersion}))},async()=>{},{enqueue:false});
    changes.push({entity:'OperationalEvent',record:op.record});
    data.local_status='confirmado';data.confirmation_id=op.operationId;data.consumption_effects=op.effects;
    if(old.production_order_id){const row=await get(c,actor.id,'ProductionOrder',old.production_order_id),order=unwrapDomain(row);await save('ProductionOrder',row.id,{...Object.fromEntries(Object.entries(order).filter(([k])=>!metadata.includes(k))),status:'concluida',produced_quantity:old.produced_quantity},row);}
   }else{
    if(old.local_status==='cancelado')throw fail(409,'Produção já cancelada.');
    if(old.local_status==='confirmado'){
     const inputs=[];for(const effect of old.consumption_effects){const balance=(await c.query('SELECT version FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2 FOR UPDATE',[actor.id,effect.itemId])).rows[0];inputs.push({itemId:effect.itemId,baseVersion:Number(balance.version)});}
     const op=await applyOperational(c,actor,deviceId,{operationId:body.operationId,kind:'reversal',referenceId:old.confirmation_id,reason:body.reason||'Cancelamento supervisionado de producao',inputs},async()=>{},{enqueue:false});changes.push({entity:'OperationalEvent',record:op.record});
    }
    data.local_status='cancelado';data.cancellation_id=body.operationId;
    if(old.production_order_id){const row=await get(c,actor.id,'ProductionOrder',old.production_order_id);const order=unwrapDomain(row);await save('ProductionOrder',row.id,{...Object.fromEntries(Object.entries(order).filter(([k])=>!metadata.includes(k))),status:'cancelada',produced_quantity:0},row);}
   }
  }
  const publicRecord=await save(body.entity,body.id,data,current);
  await rhHistoryInsert(c,{owner:actor.id,id:body.id,entity:body.entity,operation:body.operationId,actor:actor.id,device:deviceId,version:publicRecord._version,action:body.action,snapshot:publicRecord});
  const main=changes.pop(),result={operationId:body.operationId,record:main.record,cascata:changes,domainRecord:publicRecord,replay:false,businessConfirmed:false,externalConfirmed:false};
  await c.query('INSERT INTO lab_outbox(operation_id,device_id,actor,entity,record_id,operation,base_version,record_version,payload_hash,payload,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[body.operationId,deviceId,actor.id,body.entity,body.id,current?'update':'create',current?Number(current.version):null,main.record._version,hash,main.record,result]);
  await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[actor.id,body.entity+':'+body.action,body.operationId]);
  await hook(c);return result;
 });
}
export async function domainRoute(pool,user,deviceId,req,url,body){
 if(url.pathname==='/api/d1/domain/command'&&req.method==='POST')return domainCommand(pool,user,deviceId,body);
 const history=url.pathname.match(/^\/api\/d1\/domain\/history\/(Vale|Consumption)\/([a-f0-9-]+)$/);
 if(history&&req.method==='GET'){
  if(user.role!=='admin')throw fail(403,'Histórico RH restrito ao administrador local.');
  if(!uuid(history[2]))throw fail(400,'UUID obrigatório.');
  const records=(await pool.query('SELECT operation_id,actor_id,device_id,record_version,action,snapshot,created_at FROM d1_rh_history WHERE owner_id=$1 AND entity=$2 AND record_id=$3 ORDER BY created_at,record_version',[user.id,history[1],history[2]])).rows;
  return {records};
 }
 const match=url.pathname.match(/^\/api\/d1\/domain\/([A-Za-z]+)$/);
 if(match&&req.method==='GET')return {records:await domainList(pool,user,match[1])};
 const previewMatch=url.pathname.match(/^\/api\/d1\/domain\/preview\/([a-f0-9-]+)$/);
 if(previewMatch&&req.method==='GET')return domainPreview(pool,user,previewMatch[1]);
 return null;
}
