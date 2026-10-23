import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';import {spawn} from 'node:child_process';
import pg from 'pg';
import {installation,config,home,powershell} from '../../server/d1-lab/environment.mjs';
import {domainCommand,domainList} from '../../server/d1-lab/domain.mjs';
import {createIdentity,identityPassword} from '../../server/d1-lab/identity.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
if(installation?.id!=='final-dev-20261021'||process.env.RUY_ATTENDANCE_ACCEPTANCE!=='1')throw Error('NEW_SYNTHETIC_ATTENDANCE_TEST_REQUIRED');
const base=await config(true),database='ruy_d1_rc_'+randomBytes(8).toString('hex'),ctl=new pg.Client(base);await ctl.connect();try{await ctl.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await ctl.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');}finally{await ctl.end();}
const pool=new pg.Pool({...base,database});let passed=0;const actor={id:randomUUID(),role:'admin'},device=randomUUID(),employee=randomUUID();
const command=(entity,data,id=randomUUID(),baseVersion=null)=>({operationId:randomUUID(),entity,id,baseVersion,action:'save',data});
const send=body=>domainCommand(pool,actor,device,body);
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
let server;
try{
 for(const name of ['schema','entities','catalog','sync','operations','domain','attachments','business','delivery','attendance','payroll','purchasing','identity'])await pool.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
 const password=randomBytes(24).toString('hex');
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,'attendance@example.invalid',$2,'admin')",[actor.id,await identityPassword(password)]);await pool.query('INSERT INTO lab_device(id) VALUES($1)',[device]);
 await pool.query("INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at) VALUES($1,'FICTICIO Jornada',now(),now())",[actor.id]);
 await pool.query("INSERT INTO d1_records(id,owner_id,entity,data,name_key) VALUES($1,$2,'Employee',$3,'ficticio attendance')",[employee,actor.id,{name:'FICTICIO Jornada',status:'ativo'}]);
 const schedule={employee_id:employee,date:'2026-10-21',start_time:'08:00',end_time:'17:00',break_start:'12:00',break_end:'13:00',day_type:'trabalho',status:'ativo'};let saved;
 await check('schedule creation and idempotency use existing command receipt',async()=>{const body=command('Schedule',schedule);saved=(await send(body)).domainRecord;assert.equal((await send(body)).replay,true);assert.equal((await domainList(pool,actor,'Schedule')).length,1);});
 await check('invalid intervals and conflicting concurrent schedules rejected',async()=>{await assert.rejects(()=>send(command('Schedule',{...schedule,date:'2026-10-22',break_end:'18:00'})),e=>e.status===400);const results=await Promise.allSettled([send(command('Schedule',{...schedule,date:'2026-10-22'})),send(command('Schedule',{...schedule,date:'2026-10-22'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);});
 let point;
 await check('server derives metrics and rejects forged client totals',async()=>{point=(await send(command('TimeRecord',{employee_id:employee,date:schedule.date,entry_time:'08:15',lunch_start:'12:00',lunch_end:'13:00',exit_time:'17:00',worked_minutes:99999,late_minutes:0}))).domainRecord;assert.equal(point.worked_minutes,465);assert.equal(point.expected_minutes,480);assert.equal(point.late_minutes,10);assert.equal(point.status,'finalizado');});
 await check('duplicate point, inverted times and lost update refused',async()=>{await assert.rejects(()=>send(command('TimeRecord',{employee_id:employee,date:schedule.date,entry_time:'08:00'})),e=>e.status===409);await assert.rejects(()=>send(command('TimeRecord',{employee_id:employee,date:'2026-10-23',entry_time:'17:00',exit_time:'08:00'})),e=>e.status===400);await assert.rejects(()=>send(command('TimeRecord',{...point,observation:'stale'},point.id,0)),e=>e.status===409);});
 await check('manual correction requires reason and records authoritative actor',async()=>{await assert.rejects(()=>send(command('TimeRecord',{entry_time:'08:00'},point.id,point._version)),e=>e.status===400);point=(await send(command('TimeRecord',{entry_time:'08:00',adjustment_reason:'FICTICIO correção conferida'},point.id,point._version))).domainRecord;assert.equal(point.worked_minutes,480);assert.equal(point.responsible_user,actor.id);});
 await check('absence and schedule flag commit or rollback together',async()=>{const body=command('Absence',{employee_id:employee,date:schedule.date,type:'falta',status:'ativo',schedule_id:saved.id});await assert.rejects(()=>domainCommand(pool,actor,device,body,async()=>{throw Error('INJECTED_FAILURE');}),/INJECTED_FAILURE/);assert.equal((await domainList(pool,actor,'Absence')).length,0);assert.equal((await domainList(pool,actor,'Schedule')).find(r=>r.id===saved.id).absence_marked,undefined);const absence=(await send(body)).domainRecord;assert.equal((await domainList(pool,actor,'Schedule')).find(r=>r.id===saved.id).absence_marked,true);await send({...command('Absence',{},absence.id,absence._version),action:'cancel'});assert.equal((await domainList(pool,actor,'Schedule')).find(r=>r.id===saved.id).absence_marked,false);});
 await check('standard schedule uniqueness and owner permissions',async()=>{await send(command('StandardSchedule',{employee_id:employee,weekday:3,day_type:'trabalho',start_time:'08:00',end_time:'17:00'}));await assert.rejects(()=>send(command('StandardSchedule',{employee_id:employee,weekday:3,day_type:'folga'})),e=>e.status===409);await assert.rejects(()=>domainCommand(pool,{...actor,role:'viewer',id:randomUUID()},device,command('Schedule',schedule)),e=>e.status===403);});
 await check('warnings validate ownership, audit, version conflicts and idempotent cancellation',async()=>{const data={employee_id:employee,date:'2026-10-22',category:'outros',description:'FICTICIO Ocorrencia disciplinar',status:'pendente',responsible_user:'forged'};await assert.rejects(()=>send(command('Warning',{...data,description:''})),e=>e.status===400);const body=command('Warning',data);const warning=(await send(body)).domainRecord;assert.equal(warning.responsible_user,actor.id);assert.equal((await send(body)).replay,true);await assert.rejects(()=>send(command('Warning',{...data,description:'FICTICIO Alteracao'},warning.id,999)),e=>e.status===409);const cancel={...command('Warning',{},warning.id,warning._version),action:'cancel'};assert.equal((await send(cancel)).domainRecord.status,'cancelada');assert.equal((await send(cancel)).replay,true);assert.ok((await pool.query("SELECT count(*)::int n FROM d1_attendance_history WHERE entity='Warning'")).rows[0].n>=2);});
 await check('audit snapshots retained without financial or stock side effects',async()=>{assert.ok((await pool.query("SELECT count(*)::int n FROM d1_attendance_history WHERE entity='TimeRecord'")).rows[0].n>=2);assert.equal((await pool.query('SELECT (SELECT count(*) FROM d1_stock_movements)+(SELECT count(*) FROM d1_financial_entries) n')).rows[0].n,'0');});
 let policy,run;
 await check('payroll policy is explicit; client cannot forge calculated amounts',async()=>{
  policy=(await send(command('PayrollPolicy',{employee_id:employee,name:'FICTICIO Política configurada',basis:'monthly',basis_cents:300000,divisor_units:30,hourly_cents:1500,overtime_bps:15000,deduct_absences:true,status:'ativo'}))).domainRecord;
  run=(await send(command('PayrollRun',{employee_id:employee,policy_id:policy.id,reference_start:'2026-10-01',reference_end:'2026-10-15',units:15,absence_units:1,overtime_minutes:60,bonus_cents:1000,vale_ids:[],consumption_ids:[],status:'rascunho',calculation:{netCents:999999}}))).domainRecord;assert.equal(run.calculation.netCents,143250);assert.equal(run.calculation.externalPayment,false);
 });
 await check('payroll close validates source fingerprint and is idempotent and immutable',async()=>{
  await assert.rejects(()=>send({...command('PayrollRun',{},run.id,run._version),action:'confirm',token:'stale'}),e=>e.status===409);
  const close={...command('PayrollRun',{},run.id,run._version),action:'confirm',token:run.calculation.fingerprint};run=(await send(close)).domainRecord;assert.equal(run.status,'fechado');assert.equal((await send(close)).replay,true);await assert.rejects(()=>send(command('PayrollRun',{bonus_cents:0},run.id,run._version)),e=>e.status===409);
  const another=(await send(command('PayrollRun',{employee_id:employee,policy_id:policy.id,reference_start:'2026-10-01',reference_end:'2026-10-15',units:15,absence_units:0,overtime_minutes:0,bonus_cents:0,vale_ids:[],consumption_ids:[],status:'rascunho'}))).domainRecord;
  await assert.rejects(()=>send({...command('PayrollRun',{},another.id,another._version),action:'confirm',token:another.calculation.fingerprint}),e=>e.status===409);
  assert.equal((await pool.query("SELECT count(*)::int n FROM d2_catalog WHERE entity IN ('EmployeePayment','FinancialExpense')")).rows[0].n,0);
 });
 await check('payroll calculation history retained; no payment or stock effects',async()=>{assert.ok((await pool.query('SELECT count(*)::int n FROM d1_payroll_history')).rows[0].n>=4);assert.equal((await pool.query('SELECT (SELECT count(*) FROM d1_stock_movements)+(SELECT count(*) FROM d1_financial_entries) n')).rows[0].n,'0');});
 await check('payroll reopening requires conference and reason, preserves audit and cannot replay effects',async()=>{
  const reopen={...command('PayrollRun',{},run.id,run._version),action:'reopen',token:run.calculation.fingerprint,reason:'FICTICIO revisao conferida'};
  await assert.rejects(()=>send({...reopen,reason:'curto'}),e=>e.status===409);
  await assert.rejects(()=>send({...reopen,token:'stale'}),e=>e.status===409);
  const changed=(await send(reopen)).domainRecord;assert.equal(changed.status,'rascunho');assert.equal(changed.reopened_by,actor.id);assert.equal((await send(reopen)).replay,true);
  const saved=(await send(command('PayrollRun',{bonus_cents:1000},changed.id,changed._version))).domainRecord;
  run=(await send({...command('PayrollRun',{},saved.id,saved._version),action:'confirm',token:saved.calculation.fingerprint})).domainRecord;
  assert.equal(run.status,'fechado');assert.equal((await pool.query("SELECT count(*)::int n FROM d1_payroll_history WHERE action='reopen'")).rows[0].n,1);
  assert.equal((await pool.query('SELECT count(*)::int n FROM d1_financial_entries')).rows[0].n,0);
 });
 await check('paid period blocks payroll reopening even with a new operation UUID',async()=>{
  const id=randomUUID();await pool.query("INSERT INTO d2_catalog(id,owner_id,entity,data,name_key) VALUES($1,$2,'EmployeePayment',$3,$4)",[id,actor.id,{name:'FICTICIO Pagamento protegido',status:'pago',payload_json:JSON.stringify({employee_id:employee,status:'pago',reference_start:run.reference_start,reference_end:run.reference_end})},id]);
  await assert.rejects(()=>send({...command('PayrollRun',{},run.id,run._version),action:'reopen',token:run.calculation.fingerprint,reason:'FICTICIO revisao recusada'}),e=>e.status===409);
  assert.equal((await domainList(pool,actor,'PayrollRun')).find(r=>r.id===run.id).status,'fechado');
 });
 await check('individual HTTP login, CSRF, attendance availability and session restart',async()=>{
  const identity=createIdentity({pool,pepper:randomBytes(32),sender:async()=>{throw Error('NO_EMAIL_AUTHORIZED');}});
  server=createServer(pool,device,{identity});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18133,'127.0.0.1',resolve);});
  const response=await fetch(origin+'/api/d1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({login:'attendance@example.invalid',password})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],session=await response.json();
  const status=await fetch(origin+'/api/d1/attendance/status',{headers:{Cookie:cookie,Connection:'close'}});assert.equal((await status.json()).enabled,true);
  const denied=await fetch(origin+'/api/d1/domain/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,Connection:'close'},body:JSON.stringify(command('Schedule',{...schedule,date:'2026-10-24'}))});assert.equal(denied.status,403);
  const added=await fetch(origin+'/api/d1/domain/command',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrf,Connection:'close'},body:JSON.stringify(command('Schedule',{...schedule,date:'2026-10-24'}))});assert.equal(added.status,200);await added.json();
  await new Promise(r=>server.close(r));server=createServer(pool,device,{identity});await new Promise(r=>server.listen(18133,'127.0.0.1',r));const list=await fetch(origin+'/api/d1/domain/Schedule',{headers:{Cookie:cookie,Connection:'close'}});assert.equal((await list.json()).records.length,3);
 });
 if(process.env.RUY_ATTENDANCE_ELECTRON_EXE)await check('development Electron attendance, schedules and payroll calculation closure',async()=>{
  const supplier=randomUUID(),item=randomUUID();for(const [id,entity,data] of [[supplier,'Supplier',{name:'FICTICIO Fornecedor UI',status:'ativo'}],[item,'InventoryItem',{name:'FICTICIO Insumo UI',unit:'kg',status:'ativo'}]])await pool.query('INSERT INTO d2_catalog(id,owner_id,entity,data,name_key) VALUES($1,$2,$3,$4,$5)',[id,actor.id,entity,data,id]);
  const root=path.join(home,'attendance-ui-'+randomBytes(8).toString('hex'));await fs.mkdir(root);
  const encrypted=powershell('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify({purpose:'SYNTHETIC_ATTENDANCE_UI_TEST',password,employee,policyId:policy.id,supplier,item}));await fs.writeFile(path.join(root,'context.dpapi'),encrypted,{flag:'wx'});
  const env={...process.env,RUY_ATTENDANCE_UI_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const p=spawn(process.env.RUY_ATTENDANCE_ELECTRON_EXE,['desktop/attendance-ui-smoke.mjs'],{cwd:process.cwd(),windowsHide:true,env,stdio:'ignore'});p.once('error',reject);p.once('exit',resolve);});
  const proof=JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8'));assert.equal(proof.passed,true,'ATTENDANCE_UI_PROOF_REQUIRED');assert.equal((await pool.query("SELECT count(*)::int n FROM d2_catalog WHERE entity='PayrollRun' AND data->>'status'='fechado'")).rows[0].n,2);
 });
 if(process.env.RUY_ATTENDANCE_ELECTRON_EXE)assert.equal((await domainList(pool,actor,'Purchase'))[0].status,'recebida');
 console.log(JSON.stringify({passed,failed:0,realPostgreSQL:true,syntheticOnly:true,operationalMigration:false}));
}catch(e){console.error(JSON.stringify({passed,failed:1,code:e.code||e.status||'ASSERTION_FAILED'}));process.exitCode=1;}finally{if(server?.listening)await new Promise(r=>server.close(r));await pool.end();}
