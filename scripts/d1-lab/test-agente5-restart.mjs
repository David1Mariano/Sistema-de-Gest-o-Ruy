import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import {config,validateHome,powershell} from '../../server/d1-lab/environment.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||process.env.RUY_D1_RESTART_FIXTURE)throw Error('Start from the original marked synthetic lab with explicit opt-in.');
const exec=promisify(execFile),source=await validateHome(),owner=await config(true),app=await config();
assert.equal(owner.port,55436);
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(55437,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const id=randomBytes(8).toString('hex'),home=path.join(process.env.LOCALAPPDATA,'GestaoRuy','agente5-restart-'+id),cluster=path.join(home,'cluster');
await fs.mkdir(home);
const sid=powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');await exec('icacls.exe',[home,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true});
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'55436',PGUSER:owner.user,PGPASSWORD:owner.password,PGCONNECT_TIMEOUT:'5'};
console.log('Copying only the marked synthetic cluster using pg_basebackup; source remains running.');
await exec(path.join(source.bin,'pg_basebackup.exe'),['-D',cluster,'--wal-method=stream','--checkpoint=fast','--no-password'],{env,windowsHide:true,maxBuffer:1024*1024});
await fs.writeFile(path.join(home,'lab.json'),JSON.stringify({...source,restartFixture:id,port:55437}),{flag:'wx'});
for(const [name,value] of [['owner.dpapi',owner],['app.dpapi',app]]){
 const encrypted=powershell("ConvertFrom-SecureString (ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force)",JSON.stringify({...value,port:55437}));
 await fs.writeFile(path.join(home,name),encrypted,{flag:'wx'});
}
await fs.appendFile(path.join(cluster,'postgresql.conf'),"\nport=55437\nlisten_addresses='127.0.0.1'\narchive_mode=off\n");
const control=command=>new Promise((resolve,reject)=>{
 const child=spawn(path.join(source.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-o','-p 55437','-m','fast','-w','-t','300',command],{windowsHide:true,stdio:'ignore'});
 child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('pg_ctl failed; inspect protected fixture log.')));
});
await control('start');
const canary=randomUUID();
let client=new pg.Client({...owner,port:55437});await client.connect();
let before,oldPid;
try{
 assert.equal((await client.query("SELECT current_setting('port') AS port,pg_is_in_recovery() AS recovering")).rows[0].port,'55437');
 assert.equal(path.resolve((await client.query("SELECT current_setting('data_directory') AS directory")).rows[0].directory).toLowerCase(),path.resolve(cluster).toLowerCase());
 const actor=randomUUID();await client.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,'synthetic-disabled-login','viewer')",[actor,actor+'@example.invalid']);
 await client.query("UPDATE lab_users SET active=false WHERE id=$1",[actor]);
 await client.query("INSERT INTO lab_notes(id,owner_id,data) VALUES($1,$2,$3)",[canary,actor,{name:'FICTICIO PostgreSQL restart canary'}]);
 before=(await client.query('SELECT id,owner_id,data,version,deleted FROM lab_notes WHERE id=$1',[canary])).rows[0];
 oldPid=(await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8')).split('\n')[0];
}finally{await client.end();}
console.log('Restarting only copied PGDATA on port 55437, with fast shutdown and no forced termination.');
await control('restart');
client=new pg.Client({...owner,port:55437});await client.connect();
try{assert.deepEqual((await client.query('SELECT id,owner_id,data,version,deleted FROM lab_notes WHERE id=$1',[canary])).rows[0],before);assert.equal((await client.query('SELECT pg_is_in_recovery() AS recovering')).rows[0].recovering,false);}finally{await client.end();}
const newPid=(await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8')).split('\n')[0];assert.notEqual(newPid,oldPid);
const report={fixture:id,port:55437,cluster,oldPid:Number(oldPid),newPid:Number(newPid),syntheticCanaryPersisted:true,sourcePort:55436,sourceNotRestarted:true,initdbUsed:false,forcedTermination:false};
await fs.mkdir('logs',{recursive:true});await fs.writeFile('logs/agente5-restart.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
