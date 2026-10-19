import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {config,validateHome,home,cluster,DB_PORT} from '../../server/d1-lab/environment.mjs';
import {runStage2} from './test-integration-stage2.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||DB_PORT!==55437)throw Error('Only explicitly marked disposable clone allowed.');
const marker=await validateHome();assert.equal(marker.restartFixture,'e5aaec701010f607');
const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(55437,'127.0.0.1',r);});await new Promise(r=>probe.close(r));
const control=command=>new Promise((resolve,reject)=>{const p=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-o','-p 55437','-m','fast','-w','-t','300',command],{windowsHide:true,stdio:'ignore'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('Controlled clone action failed; preserve private log.')));});
const verify=async()=>{const c=new pg.Client(await config(true));await c.connect();try{assert.equal(path.resolve((await c.query("SELECT current_setting('data_directory') AS dir")).rows[0].dir).toLowerCase(),path.resolve(cluster).toLowerCase());}finally{await c.end();}};
let started=false;
try{
 await control('start');started=true;await verify();
 const before=await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8');
 const report=await runStage2(async()=>{await verify();await control('restart');await verify();assert.notEqual((await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/)[0],before.split(/\r?\n/)[0]);});
 await fs.mkdir('logs',{recursive:true});await fs.writeFile('logs/stage2-isolated.json',JSON.stringify({...report,pgdataVerified:true,forcedTermination:false},null,2));
}finally{if(started)await control('stop');}
