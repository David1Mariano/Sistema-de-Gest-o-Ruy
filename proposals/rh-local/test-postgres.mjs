import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {patchCore} from './integration.mjs';
// Only explicit dedicated configuration may enable real tests. Shared cluster is never used.
if(!process.env.RUY_RH_ISOLATED_CONFIG) {
  console.log('BLOCKED: provide a dedicated agent-2 PostgreSQL instance and pre-provisioned empty test database; shared cluster untouched.');
  process.exitCode=2;
} else {
  const config=JSON.parse(await fs.readFile(process.env.RUY_RH_ISOLATED_CONFIG,'utf8'));
  if(config.environment!=='agent-2-rh-isolated'||config.host!=='127.0.0.1'||!/^ruy_local_test_agent2_rh_[a-z0-9_]+$/.test(config.database)||!Number.isInteger(config.port)||config.port<20000||config.port===55432)throw Error('Exclusive RH test instance required.');
  const root='C:/Users/Pichau/Sistema-de-Gest-o-Ruy/';
  const pg=createRequire(root+'package.json')('pg');
  const {environment: _environment,...connection}=config;
  void _environment;
  let source=patchCore(await fs.readFile(root+'server/local/core.mjs','utf8'));
  source=source.replace("'./c2.mjs'",JSON.stringify(pathToFileURL(root+'server/local/c2.mjs').href)).replace("'./rh-contract.mjs'",JSON.stringify(new URL('./rh-contract.mjs',import.meta.url).href)).replace("'pg'",JSON.stringify(pathToFileURL(root+'node_modules/pg/lib/index.js').href));
  const {mutate,activate}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let pool=new pg.Pool({...connection,connectionTimeoutMillis:5000,statement_timeout:10000});
  try {
    const actual=(await pool.query('SELECT current_database() AS database')).rows[0].database;
    assert.equal(actual,config.database);
    for(const table of ['local_users','local_records','local_pending','local_activation','local_audit'])assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count),0,'Test requires empty pre-provisioned tables.');
    const user=await activate(pool,{email:'rh-synthetic@example.invalid',password:randomUUID(),confirmedBy:'ISOLATED RH AUTOMATED FIXTURE — NOT PRODUCTION'});
    user.active=true;
    await mutate(pool,user,'Employee','emp',{operationId:randomUUID(),operation:'create',data:{name:'Synthetic RH employee',status:'ativo'}});
    const day='2026-10-09';
    const records={EmployeeDocument:{date:day,name:'Synthetic document'},EmployeePayment:{payment_date:day,gross_amount:100,discount_amount:10,net_amount:90,status:'pendente'},Evaluation:{date:day,score:7},Warning:{date:day,status:'pendente'},Vale:{date:day,amount:10,status:'pendente'},Absence:{date:day,type:'falta',status:'ativo'},TimeRecord:{date:day,entry_time:'08:00'},Schedule:{date:day,start_time:'08:00',end_time:'17:00',day_type:'trabalho',status:'ativo'},StandardSchedule:{weekday:5,day_type:'trabalho'}};
    for(const [entity,fields] of Object.entries(records)) {
      const id=randomUUID(),data={employee_id:'emp',...fields},body={operationId:randomUUID(),operation:'create',data};
      await mutate(pool,user,entity,id,body);assert.equal((await mutate(pool,user,entity,id,body)).replay,true);
      await mutate(pool,user,entity,id,{operationId:randomUUID(),operation:'update',baseVersion:1,data:{...data,observation:'Edited'}});
      await assert.rejects(mutate(pool,user,entity,id,{operationId:randomUUID(),operation:'update',baseVersion:1,data}),{status:409});
      await mutate(pool,user,entity,id,{operationId:randomUUID(),operation:'delete',baseVersion:2,confirmation:'EXCLUIR'});
      assert.equal((await pool.query('SELECT deleted FROM local_records WHERE entity=$1 AND id=$2',[entity,id])).rows[0].deleted,true);
      assert.equal(Number((await pool.query('SELECT count(*) FROM local_pending WHERE entity=$1 AND record_id=$2',[entity,id])).rows[0].count),3);
    }
    await assert.rejects(mutate(pool,user,'Warning','rollback',{operationId:randomUUID(),operation:'create',data:{employee_id:'emp',date:day}},async()=>{throw Error('Injected failure');}));
    assert.equal((await pool.query("SELECT 1 FROM local_records WHERE id='rollback'")).rowCount,0);
    await pool.end();pool=new pg.Pool({...connection,connectionTimeoutMillis:5000});
    assert.equal(Number((await pool.query('SELECT count(*) FROM local_pending')).rows[0].count),28);
    console.log('PASS: real dedicated PostgreSQL RH CRUD, replay, version conflicts, tombstones, pending queue, rollback and persistence after client reconnection. No cluster restart; synthetic database preserved.');
  } finally {await pool.end();}
}
