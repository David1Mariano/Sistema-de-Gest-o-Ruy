import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {config,validateHome,home,cluster,DB_PORT} from '../../server/d1-lab/environment.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||DB_PORT!==55437)throw Error('Only explicitly marked disposable clone allowed.');
const marker=await validateHome();assert.equal(marker.restartFixture,process.env.RUY_D1_RESTART_FIXTURE);
for(const port of [55437,18091]){const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(port,'127.0.0.1',r);});await new Promise(r=>probe.close(r));}
const control=command=>new Promise((resolve,reject)=>{const p=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-o','-p 55437','-m','fast','-w','-t','300',command],{windowsHide:true,stdio:'ignore'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('Controlled clone action failed; preserve private log.')));});
let started=false;
try{
 await control('start');started=true;const c=new pg.Client(await config(true));await c.connect();try{assert.equal(path.resolve((await c.query("SELECT current_setting('data_directory') AS dir")).rows[0].dir).toLowerCase(),path.resolve(cluster).toLowerCase());}finally{await c.end();}
 await new Promise((r,j)=>{const child=spawn(process.execPath,['scripts/d1-lab/test-integration-stage1-api.mjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,RUY_D1_TEST_API_PORT:'18091'}});child.once('error',j);child.once('exit',code=>code===0?r():j(Error('Isolated API contract tests failed.')));});
 await fs.writeFile('logs/stage1-isolation.json',JSON.stringify({fixture:marker.restartFixture,port:55437,pgdataVerified:true,shared55436Touched:false,restarted:false,forcedTermination:false}));
}finally{if(started)await control('stop');}
