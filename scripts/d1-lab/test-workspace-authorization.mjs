import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {randomUUID,randomBytes} from 'node:crypto';import pg from 'pg';
import {installation,config} from '../../server/d1-lab/environment.mjs';import {createOperationalWorkspace} from '../../server/d1-lab/operational-workspace.mjs';
if(installation?.id!=='final-dev-20261021'||process.env.RUY_WORKSPACE_SYNTHETIC_ACCEPTANCE!=='1')throw Error('NEW_SYNTHETIC_WORKSPACE_REQUIRED');
const base=await config(true),database='ruy_d1_rc_'+randomBytes(8).toString('hex'),ctl=new pg.Client(base);await ctl.connect();try{await ctl.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await ctl.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');}finally{await ctl.end();}
const pool=new pg.Pool({...base,database}),user={id:randomUUID(),role:'admin'},legacyId=randomUUID();let passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
try{
 for(const name of ['schema','entities','catalog','sync','operations','domain','attachments','business','delivery','attendance','payroll','purchasing','settlements','workspace'])await pool.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,'workspace@example.invalid','disabled:no-login','admin')",[user.id]);await pool.query("INSERT INTO d1_workspace(owner_id,cutover_date,activation_approved,source_database,source_sha256,records,attachments) VALUES($1,'2026-10-24',false,'SYNTHETIC_SOURCE',$2,1186,59)",[user.id,'0'.repeat(64)]);await pool.query("INSERT INTO d1_legacy_guard VALUES($1,'EmployeePayment')",[legacyId]);
 const source={verify:async()=>{},list:async u=>{if(u.id!==user.id)throw Object.assign(Error('DENIED'),{status:403});return [];},route:async()=>false},workspace=createOperationalWorkspace({source,pool});
 const route=(body,path='/api/d1/domain/command')=>workspace.route({method:'POST'},null,new URL('http://127.0.0.1:18133'+path),user,()=>{},body);
 await check('activation remains owner controlled and blocks all business writes',async()=>{await assert.rejects(()=>route({entity:'Schedule',id:randomUUID(),data:{date:'2026-10-24'}}),e=>e.status===403);});
 await pool.query('UPDATE d1_workspace SET activation_approved=true');
 await check('authorized new commands pass the gate without modifying legacy identities',async()=>{assert.equal(await route({entity:'Schedule',id:randomUUID(),data:{date:'2026-10-24'}}),false);await assert.rejects(()=>route({id:legacyId,data:{payment_date:'2026-10-24'}}),e=>e.status===403);});
 await check('historical period bypasses including nested payroll batches and sync are refused',async()=>{await assert.rejects(()=>route({data:{date:'2026-10-23'}}),e=>e.status===409);await assert.rejects(()=>route({data:{payments:[{reference_start:'2026-10-01'}]}}),e=>e.status===409);await assert.rejects(()=>route({},'/api/d1/sync-now'),e=>e.status===403);});
 await check('database trigger rejects direct legacy insertion even outside the HTTP guard',async()=>{await assert.rejects(()=>pool.query("INSERT INTO d2_catalog(id,owner_id,entity,data,name_key) VALUES($1,$2,'EmployeePayment','{}','forbidden')",[legacyId,user.id]),e=>e.code==='42501');assert.equal((await pool.query('SELECT count(*) n FROM d2_catalog')).rows[0].n,'0');});
 console.log(JSON.stringify({passed,failed:0,syntheticOnly:true,realHistoricalDataUsed:false}));
}finally{await pool.end();}
