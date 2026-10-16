import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {config,validateHome,home} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {domainCommand} from '../../server/d1-lab/domain.mjs';
import {backup,restoreIsolated} from '../../server/d1-lab/backup.mjs';
import {productionWitness} from './production-witness.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório: reinicia somente laboratório D1.');
const control=(...args)=>promisify(execFile)(process.execPath,[fileURLToPath(new URL('../d1-lab.mjs',import.meta.url)),...args],{windowsHide:true,timeout:30000});
const production=await productionWitness(),marker=await validateHome(),actor=randomUUID(),other=randomUUID(),password=randomBytes(24).toString('hex');
let pool=poolFor(await config()),session,checks=0,persistenceEvidence,backupEvidence;
const results=[],user={id:actor,role:'admin'},origin='http://127.0.0.1:18087';
const check=async(name,fn)=>{await fn();checks++;results.push(name);console.log('PASS '+name);};
const api=async(route,body,headers={})=>{
 const r=await fetch(origin+'/api/d1'+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session?.cookie||'','X-CSRF-Token':session?.csrf||'',...headers},body:body?JSON.stringify(body):undefined});
 return {status:r.status,body:await r.json()};
};
const command=(entity,data,id=randomUUID(),baseVersion=null)=>({operationId:randomUUID(),entity,id,baseVersion,action:'save',data});
const send=async body=>{const r=await api('/domain/command',body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const list=async entity=>(await api('/domain/'+entity)).body.records;
const state=async()=>({docs:(await pool.query('SELECT * FROM d2_catalog WHERE owner_id=$1 ORDER BY id',[actor])).rows,
 history:(await pool.query('SELECT * FROM d1_rh_history WHERE owner_id=$1 ORDER BY record_id,record_version',[actor])).rows,
 queue:(await pool.query('SELECT * FROM lab_outbox WHERE actor=$1 ORDER BY operation_id',[actor])).rows,
 audit:(await pool.query('SELECT * FROM lab_audit WHERE actor=$1 ORDER BY id',[actor])).rows});
try{
 for(const id of [actor,other])await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[id,id+'@example.invalid',await hashPassword(id===actor?password:randomBytes(24).toString('hex'))]);
 const login=await api('/login',{login:actor+'@example.invalid',password});
 assert.equal(login.status,200);
 // The login response cookie is obtained separately, never persisted or logged.
 const r=await fetch(origin+'/api/d1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:actor+'@example.invalid',password})});
 session={...(await r.json()),cookie:r.headers.get('set-cookie').split(';')[0]};
 const employee=randomUUID(),foreignEmployee=randomUUID();
 const createEmployee=async(id,owner)=>{
  const {catalogSave}=await import('../../server/d1-lab/catalog.mjs');
  await catalogSave(pool,{id:owner,role:'admin'},marker.deviceId,'Employee',id,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO RH '+id,status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
 };
 await createEmployee(employee,actor);await createEmployee(foreignEmployee,other);
 const vale={employee_id:employee,date:'2026-10-16',amount:30.25,type:'pix',motive:'FICTICIO transporte',payment_method:'pix',authorized_by:'FICTICIO gestor',status:'pendente',observation:'FICTICIO teste'};
 const consumption={employee_id:employee,date:'2026-10-16',time:'12:15',product:'FICTICIO lanche',quantity:2,amount:10.5,status:'registrado'};
 let v,c,p,expense;
 const vCommand=command('Vale',{...vale,employee_name:'nome adulterado',sector:'setor adulterado'});
 await check('criação/consulta offline usam PostgreSQL, nome autoritativo e IDs estáveis',async()=>{
  await assert.rejects(fetch('https://example.invalid'),e=>e.code==='ENETUNREACH'||e.code==='ENOTFOUND'||e.cause?.code==='ENOTFOUND');
  v=(await send(vCommand)).domainRecord;c=(await send(command('Consumption',consumption))).domainRecord;
  assert.equal(v.id,vCommand.id);assert.ok(v.employee_name.startsWith('FICTICIO RH '));assert.notEqual(v.employee_name,'nome adulterado');
  assert.equal((await list('Vale'))[0].amount,30.25);assert.equal(c.registered_by,actor);
  assert.equal((await pool.query('SELECT 1 FROM d1_stock_movements WHERE owner_id=$1',[actor])).rowCount,0);
  assert.equal((await list('FinancialExpense')).length,0);assert.equal((await list('EmployeePayment')).length,0);
 });
 await check('ACK perdido/replay e duplicidade semântica não repetem lançamentos',async()=>{
  const before=await state();assert.equal((await send(vCommand)).replay,true);assert.deepEqual(await state(),before);
  assert.equal((await api('/domain/command',command('Vale',vale))).status,409);
  assert.equal((await api('/domain/command',{...vCommand,data:{...vale,amount:31}})).status,409);
 });
 await check('validação recusa centavos inválidos, datas, quantidades, anexos e falso desconto',async()=>{
  const before=await state();
  for(const data of [{...vale,amount:0},{...vale,amount:1.001},{...vale,date:'2026-02-30'},{...vale,proof_url:'https://example.invalid/proof'},{...vale,status:'descontado'}])assert.ok((await api('/domain/command',command('Vale',data))).status>=400);
  for(const data of [{...consumption,quantity:0},{...consumption,quantity:-2},{...consumption,time:'99:00'},{...consumption,status:'cobrado'}])assert.ok((await api('/domain/command',command('Consumption',data))).status>=400);
  assert.deepEqual(await state(),before);
 });
 await check('edição CAS e histórico/auditoria por usuário e dispositivo são atômicos',async()=>{
  v=(await send(command('Vale',{amount:35.25},v.id,v._version))).domainRecord;
  assert.equal(v._version,2);assert.equal((await api('/domain/command',command('Vale',{amount:99},v.id,1))).status,409);
  const h=(await api('/domain/history/Vale/'+v.id)).body.records;
  assert.equal(h.length,2);assert.equal(h[0].snapshot.amount,30.25);assert.equal(h[1].snapshot.amount,35.25);
  assert.ok(h.every(row=>row.actor_id===actor&&row.device_id===marker.deviceId));
  const changed=await pool.query('SELECT 1 FROM lab_audit a JOIN lab_outbox o USING(operation_id) WHERE o.record_id=$1 AND a.actor=$2',[v.id,actor]);assert.equal(changed.rowCount,2);
  await assert.rejects(pool.query("UPDATE d1_rh_history SET action='adulterado' WHERE owner_id=$1",[actor]),e=>e.code==='42501');
  await assert.rejects(pool.query('DELETE FROM d1_rh_history WHERE owner_id=$1',[actor]),e=>e.code==='42501');
 });
 await check('API exige sessão/CSRF, papel autorizado e isolamento de colaboradores/histórico',async()=>{
  assert.equal((await api('/domain/Vale',null,{Cookie:''})).status,401);
  assert.equal((await api('/domain/command',command('Vale',vale),{'X-CSRF-Token':''})).status,403);
  assert.equal((await api('/domain/command',command('Vale',{...vale,employee_id:foreignEmployee}))).status,409);
  assert.equal((await api('/domain/command',command('Vale',{...vale,employee_id:foreignEmployee},v.id,v._version))).status,409);
  const isolated=await domainCommand(pool,{id:other,role:'admin'},marker.deviceId,command('Vale',{...vale,employee_id:foreignEmployee}));
  assert.equal((await api('/domain/history/Vale/'+isolated.domainRecord.id)).body.records.length,0);
  await pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actor]);
  assert.equal((await api('/domain/Vale')).status,403);assert.equal((await api('/domain/history/Vale/'+v.id)).status,403);assert.equal((await api('/domain/command',command('Vale',vale))).status,403);
  await pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actor]);
 });
 await check('falha após documento/fila/histórico reverte tudo e permite retry com mesmo UUID',async()=>{
  const body=command('Consumption',{...consumption,time:'13:15'}),before=await state();
  await assert.rejects(domainCommand(pool,user,marker.deviceId,body,async()=>{throw Error('FICTICIO falha antes do commit');}));
  assert.deepEqual(await state(),before);assert.equal((await send(body)).replay,false);assert.equal((await send(body)).replay,true);
 });
 await check('cancelamento mantém histórico e não movimenta caixa/estoque',async()=>{
  c=(await send({operationId:randomUUID(),entity:'Consumption',id:c.id,baseVersion:c._version,action:'cancel'})).domainRecord;
  assert.equal(c.status,'cancelado');assert.equal((await api('/domain/command',command('Consumption',{amount:5},c.id,c._version))).status,409);
  const disposable=(await send(command('Vale',{...vale,motive:'FICTICIO cancelamento'}))).domainRecord;
  assert.equal((await send(command('Vale',{status:'cancelado'},disposable.id,disposable._version))).domainRecord.status,'cancelado');
 });
 await check('desconto vincula folha/despesa existentes, preserva valores e impede dupla contabilização',async()=>{
  p=(await send(command('EmployeePayment',{employee_id:employee,payment_type:'salario',gross_amount:200,discount_amount:50,net_amount:150,payment_date:'2026-10-16',payment_method:'pix',status:'pago'}))).domainRecord;
  expense=(await list('FinancialExpense'))[0];
  const body=command('Vale',{status:'descontado',deduction_payment_id:p.id,deduction_payment_version:p._version},v.id,v._version),before=await state();
  await assert.rejects(domainCommand(pool,user,marker.deviceId,body,async()=>{throw Error('FICTICIO falha no agregado de desconto');}));
  assert.deepEqual(await state(),before);
  v=(await send(body)).domainRecord;assert.equal((await send(body)).replay,true);
  p=(await list('EmployeePayment'))[0];assert.equal(p._version,2);assert.equal(p.rh_deductions[0].amountCents,3525);
  assert.equal(p.net_amount,150);assert.equal(p.discount_amount,50);assert.deepEqual((await list('FinancialExpense'))[0],expense);
  assert.equal((await api('/domain/command',{operationId:randomUUID(),entity:'Vale',id:v.id,baseVersion:v._version,action:'cancel'})).status,409);
  assert.equal((await api('/domain/command',command('EmployeePayment',{...p,discount_amount:0,net_amount:200},p.id,p._version))).status,409);
  assert.equal((await api('/domain/command',command('FinancialExpense',{...expense,amount:99},expense.id,expense._version))).status,409);
 });
 await check('consumo descontado usa saldo do desconto, exige versão e rejeita excesso',async()=>{
  const row=(await send(command('Consumption',{...consumption,time:'14:15'}))).domainRecord;
  assert.equal((await api('/domain/command',command('Consumption',{status:'cobrado',deduction_payment_id:p.id,deduction_payment_version:1},row.id,row._version))).status,409);
  const deducted=(await send(command('Consumption',{status:'cobrado',deduction_payment_id:p.id,deduction_payment_version:p._version},row.id,row._version))).domainRecord;
  assert.equal(deducted.status,'cobrado');p=(await list('EmployeePayment'))[0];assert.equal(p.rh_deductions.length,2);
  const extra=(await send(command('Vale',{...vale,motive:'FICTICIO excesso',amount:10}))).domainRecord;
  const before=await state();assert.equal((await api('/domain/command',command('Vale',{status:'descontado',deduction_payment_id:p.id,deduction_payment_version:p._version},extra.id,extra._version))).status,409);assert.deepEqual(await state(),before);
  assert.equal((await api('/domain/command',command('EmployeePayment',{employee_id:employee,payment_type:'vale',gross_amount:10,discount_amount:0,net_amount:10,payment_date:'2026-10-16',status:'pago'}))).status,409);
 });
 await check('liberação de consumo dispensa cobrança e não confirma transferência',async()=>{
  const row=(await send(command('Consumption',{...consumption,time:'15:15'}))).domainRecord;
  const r=await send(command('Consumption',{status:'liberado'},row.id,row._version));
  assert.equal(r.domainRecord.status,'liberado');assert.equal(r.externalConfirmed,false);assert.equal((await list('FinancialExpense')).length,1);
 });
 await check('fila e histórico sobrevivem a reinício real de PostgreSQL/API',async()=>{
  const before=await state();await pool.end();pool=null;
  await control('stop-api');await control('stop-db');await control('start-db');await control('start-api');pool=poolFor(await config());
  assert.deepEqual(await state(),before);assert.equal((await list('Vale')).find(row=>row.id===v.id).status,'descontado');
  assert.equal((await pool.query('SELECT count(*)::int n FROM lab_outbox WHERE actor=$1',[actor])).rows[0].n,before.queue.length);
  const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  persistenceEvidence={database:'ruy_d1_disposable',beforeHash:hash(before),afterHash:hash(await state()),documents:before.docs.length,historyEntries:before.history.length,queuedOperations:before.queue.length,postgresAndApiRestarted:true};
 });
 await check('backup/restore isolado inclui histórico RH, documentos e fila',async()=>{
  const saved=await backup(),restored=await restoreIsolated(path.join(home,'backups',saved.file));
  assert.equal(restored.syncEnabled,false);assert.ok(restored.recoveryTablesVerified>=12);
  backupEvidence={database:restored.database,recoveryTablesVerified:restored.recoveryTablesVerified,syncEnabled:restored.syncEnabled,externalProtected:saved.externalProtected};
  assert.deepEqual(await productionWitness(),production);
 });
 await fs.writeFile(new URL('../../logs/etapa-f-rh-evidence.json',import.meta.url),JSON.stringify({checks,results,actor,production,syntheticOnly:true,operationalSyncEnabled:false,persistenceEvidence,backupEvidence},null,2));
 console.log('RH_OFFLINE_OK '+checks);
}finally{if(pool)await pool.end();}
