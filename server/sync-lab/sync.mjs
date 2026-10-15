import {transaction,status} from './protocol.mjs';
const centralOrigin='http://127.0.0.1:18086';
async function request(config,path,body){
 const r=await fetch(centralOrigin+path,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+config.centralToken,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
 const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error||'Falha central.'),{status:r.status,remote:value.remote});return value;
}
export async function synchronize(pool,config){
 const lock=await pool.connect();
 const locked=(await lock.query('SELECT pg_try_advisory_lock(1808402) AS acquired')).rows[0].acquired;
 if(!locked){lock.release();return status(pool);}
 try{
  while(true){
   const op=await transaction(pool,async c=>{
    const row=(await c.query("SELECT * FROM outbox WHERE state='pending' OR (state='sending' AND lease_until<now()) ORDER BY created_at,operation_id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if(row)await c.query("UPDATE outbox SET state='sending',lease_until=now()+interval '1 second',error=NULL WHERE operation_id=$1",[row.operation_id]);return row;
   });
   if(!op)break;
   try{
    const receipt=await request(config,'/push',op.payload);
    if(receipt.operationId!==op.operation_id||receipt.recordId!==op.record_id)throw Error('Recibo não corresponde à operação.');
    // Failpoint apenas no executável de testes, após COMMIT central, antes do ACK local.
    if(process.env.RUY_C2_TEST_FAULT==='crash-after-receipt')process.exit(77);
    await transaction(pool,async c=>{
     await c.query("UPDATE outbox SET state='acknowledged',receipt=$2,confirmed_at=$3,lease_until=NULL,error=NULL WHERE operation_id=$1",[op.operation_id,receipt,receipt.confirmedAt]);
     await c.query('UPDATE records SET remote_version=$2,dirty=false WHERE id=$1',[op.record_id,receipt.version]);
    });
   }catch(e){
    if([400,403,409].includes(e.status)){
     await pool.query('UPDATE outbox SET state=$2,lease_until=NULL,error=$3 WHERE operation_id=$1',[op.operation_id,e.status===409?'conflict':'rejected',{status:e.status,message:e.message,remote:e.remote??null}]);
     continue;
    }
    await pool.query("UPDATE outbox SET state='pending',lease_until=NULL,error=$2 WHERE operation_id=$1",[op.operation_id,{message:'Conexão central não confirmada; reenviar mesmo ID.'}]);
    throw e;
   }
  }
  while(true){
   const cursor=Number((await pool.query('SELECT cursor FROM sync_state WHERE singleton')).rows[0].cursor);
   const page=await request(config,'/changes?cursor='+cursor);
   await transaction(pool,async c=>{
    for(const change of page.changes){
     const inserted=await c.query('INSERT INTO inbox(cursor,operation_id,source_device,record_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING cursor',[change.cursor,change.operation_id,change.device_id,change.record_id]);
     if(!inserted.rowCount)continue;
     const row=(await c.query('SELECT * FROM records WHERE id=$1 FOR UPDATE',[change.record_id])).rows[0];
     if(row?.dirty){
      await c.query('INSERT INTO shadow VALUES($1,$2,$3) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version,data=excluded.data WHERE shadow.version<excluded.version',[change.record_id,change.version,change.data]);
     }else if(!row)await c.query('INSERT INTO records VALUES($1,$2,1,$3,false)',[change.record_id,change.data,change.version]);
     else if(Number(row.remote_version)<Number(change.version))await c.query('UPDATE records SET data=$2,remote_version=$3,local_version=local_version+1 WHERE id=$1',[change.record_id,change.data,change.version]);
    }
    await c.query('UPDATE sync_state SET cursor=$1 WHERE singleton',[page.cursor]);
   });
   if(!page.hasMore)break;
  }
  await pool.query("UPDATE sync_state SET last_error=NULL,last_sync_at=CASE WHEN NOT EXISTS(SELECT 1 FROM outbox WHERE state<>'acknowledged') THEN now() ELSE last_sync_at END WHERE singleton");
 }catch(e){await pool.query('UPDATE sync_state SET last_error=$1 WHERE singleton',[e.status===403?'Permissão central recusada.':'Sem confirmação da central.']);}
 finally{await lock.query('SELECT pg_advisory_unlock(1808402)');lock.release();}
 return status(pool);
}
