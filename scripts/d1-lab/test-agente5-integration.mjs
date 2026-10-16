import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
import {config,validateHome} from '../../server/d1-lab/environment.mjs';
import {config as centralConfig} from '../../server/sync-lab/environment.mjs';
import {poolFor,hashPassword,digest} from '../../server/d1-lab/core.mjs';
import {catalogSave,catalogList} from '../../server/d1-lab/catalog.mjs';
import {deleteEmployee,employeeDeleteCheck} from '../../server/d1-lab/employee-delete.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {domainCommand} from '../../server/d1-lab/domain.mjs';
import {createLocalServer} from '../../lab/c2-runtime/server/local/api.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic opt-in required');
const port=Number(process.env.RUY_INTEGRATION_API_PORT||18092);
if(![18080,18092].includes(port))throw Error('Invalid integration port');
const origin='http://127.0.0.1:'+port;
const marker=await validateHome(),localConfig=await config(),ownerConfig=await config(true);
const A=poolFor(localConfig),central=new pg.Pool({...((await centralConfig('central')).db),connectionTimeoutMillis:3000});
const peer='ruy_d1_peer_'+randomBytes(8).toString('hex'),owner=new pg.Client(ownerConfig);await owner.connect();
await owner.query('CREATE DATABASE '+peer);await owner.end();
const setup=new pg.Client({...ownerConfig,database:peer});await setup.connect();
const windows=process.env.RUY_WINDOWS_UI_EVIDENCE==='1'?JSON.parse(await fs.readFile('logs/agente5-employee-ui-20261016.json','utf8')):null;
if(windows&&(!windows.packaged||!windows.employee?.authorizedTombstone||!windows.employee?.created||!windows.employee?.edited))throw Error('Windows evidence incomplete');
const actorA=windows?.syntheticActor||randomUUID(),actorB=randomUUID(),deviceB=randomUUID(),workspace=randomUUID();
try{
 for(const name of ['schema.sql','entities.sql','catalog.sql','sync.sql','operations.sql','domain.sql'])await setup.query(await fs.readFile(new URL('../../server/d1-lab/'+name,import.meta.url),'utf8'));
 await setup.query('INSERT INTO lab_device VALUES(true,$1)',[deviceB]);
 await setup.query('GRANT CONNECT ON DATABASE '+peer+' TO ruy_d1_app');
 await setup.query('GRANT USAGE ON SCHEMA public TO ruy_d1_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO ruy_d1_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ruy_d1_app; REVOKE UPDATE ON lab_outbox,lab_audit FROM ruy_d1_app');
}finally{await setup.end();}
const B=new pg.Pool({...localConfig,database:peer});
const userA={id:actorA,role:'admin'},userB={id:actorB,role:'admin'},viewer=randomUUID();
const tokenA=randomBytes(32).toString('hex'),tokenB=randomBytes(32).toString('hex');
const provision=new pg.Client(await centralConfig('central',true));await provision.connect();
for(const [pool,actor,device,token] of [[A,actorA,marker.deviceId,tokenA],[B,actorB,deviceB,tokenB]]){
 if(!(windows&&actor===actorA))await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',await hashPassword(randomBytes(24).toString('hex'))]);
 await pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actor,device,workspace]);
 await provision.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),device,actor,workspace]);
}
await provision.end();
await A.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'viewer')",[viewer,viewer+'@example.invalid',await hashPassword(randomBytes(24).toString('hex'))]);
let api;let checks=0;
async function start(){api=createLocalServer({query:sql=>{assert.equal(sql,'SELECT 1');return central.query(sql);}},{origin,d1BridgeOrigin:'http://127.0.0.1:18090'});await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(port,'127.0.0.1',resolve);});}
async function stop(){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
const request=async(token,route,body)=>{
 const response=await fetch(origin+'/api/local/d1'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok)throw Object.assign(Error('Gateway refused'),{status:response.status});return result;
};
const syncA=()=>synchronizeD1(A,actorA,{token:tokenA,request}),syncB=()=>synchronizeD1(B,actorB,{token:tokenB,request});
const create=async(id)=>catalogSave(A,userA,marker.deviceId,'Employee',id,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO Integration '+id,status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
try{
 await start();
 await check('gateway health and invalid token denied',async()=>{assert.equal((await fetch(origin+'/api/local/health')).status,200);await assert.rejects(request('0'.repeat(64),'/changes?cursor=0'),{status:403});});
 const id=randomUUID();await create(id);await syncA();await syncB();
 await check('D1 → gateway API → C2 → PostgreSQL → peer',async()=>{assert.equal((await catalogList(B,userB,'Employee')).find(r=>r.id===id)._version,1);});
 if(windows)await check('actual packaged Windows create/edit/delete persists through gateway and peer',async()=>{
  const remote=(await central.query('SELECT * FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,windows.employee.id])).rows[0];
  assert.equal(remote.version,'3');assert.equal(remote.data._deleted,'true');
  assert.equal((await B.query('SELECT data FROM d1_records WHERE id=$1',[windows.employee.id])).rows[0].data._deleted,'true');
  assert.equal((await A.query("SELECT count(*)::int n FROM lab_outbox o JOIN d1_sync_queue q USING(operation_id) WHERE o.record_id=$1 AND q.state='acknowledged'",[windows.employee.id])).rows[0].n,3);
 });
 const remove={operationId:randomUUID(),operation:'delete',baseVersion:1,confirmation:'EXCLUIR'};
 await check('server denies viewer, missing confirmation and stale CAS',async()=>{
  await assert.rejects(deleteEmployee(A,{id:viewer,role:'admin'},marker.deviceId,id,remove),{status:403});
  await assert.rejects(deleteEmployee(A,userA,marker.deviceId,id,{...remove,confirmation:''}),{status:400});
  await assert.rejects(deleteEmployee(A,userA,marker.deviceId,id,{...remove,baseVersion:2}),{status:409});
 });
 await check('atomic rollback leaves record, queue and audit unchanged',async()=>{
  await assert.rejects(deleteEmployee(A,userA,marker.deviceId,id,remove,()=>{throw Error('synthetic interruption');}));
  assert.equal((await A.query('SELECT version FROM d1_records WHERE id=$1',[id])).rows[0].version,'1');
  assert.equal((await A.query('SELECT 1 FROM lab_outbox WHERE operation_id=$1',[remove.operationId])).rowCount,0);
  assert.equal((await A.query('SELECT 1 FROM lab_audit WHERE operation_id=$1',[remove.operationId])).rowCount,0);
 });
 await check('authorized tombstone replay, altered UUID and resurrection denied',async()=>{
  assert.equal((await employeeDeleteCheck(A,userA,id)).blocked,false);
  assert.equal((await deleteEmployee(A,userA,marker.deviceId,id,remove)).tombstone,true);
  assert.equal((await deleteEmployee(A,userA,marker.deviceId,id,remove)).replay,true);
  await assert.rejects(deleteEmployee(A,userA,marker.deviceId,id,{...remove,baseVersion:2}),{status:409});
  await assert.rejects(create(id),{status:409});
  assert.equal((await A.query('SELECT 1 FROM lab_audit WHERE operation_id=$1',[remove.operationId])).rowCount,1);
 });
 await check('tombstone synchronizes and disappears from peer queries',async()=>{
  await syncA();await syncB();assert.ok(!(await catalogList(B,userB,'Employee')).some(r=>r.id===id));
  assert.equal((await B.query('SELECT data FROM d1_records WHERE id=$1',[id])).rows[0].data._deleted,'true');
 });
 await check('API restart preserves receipt and tombstone',async()=>{await stop();await start();await syncA();await syncB();assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_receipts WHERE operation_id=$1',[remove.operationId])).rows[0].n,1);});
 const vale=employee=>({operationId:randomUUID(),entity:'Vale',id:randomUUID(),baseVersion:null,action:'save',data:{employee_id:employee,date:'2026-01-01',amount:10,type:'dinheiro',motive:'FICTICIO Test dependency',status:'pendente'}});
 await check('late local reference to tombstoned employee is denied',async()=>{await assert.rejects(domainCommand(A,userA,marker.deviceId,vale(id)),{status:409});});
 const lost=randomUUID();await create(lost);let lose=true;
 await check('lost gateway response after commit recovers same UUID without duplicate',async()=>{
  const result=await synchronizeD1(A,actorA,{token:tokenA,request:async(...args)=>{const value=await request(...args);if(lose&&args[1]==='/push'){lose=false;throw Error('Lost gateway reply');}return value;}});
  assert.ok(result.pending>0);await syncA();
  assert.equal((await central.query('SELECT version FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,lost])).rows[0].version,'1');
 });
 const remoteLinked=randomUUID();await create(remoteLinked);await syncA();await syncB();
 await domainCommand(B,userB,deviceB,vale(remoteLinked));await syncB();
 await deleteEmployee(A,userA,marker.deviceId,remoteLinked,{...remove,operationId:randomUUID()});
 await check('offline deletion conflicts with remote dependency and preserves both proposals',async()=>{
  const result=await syncA();assert.ok(result.conflicts>0);
  assert.notEqual((await central.query('SELECT data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,remoteLinked])).rows[0].data._deleted,'true');
  assert.equal((await A.query('SELECT data FROM d1_records WHERE id=$1',[remoteLinked])).rows[0].data._deleted,'true');
 });
 const linked=randomUUID();await create(linked);
 await A.query("INSERT INTO d2_catalog(id,owner_id,entity,data,name_key) VALUES($1,$2,'Vale',$3,$4)",[randomUUID(),actorA,{name:'FICTICIO Dependency',status:'registrado',payload_json:JSON.stringify({employee_id:linked})},randomUUID()]);
 await check('local dependency blocks deletion inside transaction',async()=>{assert.equal((await employeeDeleteCheck(A,userA,linked)).blocked,true);await assert.rejects(deleteEmployee(A,userA,marker.deviceId,linked,{...remove,operationId:randomUUID()}),{status:409});});
 const report={checks,apiPort:port,dbPort:localConfig.port,restartFixture:marker.restartFixture??null,peerDatabase:peer,actorA,actorB,workspace,windowsSource:windows?{id:windows.employee.id,packaged:true}:null,physicalComputers:false,operationalSyncEnabled:false};
 await fs.writeFile('logs/agente5-integration-'+port+'-'+peer+'.json',JSON.stringify(report,null,2),{flag:'wx'});
 await fs.writeFile('logs/agente5-integration-'+port+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(api?.listening)await stop();await A.end();await B.end();await central.end();}
