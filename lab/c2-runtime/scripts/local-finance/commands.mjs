const fail=(status,message)=>Object.assign(Error(message),{status});
const expose=row=>row&&({...row.data,id:row.id,version:row.version});
function cents(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e9||Math.abs(value*100-Math.round(value*100))>0.001)throw fail(422,'invalid_money');return Math.round(value*100);}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw fail(422,'invalid_date');}
const create=(entity,id,data)=>({action:'create',entity,id,data});
const update=(entity,row,data)=>({action:'update',entity,id:row.id,expectedVersion:row.version,data});
async function get(client,entity,id,expected){const row=expose((await client.query('SELECT * FROM ruy_finance.record WHERE entity=$1 AND id=$2 FOR UPDATE',[entity,id])).rows[0]);if(!row)throw fail(404,'record_not_found');if(row.version!==expected)throw fail(409,'version_conflict');return row;}
async function openDate(client,accountId,value){date(value);const prior=(await client.query("SELECT max(data->>'date') AS date FROM ruy_finance.record WHERE entity='DailyFinancialClose' AND data->>'account_id'=$1",[accountId])).rows[0].date;if(prior&&value<=prior)throw fail(409,'cash_day_closed');}

// Derives ALL writes from trusted database state on the repository's transaction.
export async function deriveFinanceCommand(client,operationId,command,params) {
  if(!params||typeof params!=='object'||Array.isArray(params))throw fail(422,'invalid_command');
  const account=await get(client,'FinancialAccount',params.accountId,params.expectedAccountVersion);
  if(account.status==='cancelled')throw fail(409,'account_unavailable');
  if(command==='dailyCashRecord') {
    if(params.confirmation!=='CONFIRMAR CAIXA'||!['caixa_1','caixa_2','delivery'].includes(params.source)||!String(params.operator_name||'').trim())throw fail(422,'confirmation_required');
    if(params.source==='delivery'?!['ifood','99food','brendi','delivery_proprio'].includes(params.channel):params.channel!=='loja')throw fail(422,'invalid_channel');
    await openDate(client,account.id,params.date);
    const prior=await client.query("SELECT id FROM ruy_finance.record WHERE entity='CashMovement' AND data->>'source'=$1 AND data->>'date'=$2 AND data->>'channel'=$3",[params.source,params.date,params.channel||'loja']);
    if(prior.rows.length)throw fail(409,'daily_cash_already_registered');
    const values={};for(const key of ['cash','pix','debit','credit','voucher','withdrawals','expenses']){const value=cents(params[key]);if(value<0)throw fail(422,'invalid_money');values[key]=value/100;}
    const opening=cents(account.balance||0);if(cents(params.opening_fund)!==opening)throw fail(409,'opening_balance_changed');
    const incoming=['cash','pix','debit','credit','voucher'].reduce((sum,key)=>sum+cents(values[key]),0),outgoing=cents(values.withdrawals)+cents(values.expenses),balance=opening+incoming-outgoing;
    if(balance<0)throw fail(409,'insufficient_cash_balance');
    const counted=params.counted_balance===null?null:cents(params.counted_balance);if(counted!==null&&counted<0)throw fail(422,'invalid_money');
    const movementId=`${operationId}_movement`,changes=[];
    if(incoming)changes.push(create('Revenue',`${operationId}_incoming`,{account_id:account.id,date:params.date,amount:incoming/100,gross_amount:incoming/100,net_amount:incoming/100,status:'paid',paid_date:params.date,paid_amount:incoming/100,cash_movement_id:movementId,description:`Caixa ${params.source}`}));
    if(values.expenses)changes.push(create('FinancialExpense',`${operationId}_expense`,{account_id:account.id,date:params.date,amount:values.expenses,status:'paid',paid_date:params.date,paid_amount:values.expenses,cash_movement_id:movementId,description:`Saídas ${params.source}`}));
    if(values.withdrawals)changes.push(create('Sangria',`${operationId}_withdrawal`,{account_id:account.id,date:params.date,amount:values.withdrawals,status:'paid',paid_date:params.date,paid_amount:values.withdrawals,cash_movement_id:movementId,description:`Sangria ${params.source}`}));
    changes.push(update('FinancialAccount',account,{balance:balance/100}));
    changes.push(create('CashMovement',movementId,{account_id:account.id,date:params.date,source:params.source,channel:params.channel||'loja',operator_name:params.operator_name,observation:String(params.observation||'').slice(0,2000),...values,amount:(incoming-outgoing)/100,type:'conferencia_diaria',opening_fund:opening/100,expected_balance:balance/100,balance_before:opening/100,balance_after:balance/100,counted_balance:counted===null?'':counted/100,difference:counted===null?0:(counted-balance)/100,status:counted===null?'em_preenchimento':Math.abs(counted-balance)<=1?'conferido':'divergente'}));
    return changes;
  }
  if(command==='closeCash') {
    if(params.confirmation!=='CONFIRMAR FECHAMENTO')throw fail(422,'confirmation_required');
    await openDate(client,account.id,params.date);
    const totals=(await client.query("SELECT coalesce(sum((data->>'amount')::numeric) FILTER(WHERE data->>'date'<$2),0) AS opening,coalesce(sum((data->>'amount')::numeric) FILTER(WHERE data->>'date'=$2 AND (data->>'amount')::numeric>0),0) AS incoming,coalesce(-sum((data->>'amount')::numeric) FILTER(WHERE data->>'date'=$2 AND (data->>'amount')::numeric<0),0) AS outgoing FROM ruy_finance.record WHERE entity='CashMovement' AND data->>'account_id'=$1 AND data->>'date'<=$2",[account.id,params.date])).rows[0];
    const opening=cents(Number(totals.opening)),incoming=cents(Number(totals.incoming)),outgoing=cents(Number(totals.outgoing)),counted=cents(params.countedBalance);
    if(counted<0)throw fail(422,'invalid_counted_balance');
    const data={account_id:account.id,date:params.date,opening_balance:opening/100,total_in:incoming/100,total_out:outgoing/100,balance:(opening+incoming-outgoing)/100,counted_balance:counted/100,difference:(counted-opening-incoming+outgoing)/100,status:'closed'};
    return[create('DailyFinancialClose',`${operationId}_close`,data),create('FechamentoCaixa',`${operationId}_cash`,data)];
  }
  await openDate(client,account.id,params.date);
  let signed,source,sourceEntity,changes=[],kind;
  if(command==='cashMovement') {
    if(params.confirmation!=='CONFIRMAR CAIXA'||!['entrada','saida','sangria'].includes(params.type)||!String(params.description||'').trim())throw fail(422,'invalid_cash_movement');
    const amount=cents(params.amount);if(amount<=0)throw fail(422,'invalid_money');
    signed=params.type==='entrada'?amount:-amount;kind=params.type;
    sourceEntity=params.type==='entrada'?'Revenue':params.type==='sangria'?'Sangria':'FinancialExpense';
    source={id:`${operationId}_source`};
    changes.push(create(sourceEntity,source.id,{account_id:account.id,date:params.date,description:params.description,amount:amount/100,paid_amount:amount/100,paid_date:params.date,status:'paid',cash_movement_id:`${operationId}_movement`}));
  } else if(command==='settle'||command==='reverseSettlement') {
    if(!['FinancialExpense','AccountsPayable','AccountsReceivable','Revenue'].includes(params.entity))throw fail(422,'invalid_settlement_entity');
    if(params.confirmation!==(command==='settle'?'CONFIRMAR LIQUIDACAO':'CONFIRMAR ESTORNO'))throw fail(422,'confirmation_required');
    sourceEntity=params.entity;source=await get(client,sourceEntity,params.recordId,params.expectedVersion);
    if(source.account_id&&source.account_id!==account.id)throw fail(409,'account_conflict');
    const amount=cents(source.amount);if(amount<=0)throw fail(422,'invalid_money');
    const outgoing=['FinancialExpense','AccountsPayable'].includes(sourceEntity);
    if(command==='settle') {
      if(source.status&&source.status!=='pending')throw fail(409,'already_settled_or_cancelled');
      signed=outgoing?-amount:amount;kind='liquidacao';
      changes.push(update(sourceEntity,source,{account_id:account.id,status:'paid',paid_amount:amount/100,paid_date:params.date,cash_movement_id:`${operationId}_movement`}));
      if(sourceEntity==='AccountsReceivable'&&['cartao','delivery'].includes(source.source_type)&&source.source_id){
        const relatedEntity=source.source_type==='cartao'?'CardReceivable':'DeliverySettlement';
        const related=expose((await client.query('SELECT * FROM ruy_finance.record WHERE entity=$1 AND id=$2 FOR UPDATE',[relatedEntity,source.source_id])).rows[0]);
        if(!related||related.accounts_receivable_id!==source.id)throw fail(409,'receivable_link_conflict');
        changes.push(update(relatedEntity,related,{status:'recebido',received_date:params.date,cash_movement_id:`${operationId}_movement`}));
      }
    } else {
      if(source.status!=='paid'||!source.cash_movement_id)throw fail(409,'not_reversible');
      signed=outgoing?amount:-amount;kind='estorno';
      changes.push(update(sourceEntity,source,{status:'cancelled',reversed_date:params.date,reversal_movement_id:`${operationId}_movement`}));
    }
  } else throw fail(422,'invalid_command');
  const balance=cents(account.balance||0)+signed;if(balance<0)throw fail(409,'insufficient_cash_balance');
  if(!Number.isSafeInteger(balance))throw fail(422,'invalid_money');
  changes.push(update('FinancialAccount',account,{balance:balance/100}));
  changes.push(create('CashMovement',`${operationId}_movement`,{account_id:account.id,date:params.date,amount:signed/100,type:kind,source_entity:sourceEntity,source_id:source.id,balance_before:account.balance||0,balance_after:balance/100,...(command==='reverseSettlement'?{reversal_of:source.cash_movement_id}:{})}));
  return changes;
}

export function guardFinanceWrite(change,before,data) {
  if(['CashMovement','DailyFinancialClose','FechamentoCaixa','Sangria'].includes(change.entity))throw fail(422,'business_command_required');
  if(change.entity==='FinancialAccount') {
    if(change.data.balance!==undefined)throw fail(422,'balance_is_server_managed');
    if(!before)data.balance=0;
    if(data.status==='cancelled'&&(data.balance||0)!==0)throw fail(409,'account_has_balance');
  }
  if(['FinancialExpense','AccountsPayable','AccountsReceivable','Revenue'].includes(change.entity)) {
    if(before?.status==='paid'||before?.cash_movement_id||change.data.paid_amount!==undefined||change.data.paid_date!==undefined||change.data.cash_movement_id!==undefined||change.data.reversal_movement_id!==undefined||!['pending','cancelled'].includes(data.status||'pending'))throw fail(422,'business_command_required');
    if(typeof data.amount!=='number'||data.amount<=0)throw fail(422,'invalid_money');
    if(data.date!==undefined)date(data.date);
    data.status||='pending';
  }
}
