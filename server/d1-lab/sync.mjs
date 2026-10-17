import {projectBusiness,businessConfirmation} from './business-projection.mjs';
import {transaction,fail,uuid} from './core.mjs';
import {unseal} from './environment.mjs';
import {canonical,syncHash,dataOf,syncTable,validateEnvelope} from './sync-contract.mjs';
import {sectorKey} from '../../src/lib/sectorUtils.js';
import {rhHistoryInsert} from './rh-domain.mjs';
import {employeeDependencies,referencesEmployee} from './employee-delete.mjs';
import {provisionedRequest} from './tls-provision.mjs';
export const centralOrigin=process.env.RUY_D1_BRIDGE_TEST_ORIGIN||'http://127.0.0.1:18086';
if(!['http://127.0.0.1:18086','http://127.0.0.1:18080','http://127.0.0.1:18089'].includes(centralOrigin)||centralOrigin!=='http://127.0.0.1:18086'&&process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic bridge opt-in required.');
const locked=(pool,actor,fn)=>transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor]);return fn(c);});
export async function syncReady(pool){return !!(await pool.query("SELECT to_regclass('public.d1_sync_binding') AS name")).rows[0].name;}
export async function syncStatus(pool,actor){
 const ready=await syncReady(pool);
 const binding=ready?(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[actor])).rows[0]:null;
 const counts=ready?(await pool.query(`SELECT count(*) FILTER(WHERE coalesce(q.state,'pending')='pending')::int pending,
 count(*) FILTER(WHERE q.state='sending')::int sending,count(*) FILTER(WHERE q.state='conflict')::int conflicts,
 count(*) FILTER(WHERE q.state='rejected')::int rejected,count(*) FILTER(WHERE q.state='acknowledged' AND q.receipt IS NULL)::int missing
 FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id) WHERE o.actor=$1`,[actor])).rows[0]:{pending:(await pool.query('SELECT count(*)::int n FROM lab_outbox WHERE actor=$1',[actor])).rows[0].n,sending:0,conflicts:0,rejected:0,missing:0};
 const shadows=ready?(await pool.query('SELECT count(*)::int n FROM d1_sync_shadow WHERE actor=$1',[actor])).rows[0].n:0;
 const eventsReady=(await pool.query("SELECT to_regclass('public.d1_operation_events') AS name")).rows[0].name;
 const pendingEvents=eventsReady?(await pool.query("SELECT count(*)::int n FROM d1_operation_events WHERE owner_id=$1 AND data->>'status'='pending-central'",[actor])).rows[0].n:0;
 const catalogReady=(await pool.query("SELECT to_regclass('public.d2_catalog') AS name")).rows[0].name;
 const pendingDocuments=catalogReady?(await pool.query("SELECT count(*)::int n FROM d2_catalog WHERE owner_id=$1 AND entity IN ('FinancialExpense','EmployeePayment','Revenue','AccountsPayable','AccountsReceivable') AND data->>'status' IN ('pago','recebido')",[actor])).rows[0].n:0;
 const filesReady=(await pool.query("SELECT to_regclass('public.d1_attachment_queue') AS name")).rows[0].name;
 const pendingFiles=filesReady?(await pool.query("SELECT count(*)::int n FROM d1_attachment_queue WHERE actor=$1 AND state<>'acknowledged'",[actor])).rows[0].n:null;
 const businessConfirmed=await businessConfirmation(pool,actor);
 const pendingBusiness=businessConfirmed?0:pendingEvents+pendingDocuments;
 return {businessConfirmed,enabled:!!binding,mode:'central-test-only',operationalSyncEnabled:false,...counts,conflicts:counts.conflicts+shadows,
 pendingBusiness,lastSyncAt:binding?.last_sync_at??null,lastError:binding?.last_error??null,cursor:binding?Number(binding.cursor):null,
 receiptsVerified:!!binding&&counts.missing===0,pullComplete:binding?.pull_complete===true,
 pendingFiles,attachmentsState:filesReady?'lab-transfer-only':'not-implemented'};
}
async function remote(token,route,body){
 const r=await fetch(centralOrigin+(centralOrigin.endsWith(':18086')?'/d1':'/api/local/d1')+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?canonical(body):undefined});
 const value=await r.json();if(!r.ok)throw Object.assign(Error('Central D1 recusou operação.'),{status:r.status});return value;
}
async function credentials(binding){
 const value=await unseal('sync-'+binding.actor+'.dpapi');
 if(value.purpose!=='D1_C2_TEST_ONLY'||value.actorId!==binding.actor||value.deviceId!==binding.device_id||value.workspaceId!==binding.workspace_id||!/^[a-f0-9]{64}$/.test(value.token))throw fail(403,'Credencial não pertence à ponte sintética.');
 return value.token;
}
async function claim(pool,binding){
 return locked(pool,binding.actor,async c=>{
  const op=(await c.query(`SELECT o.*,q.envelope FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id)
   WHERE o.actor=$1 AND (q.state IS NULL OR q.state='pending' OR(q.state='sending' AND q.lease_until<now()))
   ORDER BY (SELECT min(a.id) FROM lab_audit a WHERE a.operation_id=o.operation_id),o.operation_id LIMIT 1`,[binding.actor])).rows[0];
  if(!op)return null;
  let envelope=op.envelope;
  if(!envelope){
   const snapshots=[{entity:op.entity,record:op.result.record},...(op.result.cascata||[])];const changes=[];
   for(const item of snapshots){
    const localBase=item.record.id===op.record_id?op.base_version:Number(item.record._version)===1?null:Number(item.record._version)-1;
    const version=(await c.query('SELECT * FROM d1_sync_versions WHERE actor=$1 AND record_id=$2',[binding.actor,item.record.id])).rows[0];
    if(localBase!==null&&(!version||Number(version.local_version)!==Number(localBase)))throw fail(409,'Operação anterior precisa ser reconciliada.');
    if(localBase===null&&version)throw fail(409,'Criação já tem versão remota.');
    changes.push({entity:item.entity,id:item.record.id,baseVersion:version?Number(version.remote_version):null,data:dataOf(item.record)});
   }
   envelope={protocol:'D1LAB/1',operationId:op.operation_id,deviceId:binding.device_id,actorId:binding.actor,workspaceId:binding.workspace_id,changes};
   validateEnvelope(envelope);
  }
  await c.query("INSERT INTO d1_sync_queue(operation_id,state,envelope,lease_until) VALUES($1,'sending',$2,now()+interval '10 seconds') ON CONFLICT(operation_id) DO UPDATE SET state='sending',envelope=coalesce(d1_sync_queue.envelope,excluded.envelope),lease_until=excluded.lease_until,error=NULL",[op.operation_id,envelope]);
  return {...op,envelope};
 });
}
function verifyReceipt(envelope,r){
 if(r?.business&&(r.business.mode!=='authoritative-lab'||r.business.confirmed!==true))throw Error('Recibo de negocio invalido.');
 if(r?.protocol!=='D1LAB/1'||r.operationId!==envelope.operationId||r.deviceId!==envelope.deviceId||r.actorId!==envelope.actorId||r.workspaceId!==envelope.workspaceId||r.payloadHash!==syncHash(envelope)||!Number.isSafeInteger(r.cursor)||r.cursor<1||!Number.isFinite(Date.parse(r.confirmedAt))||!Array.isArray(r.changes)||r.changes.length!==envelope.changes.length)throw Error('Recibo inválido.');
 const expected=new Map(envelope.changes.map(c=>[c.id,c])),seen=new Set();
 for(const c of r.changes){const item=expected.get(c.id);if(!item||seen.has(c.id)||c.entity!==item.entity||c.version!==(item.baseVersion??0)+1||c.dataHash!==syncHash(item.data))throw Error('Recibo de registro inválido.');seen.add(c.id);}
}
async function acknowledge(pool,binding,op,receipt){
 verifyReceipt(op.envelope,receipt);
 return locked(pool,binding.actor,async c=>{
  const snapshots=new Map([op.result.record,...(op.result.cascata||[]).map(i=>i.record)].map(r=>[r.id,r]));
  for(const item of receipt.changes)await c.query(`INSERT INTO d1_sync_versions VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor,record_id) DO UPDATE SET remote_version=excluded.remote_version,local_version=excluded.local_version WHERE d1_sync_versions.remote_version<=excluded.remote_version`,[binding.actor,item.id,item.entity,item.version,snapshots.get(item.id)._version]);
  await c.query("UPDATE d1_sync_queue SET state='acknowledged',receipt=$2,confirmed_at=$3,error=NULL,lease_until=NULL WHERE operation_id=$1",[op.operation_id,receipt,receipt.confirmedAt]);
 });
}
async function receive(pool,binding,page){
 const cursor=Number((await pool.query('SELECT cursor FROM d1_sync_binding WHERE actor=$1',[binding.actor])).rows[0].cursor);
 if(page?.protocol!=='D1LAB/1'||!Array.isArray(page.events)||page.events.length>100||!Number.isSafeInteger(page.cursor)||page.cursor<cursor||!Number.isSafeInteger(page.head)||page.head<page.cursor||typeof page.hasMore!=='boolean'||(page.hasMore&&page.cursor===cursor))throw Error('Página/cursor inválido.');
 let previous=cursor;
 for(const event of page.events){
  if(!Number.isSafeInteger(event.cursor)||event.cursor<=previous||event.cursor>page.cursor||event.workspace_id!==binding.workspace_id||!uuid(event.operation_id)||!uuid(event.actor_id))throw Error('Evento remoto inválido.');
  previous=event.cursor;
  validateEnvelope({protocol:'D1LAB/1',operationId:event.operation_id,deviceId:event.device_id,actorId:binding.actor,workspaceId:binding.workspace_id,changes:event.changes.map(r=>({...r,baseVersion:r.version===1?null:r.version-1}))});
 }
 await locked(pool,binding.actor,async c=>{
  for(const event of page.events){
   const inserted=await c.query('INSERT INTO d1_sync_inbox(actor,cursor,operation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING cursor',[binding.actor,event.cursor,event.operation_id]);
   if(!inserted.rowCount)continue;
   // Um evento de cascata é aplicado integralmente na mesma transação.
   const dirty=[];
   const deletedEmployees=(await c.query("SELECT id FROM d1_records WHERE owner_id=$1 AND entity='Employee' AND data->>'_deleted'='true'",[binding.actor])).rows;
   for(const change of event.changes){
    const v=(await c.query('SELECT remote_version FROM d1_sync_versions WHERE actor=$1 AND record_id=$2',[binding.actor,change.id])).rows[0];
    if(v&&Number(v.remote_version)>=change.version)continue;
    const pending=await c.query(`SELECT 1 FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id) WHERE o.actor=$1 AND coalesce(q.state,'pending')<>'acknowledged' AND(o.record_id=$2 OR coalesce(o.result->'cascata','[]'::jsonb) @> $3::jsonb) LIMIT 1`,[binding.actor,change.id,JSON.stringify([{record:{id:change.id}}])]);
    if(pending.rowCount)dirty.push(change.id);
    if(change.entity==='Employee'&&change.data._deleted==='true'&&(await employeeDependencies(c,binding.actor,change.id)).blocked)dirty.push(change.id);
    if(deletedEmployees.some(employee=>employee.id!==change.id&&referencesEmployee(change.data,employee.id)))dirty.push(change.id);
   }
   if(dirty.length){
    for(const change of event.changes)await c.query('INSERT INTO d1_sync_shadow VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor,record_id) DO UPDATE SET remote_version=excluded.remote_version,data=excluded.data WHERE d1_sync_shadow.remote_version<excluded.remote_version',[binding.actor,change.id,change.entity,change.version,change.data]);
    continue;
   }
   for(const change of event.changes){
    const v=(await c.query('SELECT remote_version FROM d1_sync_versions WHERE actor=$1 AND record_id=$2',[binding.actor,change.id])).rows[0];
    if(v&&Number(v.remote_version)>=change.version)continue;
    const table=syncTable(change.entity),row=(await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[change.id])).rows[0];
    if(row&&(row.owner_id!==binding.actor||row.entity!==change.entity))throw fail(403,'Colisão de escopo local.');
    if(row?.data._deleted==='true'&&change.data._deleted!=='true')throw fail(409,'Ressurreição de identidade recusada.');
    const localVersion=row?Number(row.version)+1:1,nameKey=change.entity==='SystemSettings'?'singleton':sectorKey(change.data.name);
    if(row)await c.query(`UPDATE ${table} SET data=$2,name_key=$3,version=$4,updated_at=now() WHERE id=$1`,[change.id,change.data,nameKey,localVersion]);
    else await c.query(`INSERT INTO ${table}(id,owner_id,entity,data,name_key,version) VALUES($1,$2,$3,$4,$5,$6)`,[change.id,binding.actor,change.entity,change.data,nameKey,localVersion]);
    await c.query('INSERT INTO d1_sync_versions VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor,record_id) DO UPDATE SET remote_version=excluded.remote_version,local_version=excluded.local_version',[binding.actor,change.id,change.entity,change.version,localVersion]);
    await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[binding.actor,change.entity+':remote_apply',event.operation_id]);
    await rhHistoryInsert(c,{owner:binding.actor,id:change.id,entity:change.entity,operation:event.operation_id,actor:event.actor_id,device:event.device_id,version:localVersion,action:'remote_apply',snapshot:JSON.parse(change.data.payload_json||'null')});
   }
  }
  await projectBusiness(c,binding,page);
  await c.query('UPDATE d1_sync_binding SET cursor=$2 WHERE actor=$1',[binding.actor,page.cursor]);
 });
}
export async function synchronizeD1(pool,actor,options={}){
 if(!uuid(actor)||!await syncReady(pool))throw fail(403,'Ponte D1 não preparada.');
 const user=(await pool.query('SELECT role FROM lab_users WHERE id=$1 AND active',[actor])).rows[0];
 if(user?.role!=='admin')throw fail(403,'Somente administrador sintético na ponte de testes.');
 const binding=(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[actor])).rows[0];
 if(!binding)throw fail(403,'Usuário não provisionado na central de testes.');
 const device=(await pool.query('SELECT id FROM lab_device WHERE singleton')).rows[0];
 if(device?.id!==binding.device_id)throw fail(403,'Dispositivo da ponte divergiu.');
 const tls=process.env.RUY_D1_MTLS_LAB==='1'&&process.env.RUY_D1_ALLOW_TESTS==='1'&&!options.request?await provisionedRequest(binding):null;
 const token=options.token??tls?.token??await credentials(binding),send=options.request??tls?.request??remote;
 const lock=await pool.connect();let acquired=false;
 try{
  acquired=(await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS ok',['d1-sync:'+actor])).rows[0].ok;
  if(!acquired)return syncStatus(pool,actor);
  await pool.query('UPDATE d1_sync_binding SET pull_complete=false,last_error=NULL WHERE actor=$1',[actor]);
  for(let batch=0;batch<1000;batch++){
   const active=(await pool.query("SELECT 1 FROM lab_users WHERE id=$1 AND active AND role='admin'",[actor])).rowCount;
   if(!active)throw fail(403,'Permissão local revogada.');
   const op=await claim(pool,binding);if(!op)break;
   try{
    const receipt=await send(token,'/push',op.envelope);verifyReceipt(op.envelope,receipt);
    if(process.env.RUY_D1_ALLOW_TESTS==='1'&&process.env.RUY_D1_SYNC_TEST_FAULT==='crash-after-receipt')process.exit(77);
    await acknowledge(pool,binding,op,receipt);
   }catch(e){
    const state=e.status===409?'conflict':[400,403,413].includes(e.status)?'rejected':'pending';
    await pool.query('UPDATE d1_sync_queue SET state=$2,error=$3,lease_until=NULL WHERE operation_id=$1',[op.operation_id,state,state==='pending'?'Recibo não confirmado; reenviar o mesmo UUID.':'Requer revisão; proposta local preservada.']);
    if(state==='pending')throw e;
    break;
   }
  }
  for(let pageNumber=0;pageNumber<1000;pageNumber++){
   const cursor=Number((await pool.query('SELECT cursor FROM d1_sync_binding WHERE actor=$1',[actor])).rows[0].cursor);
   const page=await send(token,'/changes?cursor='+cursor);await receive(pool,binding,page);
   if(!page.hasMore){await locked(pool,actor,async c=>{
    const status=await syncStatus(c,actor);
    await c.query('UPDATE d1_sync_binding SET pull_complete=true,last_error=NULL,last_sync_at=CASE WHEN $2 THEN now() ELSE last_sync_at END WHERE actor=$1',[actor,status.pending===0&&status.sending===0&&status.conflicts===0&&status.rejected===0]);
   });break;}
  }
 }catch(e){await pool.query('UPDATE d1_sync_binding SET last_error=$2 WHERE actor=$1',[actor,e.status===403?'Permissão de sincronização recusada.':e.status===409?'Conflito D1 preservado para revisão.':'Central de testes indisponível ou resposta inválida.']);}
 finally{if(acquired)await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['d1-sync:'+actor]);lock.release();}
 return syncStatus(pool,actor);
}
