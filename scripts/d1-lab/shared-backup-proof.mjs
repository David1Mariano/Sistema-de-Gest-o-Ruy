import fs from 'node:fs/promises';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {config,home,installation,seal} from '../../server/d1-lab/environment.mjs';
import {pg} from '../../server/d1-lab/core.mjs';import {encryptArchive,decryptArchive} from '../../server/d1-lab/backup.mjs';
export async function proveSharedBackup(pool,root){
 if(installation?.id!=='final-dev-20261021'||process.env.RUY_SHARED_LAB!=='1'||path.dirname(root)!==home||!/^shared-test-[a-f0-9]{16}$/.test(path.basename(root))||await fs.realpath(root)!==root)throw Error('Synthetic backup scope required');
 const database=(await pool.query('SELECT current_database() name')).rows[0].name;if(!/^ruy_d1_rc_[a-f0-9]{16}$/.test(database))throw Error('Synthetic database required');
 const base=await config(true),marker=JSON.parse(await fs.readFile(path.join(home,'lab.json'),'utf8')),exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const run=(name,args,db)=>exec(path.join(marker.bin,name+'.exe'),args,{env:{...process.env,PGHOST:'127.0.0.1',PGPORT:String(installation.dbPort),PGUSER:base.user,PGPASSWORD:base.password,PGDATABASE:db,PGCONNECT_TIMEOUT:'5'},encoding:'buffer',maxBuffer:64*1024*1024,timeout:60000,windowsHide:true});
 const client=await pool.connect();let dump;
 try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const snapshot=(await client.query('SELECT pg_export_snapshot() id')).rows[0].id;dump=(await run('pg_dump',['--format=custom','--no-owner','--no-acl','--snapshot='+snapshot],database)).stdout;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 const key=randomBytes(32),bytes=encryptArchive({purpose:'RUY_D1_SYNTHETIC_BACKUP',version:1,dump:dump.toString('base64'),dumpHash:hash(dump),attachments:[],createdAt:new Date().toISOString()},key),archive=decryptArchive(bytes,key);
 const file=path.join(root,'central-backup.ruybak');await fs.writeFile(file,bytes,{flag:'wx'});await seal('shared-recovery-'+randomBytes(8).toString('hex')+'.dpapi',{purpose:'SHARED_SYNTHETIC_BACKUP_KEY',backupSha256:hash(bytes),key:key.toString('base64')});
 const restored='ruy_d1_rc_'+randomBytes(8).toString('hex'),control=new pg.Client(base);await control.connect();await control.query('CREATE DATABASE '+restored+' OWNER ruy_d1_owner');await control.end();
 const dumpFile=path.join(root,'restore-input.dump');await fs.writeFile(dumpFile,Buffer.from(archive.dump,'base64'),{flag:'wx'});await run('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname='+restored,dumpFile],restored);
 const target=new pg.Pool({...base,database:restored});let tables=0;
 try{
  const names=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  for(const {tablename} of names){if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw Error('Unexpected identifier');const sql=`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) data FROM public."${tablename}" t`;assert.deepEqual((await target.query(sql)).rows[0].data,(await pool.query(sql)).rows[0].data);tables++;}
 }finally{await target.end();}
 // Retain encrypted backup and protected key. Remove only this freshly created
 // plaintext restore input, never an existing backup or source file.
 await fs.unlink(dumpFile);
 return {encrypted:true,restoredToNewDatabase:true,tablesVerified:tables,sha256:hash(bytes),operationalDatabaseChanged:false};
}
