import {authorize,fail,transaction,mutateInClient,digest} from './core.mjs';
const entities=new Set(['Schedule','StandardSchedule','TimeRecord','Absence']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=body=>digest(JSON.stringify(canonical(body)));
export async function rhBatchStatus(pool,user,clientToken){
 authorize(user,'Schedule',true);
 if(!/^[a-f0-9-]{36}$/.test(clientToken||''))throw fail(400,'Identificador de operação inválido.');
 return transaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(708082)');
  const found=(await client.query("SELECT details FROM local_audit WHERE actor=$1 AND action='rh_batch' AND details->>'clientToken'=$2",[user.id,clientToken])).rows[0];
  return found?{committed:true,count:found.details.count,fingerprint:found.details.fingerprint}:{committed:false};
 });
}
export async function runRhBatch(pool,user,body){
 authorize(user,'Schedule',true);
 const {clientToken,confirmation,operations}=body||{};
 if(!/^[a-f0-9-]{36}$/.test(clientToken||'')||confirmation!=='CONFIRMAR RH'||!Array.isArray(operations)||!operations.length||operations.length>100)throw fail(400,'Confirmação, identificador e lote de até 100 operações obrigatórios.');
 if(new Set(operations.map(item=>`${item.entity}:${item.id}`)).size!==operations.length||new Set(operations.map(item=>item.operationId)).size!==operations.length)throw fail(400,'Operações duplicadas no lote.');
 const contentHash=fingerprint(body);
 return transaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(708082)');
  const previous=(await client.query("SELECT details FROM local_audit WHERE action='rh_batch' AND details->>'clientToken'=$1",[clientToken])).rows[0];
  if(previous){if(previous.details.actor!==user.id||previous.details.fingerprint!==contentHash)throw fail(409,'Identificador reutilizado com conteúdo diferente.');return{committed:true,replay:true,count:previous.details.count};}
  for(const item of operations){
   if(!entities.has(item.entity)||!['create','update'].includes(item.operation))throw fail(400,'Operação não permitida neste lote.');
   if((await client.query('SELECT 1 FROM local_pending WHERE operation_id=$1',[item.operationId])).rowCount)throw fail(409,'Operação individual já utilizada fora deste lote.');
   await mutateInClient(client,user,item.entity,item.id,item);
  }
  await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)',[user.id,'rh_batch',JSON.stringify({clientToken,fingerprint:contentHash,actor:user.id,count:operations.length,entities:[...new Set(operations.map(item=>item.entity))]})]);
  return{committed:true,replay:false,count:operations.length};
 });
}
