import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {config,validateHome,home,cluster,DB_PORT} from '../../server/d1-lab/environment.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||DB_PORT!==55437||process.env.RUY_D1_TEST_API_PORT!=='18091')throw Error('Marked disposable clone and auxiliary API required');
const marker=await validateHome();assert.equal(marker.restartFixture,'e5aaec701010f607');
const first=JSON.parse(await fs.readFile('logs/agente5-rc3-windows.json','utf8'));assert.equal(first.packaged,true);assert.equal(first.revision,'A5-I5-20261019');
for(const port of [55437,18091]){const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(port,'127.0.0.1',r);});await new Promise(r=>probe.close(r));}
const control=command=>new Promise((r,j)=>{const p=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-o','-p 55437','-m','fast','-w','-t','300',command],{windowsHide:true,stdio:'ignore'});p.once('error',j);p.once('exit',code=>code===0?r():j(Error('Controlled clone action failed')));});
let started=false,pool;
try{
 await control('start');started=true;const owner=new pg.Client(await config(true));await owner.connect();try{assert.equal(path.resolve((await owner.query("SELECT current_setting('data_directory') dir")).rows[0].dir).toLowerCase(),path.resolve(cluster).toLowerCase());}finally{await owner.end();}
 pool=new pg.Pool(await config());
 const existing=async()=>({employee:(await pool.query('SELECT data,version FROM d1_records WHERE owner_id=$1 AND id=$2',[first.syntheticActor,first.employee.id])).rows,attachment:(await pool.query('SELECT id,state FROM d1_attachment_queue WHERE actor=$1 AND id=$2',[first.syntheticActor,first.attachments.id])).rows,stock:(await pool.query('SELECT item_id,quantity_milli FROM d1_stock_balances WHERE owner_id=$1 ORDER BY item_id',[first.syntheticActor])).rows});
 const before=await existing();assert.equal(before.employee[0].data._deleted,'true');assert.equal(before.attachment[0].state,'acknowledged');
 const evidenceDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-i5-reopen-')),executable=path.resolve('artifacts/agente5-integracao5-20261019/win-unpacked/Sistema Ruy - Integracao 5 Homologacao.exe');
 const launches=[];
 for(let n=0;n<2;n++){
  const evidence=path.join(evidenceDirectory,'launch-'+n+'.json'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const code=await new Promise((r,j)=>{const child=spawn(executable,['--lab-smoke','--lab-evidence='+evidence],{windowsHide:true,stdio:'ignore',env});child.once('error',j);child.once('exit',r);});assert.equal(code,0);
  const result=JSON.parse(await fs.readFile(evidence,'utf8'));assert.equal(result.packaged,true);assert.equal(result.authenticated,true);assert.equal(result.originalStockPage.quantityMilli,2000);
  launches.push({actor:result.syntheticActor,packaged:result.packaged,normalExit:true});assert.deepEqual(await existing(),before);
 }
 for(const launch of launches)assert.equal((await pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[launch.actor])).rows[0].quantity_milli,'2000');
 await fs.writeFile('logs/etapa5/reopen.json',JSON.stringify({checks:5,newPackagedLaunches:2,originalPackagedLaunchPreserved:true,employeeTombstonePreserved:true,attachmentQueuePreserved:true,stockPreserved:true,newLaunchDataPersistedAfterExit:true,installed:false,windowsRebootTested:false,normalExit:true},null,2));console.log('I5_PACKAGED_REOPEN_OK');
}finally{if(pool)await pool.end();if(started)await control('stop');}
