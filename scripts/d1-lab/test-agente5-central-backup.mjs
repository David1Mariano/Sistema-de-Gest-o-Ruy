import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import pg from 'pg';
import {config,marker,home,seal} from '../../server/sync-lab/environment.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic backup opt-in required');
const m=await marker(),c=await config('central',true);
const evidence=JSON.parse(await fs.readFile('logs/agente5-windows-chain-20261016.json','utf8'));
const id=randomBytes(8).toString('hex'),database='ruy_c2_restore_'+id;
const client=new pg.Client(c);await client.connect();
const environment={...process.env,PGHOST:c.host,PGPORT:String(c.port),PGUSER:c.user,PGPASSWORD:c.password,PGDATABASE:c.database,PGCONNECT_TIMEOUT:'5'};
const run=(name,args,input)=>execFileSync(path.join(m.bin,name+'.exe'),args,{input,env:environment,windowsHide:true,timeout:60000,maxBuffer:64*1024*1024,stdio:['pipe','pipe','ignore']});
let dump,expected;
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
 expected=(await client.query('SELECT version,data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[evidence.workspace,evidence.employeeId])).rows[0];
 dump=run('pg_dump',['--format=custom','--no-owner','--no-acl','--snapshot='+snapshot]);
 await client.query('COMMIT');
 const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const encrypted=Buffer.concat([iv,cipher.update(dump),cipher.final(),cipher.getAuthTag()]);
 const directory=path.join(home,'backups');await fs.mkdir(directory,{recursive:true});
 const file=path.join(directory,'agente5-central-'+id+'.aesgcm');await fs.writeFile(file,encrypted,{flag:'wx'});
 await seal('agente5-central-backup-'+id,{key:key.toString('hex'),purpose:'SYNTHETIC_CENTRAL_BACKUP'});
 const decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));decipher.setAuthTag(encrypted.subarray(-16));
 const restoredBytes=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]);assert.deepEqual(restoredBytes,dump);
 const damaged=Buffer.from(encrypted);damaged[20]^=1;
 assert.throws(()=>{const d=createDecipheriv('aes-256-gcm',key,damaged.subarray(0,12));d.setAuthTag(damaged.subarray(-16));d.update(damaged.subarray(12,-16));d.final();});
 await client.query('CREATE DATABASE '+database);
 run('pg_restore',['--dbname='+database,'--no-owner','--no-acl','--exit-on-error'],restoredBytes);
 const restored=new pg.Client({...c,database});await restored.connect();
 try{assert.deepEqual((await restored.query('SELECT version,data FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[evidence.workspace,evidence.employeeId])).rows[0],expected);assert.equal((await restored.query('SELECT count(*)::int n FROM d1_central_receipts WHERE workspace_id=$1',[evidence.workspace])).rows[0].n>=3,true);}finally{await restored.end();}
 const report={database,file:path.basename(file),sha256:createHash('sha256').update(encrypted).digest('hex'),windowsTombstoneRestored:true,centralReceiptsRestored:true,encrypted:true,dpapiKey:true,corruptionRejected:true,apiStartedOnRestore:false};
 await fs.writeFile('logs/agente5-central-backup-20261016.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await client.end();}
