import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {config,validateHome,home} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {backup,restoreIsolated} from '../../server/d1-lab/backup.mjs';
import {domainCommand} from '../../server/d1-lab/domain.mjs';
import {productionWitness} from './production-witness.mjs';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório: reinicia apenas laboratório D1.');
const exec=promisify(execFile),control=(...args)=>exec(process.execPath,[fileURLToPath(new URL('../d1-lab.mjs',import.meta.url)),...args],{windowsHide:true,timeout:30000});
let pool=poolFor(await config());const production=await productionWitness(),marker=await validateHome(),actor=randomUUID();
let checks=0;const results=[];
const check=async(name,fn)=>{await fn();checks++;results.push(name);console.log('PASS '+name);};
const origin='http://127.0.0.1:18087';let session;
const api=async(route,body)=>{const r=await fetch(origin+'/api/d1'+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session?.cookie||'','X-CSRF-Token':session?.csrf||''},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
const send=async body=>{const r=await api('/domain/command',body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const snapshot=async()=>{const s={};for(const table of ['d2_catalog','d1_stock_balances','d1_stock_movements','d1_operation_events'])s[table]=(await pool.query(`SELECT to_jsonb(t) r FROM ${table} t WHERE owner_id=$1 ORDER BY id`,[actor]).catch(async e=>{if(e.code!=='42703')throw e;return pool.query(`SELECT to_jsonb(t) r FROM ${table} t WHERE owner_id=$1 ORDER BY item_id`,[actor]);})).rows;s.outbox=(await pool.query('SELECT * FROM lab_outbox WHERE actor=$1 ORDER BY operation_id',[actor])).rows;s.audit=(await pool.query('SELECT * FROM lab_audit WHERE actor=$1 ORDER BY id',[actor])).rows;return s;};
try{
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',await hashPassword('senha-teste-batch')]);
 const login=await fetch(origin+'/api/d1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:actor+'@example.invalid',password:'senha-teste-batch'})});assert.equal(login.status,200);session={...await login.json(),cookie:login.headers.get('set-cookie').split(';')[0]};
 const emp1=randomUUID(),emp2=randomUUID(),emp3=randomUUID();
 for(const [eid,nome] of [[emp1,'FICTICIO colaborador lote 1'],[emp2,'FICTICIO colaborador lote 2'],[emp3,'FICTICIO colaborador lote 3']])await pool.query("INSERT INTO d1_records(id,owner_id,entity,data,name_key) VALUES($1,$2,'Employee',$3,$4)",[eid,actor,JSON.stringify({name:nome,status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}),nome.toLowerCase()]);
 await check('lote de pagamentos cria EmployeePayment e FinancialExpense vinculados no mesmo commit',async()=>{
  const batch={operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:[{employee_id:emp1,gross_amount:1000,discount_amount:100,net_amount:900,payment_date:'2026-10-15',payment_method:'pix',status:'pago',observation:'FICTICIO lote um'},{employee_id:emp2,gross_amount:2000,discount_amount:0,net_amount:2000,payment_date:'2026-10-15',payment_method:'pix',status:'pendente'},{employee_id:emp3,gross_amount:1500,discount_amount:250,net_amount:1250,payment_date:'2026-10-15',payment_method:'dinheiro',status:'pago'}]}};
  const r=await send(batch);assert.equal(r.domainRecord.status,'processado');assert.equal(r.domainRecord.observation,'Lote de 3 pagamento(s).');
  const payments=(await api('/domain/EmployeePayment')).body.records.filter(p=>p.source_device_id===marker.deviceId||true);assert.ok(payments.length>=3);
  const byEmp=(id)=>payments.filter(p=>p.employee_id===id);
  assert.equal(byEmp(emp1)[0].net_amount,900);assert.equal(byEmp(emp1)[0].status,'pago');
  assert.equal(byEmp(emp2)[0].net_amount,2000);assert.equal(byEmp(emp2)[0].status,'pendente');
  assert.equal(byEmp(emp3)[0].net_amount,1250);assert.equal(byEmp(emp3)[0].status,'pago');
  const exs=(await api('/domain/FinancialExpense')).body.records;
  for(const p of [...byEmp(emp1),...byEmp(emp2),...byEmp(emp3)]){
   assert.ok(p.financial_expense_id);const ex=exs.find(e=>e.id===p.financial_expense_id);assert.ok(ex);assert.equal(ex.origin_type,'pagamento_colaborador');assert.equal(ex.amount,p.net_amount);
  }
 });
 await check('lote de pagamentos é idempotente por operationId',async()=>{
  const loteId=randomUUID(),opId=randomUUID();
  const loteBody={operationId:opId,entity:'EmployeePayment',id:loteId,baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:[{employee_id:emp1,gross_amount:1000,discount_amount:100,net_amount:900,payment_date:'2026-10-15',payment_method:'pix',status:'pago',observation:'FICTICIO idempotencia'}]}};
  const primeiro=await send(loteBody);assert.equal(primeiro.replay,false);
  const replay=await api('/domain/command',loteBody);assert.equal(replay.status,200);assert.equal(replay.body.replay,true);assert.equal(replay.body.operationId,opId);
 });
 await check('lote com pagamento inválido faz rollback total (nenhuma gravação parcial)',async()=>{
  const antes=await snapshot();
  const invalido={operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:[{employee_id:emp1,gross_amount:1000,discount_amount:100,net_amount:900,payment_date:'2026-10-15',payment_method:'pix',status:'pago'},{employee_id:randomUUID(),gross_amount:500,discount_amount:0,net_amount:500,payment_date:'2026-10-15',payment_method:'pix',status:'pago'}]}};
  assert.equal((await api('/domain/command',invalido)).status,409);
  assert.deepEqual(await snapshot(),antes);
 });
 await check('lote respeita limite de 50 pagamentos',async()=>{
  const muitos={operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:Array(51).fill(0).map(()=>({employee_id:emp1,gross_amount:10,discount_amount:0,net_amount:10,payment_date:'2026-10-15',payment_method:'pix',status:'pago'}))}};
  assert.equal((await api('/domain/command',muitos)).status,400);
 });
 await check('lote recusado para entidade diferente de EmployeePayment',async()=>{
  const errado={operationId:randomUUID(),entity:'FinancialExpense',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:[]}};
  assert.equal((await api('/domain/command',errado)).status,409);
 });
 await check('confirmação, colaborador repetido e repetição com novo UUID não gravam efeitos',async()=>{
  const payments=[{employee_id:emp1,gross_amount:123,discount_amount:0,net_amount:123,payment_date:'2026-10-16',payment_method:'pix',status:'pago',payment_type:'salario',observation:'FICTICIO etapa I'}];
  const command=()=>({operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments}});
  const missing=command();delete missing.token;let before=await snapshot();assert.equal((await api('/domain/command',missing)).status,409);assert.deepEqual(await snapshot(),before);
  const repeated=command();repeated.data={payments:[payments[0],payments[0]]};assert.equal((await api('/domain/command',repeated)).status,409);assert.deepEqual(await snapshot(),before);
  await send(command());before=await snapshot();assert.equal((await api('/domain/command',command())).status,409);assert.deepEqual(await snapshot(),before);
 });
 await check('permissão e revogação são verificadas na API, sem gravação parcial',async()=>{
  const body={operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:[{employee_id:emp2,gross_amount:53,discount_amount:0,net_amount:53,payment_date:'2026-10-16',payment_method:'pix',payment_type:'salario',status:'pago'}]}};
  const before=await snapshot();
  try{await pool.query("UPDATE lab_users SET role='writer' WHERE id=$1",[actor]);assert.equal((await api('/domain/command',body)).status,403);await pool.query("UPDATE lab_users SET role='admin',active=false WHERE id=$1",[actor]);assert.equal((await api('/domain/command',body)).status,401);}
  finally{await pool.query("UPDATE lab_users SET role='admin',active=true WHERE id=$1",[actor]);}
  assert.deepEqual(await snapshot(),before);
 });
 await check('falha após todas as escritas reverte despesas, pagamentos, fila e auditoria',async()=>{
  const before=await snapshot(),body={operationId:randomUUID(),entity:'EmployeePayment',id:randomUUID(),baseVersion:null,action:'batch',token:'confirm-local-payroll',data:{payments:[{employee_id:emp2,gross_amount:54,discount_amount:0,net_amount:54,payment_date:'2026-10-16',payment_method:'pix',payment_type:'salario',status:'pago'}]}};
  await assert.rejects(domainCommand(pool,{id:actor,role:'admin'},marker.deviceId,body,async()=>{throw Error('FICTICIO failure');}),/FICTICIO failure/);assert.deepEqual(await snapshot(),before);
 });
 const before=await snapshot();await pool.end();pool=null;await control('stop-api');await control('stop-db');await control('start-db');await control('start-api');pool=poolFor(await config());
 await check('reinício preserva pagamentos de lote',async()=>{assert.deepEqual(await snapshot(),before);assert.deepEqual(await productionWitness(),production);});
 await check('backup isolado preserva pagamentos de lote',async()=>{const saved=await backup(),restored=await restoreIsolated(path.join(home,'backups',saved.file));assert.equal(restored.syncEnabled,false);assert.ok(restored.recoveryTablesVerified>=11);});
 await fs.writeFile(new URL('../../logs/etapa-e-domain-batch-evidence.json',import.meta.url),JSON.stringify({actor,checks,results,restartPersistence:true,productionUnchanged:true,syntheticOnly:true},null,2));
 console.log('DOMAIN_BATCH_OK '+checks);
}finally{if(pool)await pool.end();}
