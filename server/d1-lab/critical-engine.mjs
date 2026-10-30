// Motor PREPARATÓRIO, sem rotas HTTP e sem integração com estoque/financeiro real.
// Caller fornece identidade autenticada. Quantidades em milésimos; dinheiro em centavos.
import {transaction,fail,digest,uuid} from './core.mjs';
function namespace(schema){if(!/^critical_[a-f0-9]{16}$/.test(schema))throw Error('Schema sintético obrigatório.');return schema;}
export async function applyCritical(pool,schema,identity,command,hook=async()=>{}){
 const ns=namespace(schema);
 if(!['admin','writer'].includes(identity.role)||!uuid(identity.deviceId)||!uuid(identity.actorId))throw fail(403,'Identidade local sem concessão.');
 if(!uuid(command.operationId)||!['consume','production','journal'].includes(command.kind))throw fail(400,'Comando crítico inválido.');
 const payloadHash=digest(JSON.stringify({identity,command}));
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[schema]);
  const prior=(await c.query(`SELECT * FROM ${ns}.operations WHERE id=$1`,[command.operationId])).rows[0];
  if(prior){if(prior.hash!==payloadHash)throw fail(409,'ID com conteúdo divergente.');return {...prior.result,replay:true};}
  let result;
  if(command.kind==='journal'){
   if(!Array.isArray(command.entries)||command.entries.length<2||command.entries.length>50||command.entries.some(e=>!['cash','expense','inventory','production'].includes(e.account)||!Number.isSafeInteger(e.cents))||command.entries.reduce((s,e)=>s+BigInt(e.cents),0n)!==0n)throw fail(400,'Lançamento não balanceado em centavos.');
   for(const entry of command.entries)await c.query(`INSERT INTO ${ns}.journal(operation_id,account,cents) VALUES($1,$2,$3)`,[command.operationId,entry.account,entry.cents]);
   result={operationId:command.operationId,state:'pending-central',externalConfirmed:false};
  }else{
   if(!Number.isSafeInteger(command.quantityMilli)||command.quantityMilli<=0||!Number.isSafeInteger(command.baseVersion))throw fail(400,'Quantidade/versão inválida.');
   const item=(await c.query(`SELECT * FROM ${ns}.stock WHERE id=$1 FOR UPDATE`,[command.itemId])).rows[0];
   if(!item||Number(item.version)!==command.baseVersion)throw fail(409,'Conflito de versão.');
   const budget=(await c.query(`SELECT * FROM ${ns}.quotas WHERE device=$1 AND item=$2 FOR UPDATE`,[identity.deviceId,command.itemId])).rows[0];
   if(!budget||BigInt(budget.remaining)<BigInt(command.quantityMilli)||BigInt(item.balance)<BigInt(command.quantityMilli))throw fail(409,'Cota por dispositivo insuficiente; não confirmar saldo global offline.');
   await c.query(`UPDATE ${ns}.quotas SET remaining=remaining-$3 WHERE device=$1 AND item=$2`,[identity.deviceId,command.itemId,command.quantityMilli]);
   await c.query(`UPDATE ${ns}.stock SET balance=balance-$2,version=version+1 WHERE id=$1`,[command.itemId,command.quantityMilli]);
   await c.query(`INSERT INTO ${ns}.movements VALUES($1,$2,$3)`,[command.operationId,command.itemId,-command.quantityMilli]);
   if(command.kind==='production'){
    if(!Number.isSafeInteger(command.outputMilli)||command.outputMilli<=0||command.outputItemId===command.itemId)throw fail(400,'Produto de saída inválido.');
    const output=await c.query(`UPDATE ${ns}.stock SET balance=balance+$2,version=version+1 WHERE id=$1 RETURNING id`,[command.outputItemId,command.outputMilli]);
    if(!output.rowCount)throw fail(400,'Produto de saída inexistente.');
    await c.query(`INSERT INTO ${ns}.movements VALUES($1,$2,$3)`,[command.operationId,command.outputItemId,command.outputMilli]);
   }
   result={operationId:command.operationId,state:'pending-central',globalConfirmed:false};
  }
  await c.query(`INSERT INTO ${ns}.operations VALUES($1,$2,$3)`,[command.operationId,payloadHash,result]);
  await c.query(`INSERT INTO ${ns}.audit VALUES($1,$2,$3)`,[command.operationId,identity.actorId,command.kind]);
  await hook(c);return result;
 });
}
