// Two independent PostgreSQL clients, one central database, real mTLS.
// No operational database, installation, firewall or company network is changed.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {randomBytes,randomUUID,X509Certificate} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {config,installation,home} from '../../server/d1-lab/environment.mjs';
import {pg,digest} from '../../server/d1-lab/core.mjs';
import {createIdentity,identityPassword} from '../../server/d1-lab/identity.mjs';
import {catalogSave as save} from '../../server/d1-lab/catalog.mjs';
import {domainCommand,domainList} from '../../server/d1-lab/domain.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
import {createSyncSupervisor} from '../../server/d1-lab/sync-supervisor.mjs';
import {createSharedLabServer} from '../../server/sync-lab/shared-server.mjs';
import {createLabTransport,sendLabTLS} from '../../server/sync-lab/mtls-transport.mjs';
import {attachmentHash} from '../../server/d1-lab/attachment-contract.mjs';
import {proveSharedBackup} from './shared-backup-proof.mjs';
import {acceptD1} from '../../server/sync-lab/d1-central.mjs';
import {sharedSessions} from '../../server/sync-lab/shared-sessions.mjs';
import {reconciliationPlan,reconcile} from '../../server/d1-lab/reconciliation.mjs';
assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_SHARED_LAB,'1');
await ensureLocalDatabase();const owner=await config(true),control=new pg.Client(owner);await control.connect();
const root=path.join(home,'shared-test-'+randomBytes(8).toString('hex'));await fs.mkdir(root);const pools=[],supervisors=[];let server,tls,passed=0;
const schema=async(names)=>{const database='ruy_d1_rc_'+randomBytes(8).toString('hex');await control.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');const pool=new pg.Pool({...owner,database});pools.push(pool);for(const name of names){const base=name.startsWith('central:')?'../../server/sync-lab/':'../../server/d1-lab/';await pool.query(await fs.readFile(new URL(base+name.replace('central:','')+'.sql',import.meta.url),'utf8'));}return pool;};
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const waitFor=async fn=>{for(let n=0;n<160;n++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('SHARED_CONVERGENCE_TIMEOUT');};
try{
 const central=await schema(['schema','identity','central:d1-central','central:attachments','central:business','central:shared']);
 const A=await schema(['schema','entities','catalog','sync','operations','domain','business']),B=await schema(['schema','entities','catalog','sync','operations','domain','business']);
 const workspace=randomUUID(),actors=[randomUUID(),randomUUID(),randomUUID(),randomUUID()],devices=[randomUUID(),randomUUID()],deviceTokens=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')],password=randomBytes(24).toString('hex'),hash=await identityPassword(password);
 for(let i=0;i<actors.length;i++){
  await central.query('INSERT INTO lab_users VALUES($1,$2,$3,$4,true)',[actors[i],`shared-${i}@example.invalid`,hash,i===2?'viewer':'admin']);
  await central.query('INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by) VALUES($1,$2,now(),$3,$1)',[actors[i],'FICTICIO Conta '+i,i===3?null:new Date()]);
  await central.query('INSERT INTO shared_memberships VALUES($1,$2,$3,true)',[actors[i],workspace,i===2?'viewer':'admin']);
 }
 for(const [i,pool] of [A,B].entries()){
  await central.query('INSERT INTO shared_devices VALUES($1,$2,$3,true)',[devices[i],workspace,digest(deviceTokens[i])]);
  await pool.query('INSERT INTO lab_device(id) VALUES($1)',[devices[i]]);await pool.query("INSERT INTO lab_users VALUES($1,$2,$3,'admin',true)",[actors[i],`local-${i}@example.invalid`,hash]);
  await pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actors[i],devices[i],workspace]);
 }
 const identity=createIdentity({pool:central,pepper:randomBytes(32),sender:async()=>{throw Error('Real email forbidden in synthetic test');}});
 server=await createSharedLabServer({pool:central,identity});await new Promise((r,j)=>{server.once('error',j);server.listen(installation.gatewayPort,'127.0.0.1',r);});
 const exec=promisify(execFile),openssl='C:/Program Files/Git/usr/bin/openssl.exe';
 for(const name of ['server','A','B'])await exec(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(root,name+'.key'),'-out',path.join(root,name+'.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true});
 const read=name=>fs.readFile(path.join(root,name)),certs=await Promise.all(['A','B'].map(name=>read(name+'.crt'))),keys=await Promise.all(['A','B'].map(name=>read(name+'.key'))),serverCert=await read('server.crt');
 tls=createLabTransport({key:await read('server.key'),cert:serverCert,ca:Buffer.concat(certs),devices:certs.map((cert,i)=>({fingerprint:new X509Certificate(cert).fingerprint256,token:deviceTokens[i]})),upstream:'http://127.0.0.1:'+installation.gatewayPort,sharedSessionMode:true});await tls.listen(0);
 const endpoint='https://127.0.0.1:'+tls.server.address().port;let sessions=[],online=[true,true],loseReceipt=false;
 const raw=(i,route,body,extra={})=>sendLabTLS({url:endpoint+'/api/local/d1'+route,key:keys[i],cert:certs[i],ca:serverCert,token:deviceTokens[i],userSession:sessions[i]?.token,contract:'RUY-SHARED-LAB/1',method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,...extra});
 const send=i=>async(_token,route,body)=>{if(!online[i])throw Object.assign(Error('SIMULATED_DISCONNECTION'),{status:503});const response=await raw(i,route,body);if(response.status!==200)throw Object.assign(Error('SHARED_REQUEST_REFUSED'),{status:response.status});const data=JSON.parse(response.body);if(loseReceipt&&route==='/push'){loseReceipt=false;throw Object.assign(Error('SIMULATED_RESPONSE_LOSS'),{status:503});}return data;};
 await check('mTLS and individual central approval are both mandatory',async()=>{
  assert.equal((await raw(0,'/changes?cursor=0')).status,401);
  assert.equal((await raw(0,'/session/login',{email:'shared-3@example.invalid',password})).status,401);
  for(let i=0;i<2;i++){const response=await raw(i,'/session/login',{email:`shared-${i}@example.invalid`,password});assert.equal(response.status,200);sessions[i]=JSON.parse(response.body);assert.equal(sessions[i].userId,actors[i]);}
  assert.equal((await raw(0,'/capabilities',undefined,{token:deviceTokens[1]})).status,403);
  assert.equal((await raw(0,'/capabilities',undefined,{userSession:sessions[1].token})).status,401);
  assert.equal((await raw(0,'/capabilities',undefined,{contract:'UNKNOWN/1'})).status,409);
  await assert.rejects(raw(0,'/capabilities',undefined,{cert:undefined,key:undefined}));
  await assert.rejects(raw(0,'/capabilities',undefined,{ca:certs[0]}));
 });
 const cycle=i=>synchronizeD1(i===0?A:B,actors[i],{token:sessions[i].token,request:send(i)});
 for(let i=0;i<2;i++){const s=createSyncSupervisor({synchronize:()=>cycle(i),intervalMs:100,maxRetryMs:400});supervisors.push(s);s.start();}
 const employee=randomUUID(),command=data=>({operation:'create',baseVersion:null,operationId:randomUUID(),data});
 const data={name:'FICTICIO Colaborador compartilhado',status:'ativo',hire_type:'outros',admission_date:'2026-10-26',cpf:'FICTICIO PRIVADO'};
 await check('A creates, B receives automatically, B edits and A converges',async()=>{
  await save(A,{id:actors[0],role:'admin'},devices[0],'Employee',employee,command(data));supervisors[0].wake();
  await waitFor(async()=>!!(await B.query('SELECT 1 FROM d1_records WHERE id=$1',[employee])).rowCount);
  const record=(await B.query('SELECT * FROM d1_records WHERE id=$1',[employee])).rows[0];await save(B,{id:actors[1],role:'admin'},devices[1],'Employee',employee,{operation:'update',baseVersion:Number(record.version),operationId:randomUUID(),data:{...record.data,name:'FICTICIO Colaborador editado B'}});supervisors[1].wake();
  await waitFor(async()=>(await A.query('SELECT data->>\'name\' name FROM d1_records WHERE id=$1',[employee])).rows[0]?.name==='FICTICIO Colaborador editado B');
 });
 await check('draft expense is shared without executing financial effects',async()=>{
  const expense=await domainCommand(A,{id:actors[0],role:'admin'},devices[0],{id:randomUUID(),baseVersion:null,operationId:randomUUID(),entity:'FinancialExpense',action:'save',data:{date:'2026-10-26',description:'FICTICIO Despesa pendente',classification:'despesa',amount:15.25,status:'pendente',origin_type:'manual'}});
  supervisors[0].wake();await waitFor(async()=>(await domainList(B,{id:actors[1],role:'admin'},'FinancialExpense')).some(e=>e.id===expense.domainRecord.id));assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_records WHERE entity=$1',['FinancialExpense'])).rows[0].n,1);
 });
 await check('offline durable proposal survives reconnect and lost response does not duplicate',async()=>{
  online[0]=false;const id=randomUUID();await save(A,{id:actors[0],role:'admin'},devices[0],'Employee',id,command({...data,name:'FICTICIO Offline'}));supervisors[0].wake();await waitFor(()=>supervisors[0].status().connection==='offline');
  assert.equal((await A.query('SELECT count(*)::int n FROM lab_outbox WHERE record_id=$1',[id])).rows[0].n,1);online[0]=true;loseReceipt=true;supervisors[0].wake();
  await waitFor(async()=>!!(await B.query('SELECT 1 FROM d1_records WHERE id=$1',[id])).rowCount);assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_records WHERE id=$1',[id])).rows[0].n,1);assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_changes WHERE changes @> $1::jsonb',[JSON.stringify([{id}])])).rows[0].n,1);
 });
 await check('simultaneous updates produce a preserved conflict, not lost updates',async()=>{
  for(const s of supervisors)await s.stop();const rows=await Promise.all([A,B].map(p=>p.query('SELECT * FROM d1_records WHERE id=$1',[employee])));
  for(let i=0;i<2;i++)await save(i===0?A:B,{id:actors[i],role:'admin'},devices[i],'Employee',employee,{operation:'update',operationId:randomUUID(),baseVersion:Number(rows[i].rows[0].version),data:{...rows[i].rows[0].data,name:'FICTICIO Concorrente '+i}});
  await Promise.all([cycle(0),cycle(1)]);assert.equal(Number((await central.query('SELECT version FROM d1_central_records WHERE id=$1',[employee])).rows[0].version),3);
  const conflicts=await Promise.all([A,B].map(p=>p.query("SELECT count(*)::int n FROM d1_sync_queue WHERE state='conflict'")));assert.equal(conflicts.reduce((sum,r)=>sum+r.rows[0].n,0),1);
 });
 await check('conflict resolution requires fresh conference and preserves an immutable proposal archive',async()=>{
  const counts=await Promise.all([A,B].map(p=>p.query("SELECT count(*)::int n FROM d1_sync_queue WHERE state='conflict'"))),loser=counts.findIndex(r=>r.rows[0].n===1),pool=loser===0?A:B,user={id:actors[loser],role:'admin'},options={transport:{token:sessions[loser].token,request:send(loser)}};
  const plan=await reconciliationPlan(pool,user,options),body={operationId:randomUUID(),decision:'accept-central',planHash:plan.hash,reason:'FICTICIO Revisao explicita do conflito'};
  await assert.rejects(()=>reconcile(pool,user,{...body,operationId:randomUUID(),planHash:'0'.repeat(64)},options),e=>e.status===409);
  assert.equal((await reconcile(pool,user,body,options)).replay,false);assert.equal((await reconcile(pool,user,body,options)).replay,true);assert.equal((await pool.query('SELECT count(*)::int n FROM d1_reconciliation')).rows[0].n,1);
  assert.deepEqual((await A.query('SELECT data FROM d1_records WHERE id=$1',[employee])).rows[0].data,(await B.query('SELECT data FROM d1_records WHERE id=$1',[employee])).rows[0].data);
 });
 await check('attachments retain authorized ownership, hash and immutable replay',async()=>{
  const bytes=Buffer.from('FICTICIO comprovante sintetico'),id=randomUUID(),payload={id,operationId:randomUUID(),recordId:employee,entity:'Employee',recordVersion:3,filename:'FICTICIO-proof.txt',mediaType:'text/plain',sha256:attachmentHash(bytes),bytes:bytes.toString('base64')};
  const upload=()=>raw(0,'/attachments/'+id,payload,{method:'PUT'});assert.equal((await upload()).status,200);assert.equal((await upload()).status,200);const response=await raw(1,'/attachments/'+id);assert.equal(response.status,200);assert.equal(JSON.parse(response.body).sha256,payload.sha256);
 });
 await check('existing authoritative stock primitive serializes races and rolls back partial consumption',async()=>{
  const auth=sharedSessions(central,identity),workspaceId=workspace,item=randomUUID();
  const envelope=(i,changes,operationId=randomUUID())=>({protocol:'D1LAB/1',operationId,deviceId:devices[i],actorId:actors[i],workspaceId,changes});
  const apply=(i,body)=>acceptD1(central,sessions[i].token,body,{business:true,authorizeSession:c=>auth.authorize(deviceTokens[i],sessions[i].token,c,true)});
  await apply(0,envelope(0,[{entity:'InventoryItem',id:item,baseVersion:null,data:{name:'FICTICIO Insumo central',unit:'kg',status:'ativo',minimum_stock:0}}]));
  const operation=(i,command)=>envelope(i,[{entity:'OperationalEvent',id:command.operationId,baseVersion:null,data:{name:'FICTICIO Operacao '+command.operationId,kind:command.kind,status:'pending-central',source_device_id:devices[i],command_json:JSON.stringify(command),result_json:JSON.stringify({operationId:command.operationId,businessConfirmed:false,externalConfirmed:false})}}],command.operationId);
  await apply(0,operation(0,{operationId:randomUUID(),kind:'entry',itemId:item,baseVersion:0,quantityMilli:1000,unitCents:150}));
  const proposals=[0,1].map(i=>operation(i,{operationId:randomUUID(),kind:'exit',itemId:item,baseVersion:1,quantityMilli:700}));
  const race=await Promise.allSettled(proposals.map((body,i)=>apply(i,body)));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
  const winner=race.findIndex(r=>r.status==='fulfilled');assert.equal((await apply(winner,proposals[winner])).replay,true);
  const before=(await central.query('SELECT quantity::text,version::text FROM d1_business_stock WHERE item=$1',[item])).rows[0];assert.deepEqual(before,{quantity:'300',version:'2'});
  const failed=operation(0,{operationId:randomUUID(),kind:'consume',inputs:[{itemId:item,baseVersion:2,quantityMilli:200},{itemId:randomUUID(),baseVersion:0,quantityMilli:100}]});await assert.rejects(()=>apply(0,failed),e=>e.status===409);
  assert.deepEqual((await central.query('SELECT quantity::text,version::text FROM d1_business_stock WHERE item=$1',[item])).rows[0],before);assert.equal((await central.query('SELECT count(*)::int n FROM d1_business_movements WHERE item=$1',[item])).rows[0].n,2);assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_receipts WHERE operation_id=$1',[failed.operationId])).rows[0].n,0);
 });
 await check('existing central journal rejects duplicate obligations and insufficient funds atomically',async()=>{
  const auth=sharedSessions(central,identity),envelope=(i,changes,operationId=randomUUID())=>({protocol:'D1LAB/1',operationId,deviceId:devices[i],actorId:actors[i],workspaceId:workspace,changes});
  const apply=(i,body)=>acceptD1(central,sessions[i].token,body,{business:true,authorizeSession:c=>auth.authorize(deviceTokens[i],sessions[i].token,c,true)});
  const id=randomUUID(),input={operationId:id,kind:'journal',entries:[{account:'cash',baseVersion:0,cents:10000},{account:'equity',baseVersion:0,cents:-10000}]};
  await apply(0,envelope(0,[{entity:'OperationalEvent',id,baseVersion:null,data:{name:'FICTICIO Fundo '+id,kind:'journal',status:'pending-central',source_device_id:devices[0],command_json:JSON.stringify(input),result_json:JSON.stringify({operationId:id,businessConfirmed:false,externalConfirmed:false})}}],id));
  const expense=(i,invoice,amount)=>{const id=randomUUID();return envelope(i,[{entity:'FinancialExpense',id,baseVersion:null,data:{name:'FICTICIO Despesa '+id,status:'pago',payload_json:JSON.stringify({date:'2026-10-26',description:'FICTICIO Obrigacao central',status:'pago',amount,beneficiary_name:'FICTICIO Fornecedor central',document_number:invoice,payment_method:'dinheiro'})}}]);};
  const proposals=[expense(0,'FICTICIO INVOICE-1',20),expense(1,'FICTICIO INVOICE-1',20)],race=await Promise.allSettled(proposals.map((p,i)=>apply(i,p)));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
  const winner=race.findIndex(r=>r.status==='fulfilled');assert.equal((await apply(winner,proposals[winner])).replay,true);
  assert.equal((await central.query("SELECT balance::text FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance,'8000');
  const bad=expense(0,'FICTICIO INSUFFICIENT',90);await assert.rejects(()=>apply(0,bad),e=>e.status===409);assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_receipts WHERE operation_id=$1',[bad.operationId])).rows[0].n,0);
  assert.equal((await central.query('SELECT count(*)::int n FROM d1_business_entries')).rows[0].n,4);assert.equal((await central.query('SELECT sum(cents)::text total FROM d1_business_entries')).rows[0].total,'0');
  assert.equal((await central.query('SELECT actor_id FROM d1_central_receipts WHERE operation_id=$1',[proposals[winner].operationId])).rows[0].actor_id,actors[winner]);
 });
 await check('viewer receives only authorized projection and cannot write; revocation is immediate',async()=>{
  const response=await raw(1,'/session/login',{email:'shared-2@example.invalid',password});assert.equal(response.status,200);const viewer=JSON.parse(response.body);
  const read=await raw(1,'/changes?cursor=0',undefined,{userSession:viewer.token});assert.equal(read.status,200);assert.ok(!read.body.includes('FICTICIO PRIVADO'));assert.ok(!read.body.includes('FinancialExpense'));
  const denied=await raw(1,'/push',{protocol:'D1LAB/1',operationId:randomUUID(),deviceId:devices[1],actorId:actors[2],workspaceId:workspace,changes:[{entity:'Employee',id:randomUUID(),baseVersion:null,data}]},{userSession:viewer.token});assert.equal(denied.status,403);
  await central.query('UPDATE identity_accounts SET revoked_at=now() WHERE user_id=$1',[actors[1]]);assert.equal((await raw(1,'/changes?cursor=0')).status,401);
 });
 await check('critical snapshot effects are refused and original client rows persist after reconnect',async()=>{
  const response=await raw(0,'/push',{protocol:'D1LAB/1',operationId:randomUUID(),deviceId:devices[0],actorId:actors[0],workspaceId:workspace,changes:[{entity:'PayrollRun',id:randomUUID(),baseVersion:null,data:{}}]});assert.equal(response.status,403);
  const client=await A.connect();try{assert.equal((await client.query('SELECT count(*)::int n FROM d1_records')).rows[0].n,2);}finally{client.release();}
 });
 await check('central encrypted backup restores users, receipts, records and attachments in another database',async()=>{
  const proof=await proveSharedBackup(central,root);assert.ok(proof.tablesVerified>=10);await fs.writeFile(path.join(root,'backup-result.json'),JSON.stringify(proof),{flag:'wx'});
 });
 await check('both durable client queues and reconciliation archives restore independently',async()=>{
  for(const pool of [A,B]){const directory=path.join(home,'shared-test-'+randomBytes(8).toString('hex'));await fs.mkdir(directory);const proof=await proveSharedBackup(pool,directory);assert.ok(proof.tablesVerified>=15);}
 });
 await check('device revocation, session expiration and logout cannot be bypassed by a cached token',async()=>{
  await central.query('UPDATE shared_devices SET active=false WHERE device_id=$1',[devices[1]]);assert.equal((await raw(1,'/capabilities')).status,403);
  await central.query("UPDATE shared_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(sessions[0].token)]);assert.equal((await raw(0,'/capabilities')).status,401);
  const response=await raw(0,'/session/login',{email:'shared-0@example.invalid',password});assert.equal(response.status,200);sessions[0]=JSON.parse(response.body);
  assert.equal((await raw(0,'/session/logout',{})).status,200);assert.equal((await raw(0,'/capabilities')).status,401);
 });
 const proof={passed,failed:0,realPostgreSQL:true,realMutualTLS:true,independentClientDatabases:2,centralDatabase:1,automaticPolling:true,companyNetworkChanged:false,physicalMachines:false,operationalEnabled:false};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(proof,null,2),{flag:'wx'});console.log(JSON.stringify(proof));
}catch(error){console.error(JSON.stringify({passed,failed:1,code:error.code||error.status||error.message,frames:String(error.stack).split('\n').filter(line=>line.includes('test-shared-central.mjs')||line.includes('shared-server.mjs')||line.includes('mtls-transport.mjs')).slice(0,3)}));process.exitCode=1;}
finally{for(const s of supervisors)await s.stop();if(tls)await new Promise(r=>tls.server.close(r));if(server?.listening)await new Promise(r=>server.close(r));for(const pool of pools)await pool.end();await control.end();}
