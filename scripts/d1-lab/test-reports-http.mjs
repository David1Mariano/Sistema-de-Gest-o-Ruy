// Real HTTP/PostgreSQL, synthetic-only NEW database. No installed profile writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {installation,config,seal,home} from '../../server/d1-lab/environment.mjs';
import {pg,digest} from '../../server/d1-lab/core.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_REPORT_ACCEPTANCE,'1');
await ensureLocalDatabase();const database='ruy_d1_rc_'+randomBytes(8).toString('hex');
const control=new pg.Client(await config(true));await control.connect();await control.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await control.end();
const pool=new pg.Pool({...await config(true),database});let server;let passed=0;
try{
 for(const name of ['schema','entities','catalog','domain'])await pool.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
 const owner=randomUUID(),other=randomUUID(),viewer=randomUUID(),device=randomUUID();await pool.query('INSERT INTO lab_device(id) VALUES($1)',[device]);
 for(const [id,role] of [[owner,'admin'],[other,'admin'],[viewer,'viewer']])await pool.query('INSERT INTO lab_users VALUES($1,$2,$3,$4,true)',[id,id+'@example.invalid','NO_LOGIN_TEST_ONLY',role]);
 for(const id of [owner,other])for(let i=0;i<640;i++)await pool.query('INSERT INTO d1_records(id,owner_id,entity,data,name_key) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,'Employee',{name:'FICTICIO João '+i,status:'ativo',sector:'FICTICIO Setor',cpf:'NEVER_EXPORT'},'fixture-'+i]);
 await pool.query('INSERT INTO d2_catalog(id,owner_id,entity,data,name_key) VALUES($1,$2,$3,$4,$5)',[randomUUID(),owner,'FinancialExpense',{payload_json:JSON.stringify({date:'2026-10-15',amount:123.45,category_name:'FICTICIO Água',status:'pago'})},'fixture']);
 const sessions={};for(const [name,id] of [['owner',owner],['viewer',viewer]]){const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');sessions[name]={cookie:'ruy_d1_lab='+token,csrf};await pool.query("INSERT INTO lab_sessions VALUES($1,$2,$3,now()+interval '1 hour')",[digest(token),id,csrf]);}
 server=createServer(pool,device);await new Promise((r,j)=>{server.once('error',j);server.listen(18133,'127.0.0.1',r);});
 const request=(route,session=sessions.owner,options={})=>fetch(origin+route,{...options,headers:{...(session?{cookie:session.cookie}:{}),...options.headers}});
 assert.equal((await request('/api/d1/reports/employees',null)).status,401);passed++;
 assert.equal((await request('/api/d1/reports/employees',sessions.viewer)).status,403);passed++;
 const employees=await (await request('/api/d1/reports/employees')).json();assert.equal(employees.rows.length,640);assert.ok(!JSON.stringify(employees).includes('NEVER_EXPORT'));passed++;
 const finance=await (await request('/api/d1/reports/categories?start=2026-10-01&end=2026-10-31')).json();assert.equal(finance.totalCents,12345);passed++;
 assert.equal((await request('/api/d1/reports/employees',sessions.owner,{headers:{Origin:'https://example.invalid'}})).status,403);passed++;
 assert.equal((await request('/api/d1/reports/employees',sessions.owner,{method:'POST',headers:{Origin:origin,'content-type':'application/json','x-csrf-token':sessions.owner.csrf},body:'{}'})).status,405);passed++;
 if(process.env.RUY_REPORT_ELECTRON_EXE){
  const context='report-ui-'+randomBytes(8).toString('hex')+'.dpapi';await seal(context,{purpose:'SYNTHETIC_REPORT_UI',cookie:sessions.owner.cookie.split('=')[1],expires:Date.now()+600000});
  const env={...process.env,RUY_REPORT_UI_CONTEXT:context};delete env.ELECTRON_RUN_AS_NODE;
  const code=await new Promise((r,j)=>{const child=spawn(process.env.RUY_REPORT_ELECTRON_EXE,['desktop/report-ui-smoke.mjs'],{env,cwd:process.cwd(),windowsHide:true,stdio:'ignore'});child.once('error',j);child.once('exit',r);});assert.equal(code,0);
  const proof=JSON.parse(await fs.readFile(path.join(home,context.slice(0,-6),'result.json'),'utf8'));assert.equal(proof.passed,true,JSON.stringify(proof));passed++;
 }
 await pool.query('UPDATE lab_users SET active=false WHERE id=$1',[owner]);assert.equal((await request('/api/d1/reports/employees')).status,401);passed++;
 assert.equal((await pool.query('SELECT count(*)::int n FROM d1_records')).rows[0].n,1280);assert.equal((await pool.query('SELECT count(*)::int n FROM d2_catalog')).rows[0].n,1);passed++;
 console.log(JSON.stringify({passed,failed:0,synthetic:true,realHttp:true,realPostgreSQL:true,installedAppTested:false}));
}finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
