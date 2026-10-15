import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {home,ports,config,marker} from '../../server/sync-lab/environment.mjs';
if(process.env.RUY_C2_ALLOW_TESTS!=='1')throw Error('Opt-in necessário: teste reinicia SOMENTE APIs/cluster C2.');
const exec=promisify(execFile),cli=fileURLToPath(new URL('../sync-lab.mjs',import.meta.url));
const control=async(...args)=>exec(process.execPath,[cli,...args],{windowsHide:true,timeout:30000});
const worker=async(mode,fault)=>exec(process.execPath,[fileURLToPath(new URL('../../server/sync-lab/worker.mjs',import.meta.url)),mode],{windowsHide:true,timeout:15000,env:{...process.env,...(fault?{RUY_C2_TEST_FAULT:fault}:{})}});
const configs={};for(const mode of Object.keys(ports))configs[mode]=await config(mode);
const owner=new pg.Client(await config('central',true));await owner.connect();
const production=await(await fetch('http://localhost:8080/__health')).json();
const c1Health=await(await fetch('http://127.0.0.1:18083/health')).json();
let checks=0;
const check=async(label,fn)=>{await fn();checks++;console.log('PASS '+label);};
async function call(mode,route,{body,token=configs[mode].localToken}={}){
 const r=await fetch(`http://127.0.0.1:${ports[mode]}${route}`,{method:body?'POST':'GET',headers:{Connection:'close',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
 return {status:r.status,body:await r.json()};
}
const read=async mode=>(await call(mode,'/records')).body;
const stat=async mode=>(await call(mode,'/status')).body;
const command=(code,name)=>({operationId:randomUUID(),recordId:randomUUID(),operation:'create',baseVersion:null,data:{code:'TEST-'+code,name:'FICTICIO '+name}});
const unique=randomUUID().slice(0,8).toUpperCase();
const A=command(unique+'-A','CRIADO A'),B=command(unique+'-B','CRIADO B');
async function unaffected(){
 assert.deepEqual(await(await fetch('http://localhost:8080/__health')).json(),production);
 assert.deepEqual(await(await fetch('http://127.0.0.1:18083/health')).json(),c1Health);
 assert.equal((await fetch('http://127.0.0.1:18083/lab/')).status,200);
}
try{
 for(const mode of ['central','A','B'])await control('start',mode);
 const baseline={central:await stat('central'),A:await stat('A'),B:await stat('B')};
 await check('produção 8080 e C1 preservadas antes dos testes',unaffected);
 await check('identidades e bancos diferentes, CONNECT entre pares negado',async()=>{
  assert.notEqual(configs.A.identity.deviceId,configs.B.identity.deviceId);assert.notEqual(configs.A.db.database,configs.B.db.database);
  assert.equal((await owner.query("SELECT has_database_privilege('ruy_c2_a_app','ruy_c2_b','CONNECT') AS allowed")).rows[0].allowed,false);
 });
 await check('APIs exigem autenticação e não aceitam credencial do outro PC',async()=>{
  assert.equal((await call('A','/records',{token:null})).status,401);
  assert.equal((await call('A','/records',{token:configs.B.localToken})).status,403);
 });
 await control('stop','central');
 await check('A cria offline sem servidor central',async()=>{
  assert.equal((await call('A','/records',{body:A})).status,200);
  assert.ok((await read('A')).records.some(r=>r.id===A.recordId));
 });
 await worker('A');
 await check('falha de conexão preserva operação pendente sem confirmação',async()=>{
  const op=(await call('A','/outbox')).body.operations.find(o=>o.operation_id===A.operationId);
  assert.equal(op.state,'pending');assert.equal(op.confirmed_at,null);assert.equal((await stat('A')).cloudState,'error');
 });
 await control('start','central');await worker('A');await worker('B');
 await check('A → central → B com conteúdo e versão preservados',async()=>{
  const r=(await read('B')).records.find(r=>r.id===A.recordId);assert.deepEqual(r.data,A.data);assert.equal(Number(r.remote_version),1);
  assert.equal((await stat('A')).acknowledged,baseline.A.acknowledged+1);
 });
 await check('estados reais sem check verde prematuro',async()=>{
  const s=await stat('A');assert.equal(s.pending,0);assert.equal(s.sending,0);assert.ok(s.lastSyncAt);
  assert.equal(s.cloudState,s.conflicts||s.rejected?'error':'confirmed');assert.equal(s.backupState,'not-validated');
 });
 await call('B','/records',{body:B});await worker('B');await worker('A');
 await check('B → central → A sem gerar outbox de recebimento',async()=>{
  assert.deepEqual((await read('A')).records.find(r=>r.id===B.recordId).data,B.data);
  assert.equal((await stat('B')).acknowledged,baseline.B.acknowledged+1);
  assert.equal((await stat('A')).acknowledged,baseline.A.acknowledged+1);
 });
 const edit=(base,name)=>({operationId:randomUUID(),recordId:A.recordId,operation:'update',baseVersion:base,data:{...A.data,name:'FICTICIO '+name}});
 const editA=edit(1,'EDITADO A'),editB=edit(1,'EDITADO B');
 await call('A','/records',{body:editA});await call('B','/records',{body:editB});await worker('A');await worker('B');
 await check('edições simultâneas geram conflito e preservam ambas as versões',async()=>{
  const b=await read('B'),op=(await call('B','/outbox')).body.operations.find(o=>o.operation_id===editB.operationId);
  assert.equal(op.state,'conflict');assert.equal(op.confirmed_at,null);
  assert.equal(b.records.find(r=>r.id===A.recordId).data.name,editB.data.name);
  assert.equal(b.shadows.find(r=>r.record_id===A.recordId).data.name,editA.data.name);
  assert.equal((await stat('B')).cloudState,'error');
 });
 const lost=command(unique+'-LOST','RESPOSTA PERDIDA');await call('A','/records',{body:lost});
 await writeFile(path.join(home,'drop-next-central-response.json'),'{}',{flag:'wx'});
 await worker('A');
 const countAfterLost=(await stat('central')).receipts;
 await check('perda da resposta após COMMIT mantém pendência local',async()=>{
  assert.equal((await call('A','/outbox')).body.operations.find(o=>o.operation_id===lost.operationId).state,'pending');
  assert.equal((await owner.query('SELECT 1 FROM receipts WHERE operation_id=$1',[lost.operationId])).rowCount,1);
 });
 await worker('A');
 await check('reenviar após perda de conexão confirma sem duplicar',async()=>{
  assert.equal((await stat('central')).receipts,countAfterLost);
  assert.equal((await call('A','/outbox')).body.operations.find(o=>o.operation_id===lost.operationId).state,'acknowledged');
 });
 const crash=command(unique+'-CRASH','REINICIO DURANTE SYNC');await call('A','/records',{body:crash});
 await assert.rejects(worker('A','crash-after-receipt'),e=>e.code===77);
 await check('crash real do worker deixa sending e recibo central persistido',async()=>{
  const op=(await call('A','/outbox')).body.operations.find(o=>o.operation_id===crash.operationId);assert.equal(op.state,'sending');assert.equal(op.confirmed_at,null);
  assert.equal((await owner.query('SELECT 1 FROM receipts WHERE operation_id=$1',[crash.operationId])).rowCount,1);
 });
 await control('stop','A');await control('start','A');await new Promise(r=>setTimeout(r,1100));await worker('A');
 await check('reinício e lease recuperam operação sem segundo efeito central',async()=>{
  const op=(await call('A','/outbox')).body.operations.find(o=>o.operation_id===crash.operationId);assert.equal(op.state,'acknowledged');assert.ok(op.confirmed_at);
  assert.equal((await owner.query('SELECT count(*)::int n FROM receipts WHERE operation_id=$1',[crash.operationId])).rows[0].n,1);
 });
 const wire={...lost,...configs.A.identity};
 await check('replay local/central é idempotente; payload diferente é rejeitado',async()=>{
  assert.equal((await call('A','/records',{body:lost})).body.replay,true);
  assert.equal((await call('central','/push',{token:configs.A.centralToken,body:wire})).body.duplicated,true);
  assert.equal((await call('central','/push',{token:configs.A.centralToken,body:{...wire,data:{...wire.data,name:'FICTICIO ALTERADO'}}})).status,409);
 });
 await check('device/autor do payload não substituem a identidade autenticada',async()=>{
  assert.equal((await call('central','/push',{token:configs.A.centralToken,body:{...wire,deviceId:configs.B.identity.deviceId}})).status,403);
 });
 const denied=command(unique+'-DENY','SEM PERMISSAO');
 await owner.query('UPDATE principals SET can_write=false WHERE device_id=$1',[configs.B.identity.deviceId]);
 await call('B','/records',{body:denied});await worker('B');
 await check('operação negada fica preservada e nunca confirmada',async()=>{
  const op=(await call('B','/outbox')).body.operations.find(o=>o.operation_id===denied.operationId);assert.equal(op.state,'rejected');assert.equal(op.confirmed_at,null);assert.deepEqual(op.payload.data,denied.data);
  assert.equal((await owner.query('SELECT 1 FROM records WHERE id=$1',[denied.recordId])).rowCount,0);
 });
 await owner.query('UPDATE principals SET can_write=true,can_read=false WHERE device_id=$1',[configs.B.identity.deviceId]);
 const cursorBefore=(await stat('B')).cursor;await worker('B');
 await check('recebimento sem permissão não avança cursor',async()=>assert.equal((await stat('B')).cursor,cursorBefore));
 await owner.query('UPDATE principals SET can_read=true WHERE device_id=$1',[configs.B.identity.deviceId]);await worker('B');
 const beforeRestart={A:await stat('A'),B:await stat('B'),central:await stat('central'),recordsA:await read('A'),recordsB:await read('B')};
 await owner.end();
 for(const mode of ['A','B','central'])await control('stop',mode);await control('stop-db');
 await check('C1 e produção seguem ativas enquanto todo C2 está parado',unaffected);
 await control('start-db');for(const mode of ['central','A','B'])await control('start',mode);
 await check('bancos/APIs reiniciados preservam fila, recibos, cursores e conflitos',async()=>{
  assert.deepEqual(await stat('A'),beforeRestart.A);assert.deepEqual(await stat('B'),beforeRestart.B);assert.deepEqual(await stat('central'),beforeRestart.central);
  assert.deepEqual(await read('A'),beforeRestart.recordsA);assert.deepEqual(await read('B'),beforeRestart.recordsB);
 });
 await check('IDs dos dispositivos sobrevivem a todos os reinícios',async()=>{
  assert.deepEqual((await marker()).identities.A,configs.A.identity);assert.deepEqual((await marker()).identities.B,configs.B.identity);
 });
 await check('produção final sem troca de release e C1 HTTP 200',unaffected);
 const result={checks,acceptedCentral:beforeRestart.central.receipts-baseline.central.receipts,
  recordsCentral:beforeRestart.central.records-baseline.central.records,
  A:{sent:beforeRestart.A.acknowledged-baseline.A.acknowledged,received:beforeRestart.A.received-baseline.A.received},
  B:{sent:beforeRestart.B.acknowledged-baseline.B.acknowledged,received:beforeRestart.B.received-baseline.B.received,conflicts:beforeRestart.B.conflicts-baseline.B.conflicts,rejected:beforeRestart.B.rejected-baseline.B.rejected}};
 await writeFile(path.join(home,'last-test.json'),JSON.stringify(result,null,2));
 console.log('C2_OK '+JSON.stringify(result));
}finally{await owner.end().catch(()=>{});}
