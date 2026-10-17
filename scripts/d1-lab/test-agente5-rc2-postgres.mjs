import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {config,validateHome,home,cluster,DB_PORT} from '../../server/d1-lab/environment.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||DB_PORT!==55437)throw Error('Dedicated copied restart fixture required.');
const marker=await validateHome(),owner=await config(true);
assert.equal(marker.restartFixture,process.env.RUY_D1_RESTART_FIXTURE);
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(55437,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const control=command=>new Promise((resolve,reject)=>{
 const child=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-o','-p 55437','-m','fast','-w','-t','300',command],{windowsHide:true,stdio:'ignore'});
 child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Controlled pg_ctl failed; preserve private log.')));
});
const pid=async()=>Number((await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8')).split('\n')[0]);
let started=false;
try{
 await control('start');started=true;
 const check=new pg.Client(owner);await check.connect();
 try{assert.equal(path.resolve((await check.query("SELECT current_setting('data_directory') AS directory")).rows[0].directory).toLowerCase(),path.resolve(cluster).toLowerCase());}finally{await check.end();}
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/d1-lab/test-agente5-rc2-transfer.mjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,RUY_D1_TEST_API_PORT:'18091'}});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('RC suite failed; no restart verification claimed.')));
 });
 const report=JSON.parse(await fs.readFile('logs/agente5-rc2-transfer.json','utf8'));
 assert.equal(report.restartFixture,marker.restartFixture);
 const databases=report.databases.filter(item=>item.port===55437).map(item=>item.name);
 assert.ok(databases.length>=4);assert.ok(databases.every(name=>/^ruy_d1_rc_[a-f0-9]{16}$/.test(name)));
 async function snapshot(){
  const hash=createHash('sha256');let queues=0,caches=0;
  for(const database of databases){
   const client=new pg.Client({...owner,database});await client.connect();
   try{
    for(const table of ['d1_attachment_queue','d1_attachment_cache','d1_stock_balances','d1_financial_entries','d1_financial_accounts','d1_business_local','d1_stock_movements']){
     const rows=(await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
     hash.update(database+table+JSON.stringify(rows));if(table==='d1_attachment_queue')queues+=rows.length;if(table==='d1_attachment_cache')caches+=rows.length;
    }
   }finally{await client.end();}
  }
  return {sha256:hash.digest('hex'),queues,caches};
 }
 const before=await snapshot(),oldPid=await pid();assert.ok(before.queues>0&&before.caches>0);
 await control('restart');const newPid=await pid();assert.notEqual(newPid,oldPid);assert.deepEqual(await snapshot(),before);
 const evidence={fixture:marker.restartFixture,port:55437,oldPid,newPid,databases:databases.length,...before,persistenceVerified:true,source55436Restarted:false,forcedTermination:false};
 await fs.writeFile('logs/agente5-rc2-postgres.json',JSON.stringify(evidence,null,2));console.log('RC2_POSTGRES_OK '+JSON.stringify(evidence));
}finally{if(started)await control('stop');}
