import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {createFixture} from './rc-fixture.mjs';
import {hashPassword} from '../../server/d1-lab/core.mjs';
import {createServer} from '../../server/d1-lab/api.mjs';
import {domainCommand} from '../../server/d1-lab/domain.mjs';
import {operationalCommand} from '../../server/d1-lab/operations.mjs';
export async function runStage5Rh(){
 const fixture=await createFixture(),results=[],check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
 const A=await fixture.database('local',['schema','entities','catalog','sync','operations','domain','attachments','business'].map(n=>'d1-lab/'+n+'.sql'));
 assert.equal(A.config.port,55437);
 const actor=randomUUID(),device=randomUUID(),password=randomBytes(32).toString('hex'),user={id:actor,role:'admin'},employee=randomUUID(),deleted=randomUUID();
 let server,cookie,csrf;
 const start=async()=>{server=createServer(A.pool,device);await new Promise((r,j)=>{server.once('error',j);server.listen(18091,'127.0.0.1',r);});};
 const stop=async()=>{if(server?.listening)await new Promise(r=>server.close(r));};
 const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:18091/api/d1'+route,{method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:18091',Cookie:cookie||'','X-CSRF-Token':csrf||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});return {status:r.status,value:await r.json(),headers:r.headers};};
 const send=async(route,body)=>{const r=await api(route,body);assert.equal(r.status,200,JSON.stringify(r.value));return r.value;};
 const cmd=(entity,data,id=randomUUID(),baseVersion=null,action='save')=>({operationId:randomUUID(),entity,id,baseVersion,action,data});
 const tables=['d1_records','d2_catalog','d1_rh_history','lab_audit','lab_outbox','d1_financial_entries','d1_financial_accounts','d1_operation_events'];
 const snapshot=async pool=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await pool.query(`SELECT to_jsonb(t) r FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows])));
 try{
  await A.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);
  await A.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',await hashPassword(password)]);
  await start();
  await check('01 actual login and unauthenticated rejection',async()=>{assert.equal((await api('/me')).status,401);const r=await api('/login',{login:actor+'@example.invalid',password});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=r.value.csrf;});
  let record;
  const create=id=>({operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO I5 '+id,status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
  await check('02 employee create query edit and stale CAS refusal',async()=>{record=(await send('/catalog/Employee/'+employee,create(employee))).record;record=(await send('/catalog/Employee/'+employee,{operationId:randomUUID(),operation:'update',baseVersion:record._version,data:{name:'FICTICIO I5 editado'}})).record;assert.equal((await api('/catalog/Employee')).value.records[0].name,'FICTICIO I5 editado');assert.equal((await api('/catalog/Employee/'+employee,{operationId:randomUUID(),operation:'update',baseVersion:1,data:{name:'FICTICIO stale'}})).status,409);});
  await check('03 authorized employee deletion is audited tombstone with idempotency',async()=>{const r=(await send('/catalog/Employee/'+deleted,create(deleted))).record;const body={operationId:randomUUID(),operation:'delete',baseVersion:r._version,confirmation:'EXCLUIR'};await A.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actor]);assert.equal((await api('/catalog/Employee/'+deleted,body)).status,403);await A.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actor]);assert.equal((await send('/catalog/Employee/'+deleted,body)).tombstone,true);assert.equal((await send('/catalog/Employee/'+deleted,body)).replay,true);assert.equal((await A.pool.query("SELECT count(*)::int n FROM lab_audit WHERE operation_id=$1",[body.operationId])).rows[0].n,1);});
  let vale,consumption,payment;
  const valeData={employee_id:employee,date:'2026-10-19',amount:30,type:'pix',motive:'FICTICIO I5 transporte',status:'pendente'};
  await check('04 RH vale replay duplicate detection and authoritative employee',async()=>{const body=cmd('Vale',valeData);vale=(await send('/domain/command',body)).domainRecord;assert.equal(vale.employee_name,record.name);assert.equal((await send('/domain/command',body)).replay,true);assert.equal((await api('/domain/command',cmd('Vale',valeData))).status,409);});
  await check('05 RH consumption cancellation and history persist',async()=>{consumption=(await send('/domain/command',cmd('Consumption',{employee_id:employee,date:'2026-10-19',time:'12:00',product:'FICTICIO lanche I5',quantity:2,amount:10,status:'registrado'}))).domainRecord;consumption=(await send('/domain/command',cmd('Consumption',{},consumption.id,consumption._version,'cancel'))).domainRecord;assert.equal(consumption.status,'cancelado');assert.equal((await api('/domain/history/Consumption/'+consumption.id)).value.records.length,2);});
  await check('06 funded payroll payment and RH discount link are audited once',async()=>{await operationalCommand(A.pool,user,device,{operationId:randomUUID(),kind:'journal',entries:[{account:'cash',cents:100000,baseVersion:0},{account:'equity',cents:-100000,baseVersion:0}]});const body=cmd('EmployeePayment',{employee_id:employee,payment_type:'salario',gross_amount:200,discount_amount:50,net_amount:150,payment_date:'2026-10-19',payment_method:'dinheiro',status:'pago'});payment=(await send('/domain/command',body)).domainRecord;assert.equal((await send('/domain/command',body)).replay,true);vale=(await send('/domain/command',cmd('Vale',{status:'descontado',deduction_payment_id:payment.id,deduction_payment_version:payment._version},vale.id,vale._version))).domainRecord;assert.equal(vale.status,'descontado');});
  await check('07 linked RH discount reversal remains safely blocked without homologated contract',async()=>{const before=await snapshot(A.pool);assert.equal((await api('/domain/command',cmd('EmployeePayment',{},payment.id,payment._version,'cancel'))).status,409);assert.equal((await api('/domain/command',cmd('Vale',{},vale.id,vale._version,'cancel'))).status,409);assert.deepEqual(await snapshot(A.pool),before);});
  await check('08 intermediate RH fault rolls back document history audit and outbox',async()=>{const before=await snapshot(A.pool);await assert.rejects(domainCommand(A.pool,user,device,cmd('Vale',{...valeData,motive:'FICTICIO rollback'}),()=>{throw Error('I5 synthetic fault');}),/synthetic fault/);assert.deepEqual(await snapshot(A.pool),before);});
  await check('09 API close reopen retains session RH financial data and tombstone',async()=>{const before=await snapshot(A.pool);await stop();await start();assert.equal((await api('/me')).status,200);assert.deepEqual(await snapshot(A.pool),before);assert.equal((await api('/catalog/Employee')).value.records.some(r=>r.id===deleted),false);});
  await check('10 encrypted backup restores RH history payroll ledger and employee deletion',async()=>{const restored=await fixture.roundTrip(A);assert.deepEqual(await snapshot(restored.pool),await snapshot(A.pool));});
  const report={checks:results.length,results,databasePorts:fixture.databases.map(d=>d.port),actualHttpAndPostgresql:true,networkDisconnected:false,linkedRhReversalImplemented:false,linkedRhReversalSafelyBlocked:true,operationalSyncEnabled:false};
  await fs.writeFile('logs/etapa5/rh.json',JSON.stringify(report,null,2));return report;
 }finally{await stop();await fixture.close();}
}
