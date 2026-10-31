import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {encryptArchive,decryptArchive} from '../d1-lab/backup.mjs';import {loadProfile,sha} from './profile.mjs';
export async function resolveCentralBackup(file,key){
 const archive=decryptArchive(await fs.readFile(file),key);if(archive.historyDump)return archive;
 const ref=archive.historyReference;if(!ref||!/^central-[0-9]+-[a-f0-9]{8}\.ruybak$/.test(ref.file))throw Error('HISTORY_BACKUP_REFERENCE_REQUIRED');
 const bytes=await fs.readFile(path.join(path.dirname(file),ref.file));if(sha(bytes)!==ref.sha256)throw Error('HISTORY_BACKUP_REFERENCE_HASH_FAILED');
 const anchor=decryptArchive(bytes,key);if(!anchor.historyDump||anchor.historyManifest?.datasetSha256!==archive.historyManifest?.datasetSha256)throw Error('HISTORY_BACKUP_REFERENCE_DATASET_FAILED');
 return {...archive,historyDump:anchor.historyDump,historyDumpHash:anchor.historyDumpHash,historyReferenceResolved:true};
}
// Pipe dumps directly into memory. No SQL is restored and no plaintext dump is
// written by backup. PG environment overrides cannot redirect the connection.
export function pgPipe(bin,command,args,connection,input){
 if(connection.host!=='127.0.0.1'||![55483,55516].includes(connection.port)||! /^(?:ruy_d1_rc_[a-f0-9]{16}|ruy_central_prod_[a-f0-9]{16}|ruy_private_import_(?:work|history)_[a-f0-9]{16}|ruy_central_rc1_staging|ruy_central_history_[a-f0-9]{16})$/.test(connection.database))throw Error('CENTRAL_BACKUP_TARGET_REFUSED');
 return new Promise((resolve,reject)=>{const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('PG'))delete env[k];Object.assign(env,{PGHOST:'127.0.0.1',PGPORT:String(connection.port),PGDATABASE:connection.database,PGUSER:connection.user,PGPASSWORD:connection.password,PGCONNECT_TIMEOUT:'5'});
  const child=spawn(path.join(bin,command+'.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let size=0,done=false;const chunks=[];const timer=setTimeout(()=>{child.kill();finish(Error('CENTRAL_BACKUP_TIMEOUT'));},60000);
  function finish(error,data){if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(data);}
  let diagnostic='';child.stdout.on('data',b=>{size+=b.length;if(size>64*1024*1024){child.kill();finish(Error('CENTRAL_BACKUP_SIZE_LIMIT'));}else chunks.push(b);});child.stderr.on('data',b=>{if(diagnostic.length<4096)diagnostic+=b;});child.stdin.on('error',()=>{});child.on('error',()=>finish(Error('POSTGRES_BINARY_UNAVAILABLE')));child.once('close',code=>{const table=diagnostic.match(/permission denied for (?:table|sequence|schema) ([a-z_]+)/i)?.[1];finish(code===0?null:Error('CENTRAL_BACKUP_COMMAND_FAILED'+(table?'_'+table.toUpperCase():'')),Buffer.concat(chunks));});child.stdin.end(input);
 });
}
export async function backupCentral(directory,{pool,historical,loaded,includeHistory=true,historyReference=null}={}){
 const {profile:p,secrets:s,root}=loaded||await loadProfile(directory);
 if(!pool||!historical||!p.pgBin||!s.backupKey||! /^[a-f0-9]{64}$/.test(s.backupKey))throw Error('CENTRAL_BACKUP_PROVISIONING_REQUIRED');
 const backupRoot=path.join(root,'backups');await fs.mkdir(backupRoot,{recursive:true});if((await fs.realpath(backupRoot)).toLowerCase()!==backupRoot.toLowerCase())throw Error('BACKUP_REDIRECTION_REFUSED');
 async function dump(pool,connection){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const snapshot=(await c.query('SELECT pg_export_snapshot() id')).rows[0].id;const bytes=await pgPipe(p.pgBin,'pg_dump',['--format=custom','--no-owner','--no-acl','--snapshot='+snapshot,'--exclude-table-data=public.identity_bootstrap',...(pool===historical?['--schema=history','--exclude-table=history.auth_redacted']:[])],connection);await c.query('COMMIT');return bytes;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 if(!includeHistory&&(!historyReference||path.basename(historyReference.file)!==historyReference.file||historyReference.datasetSha256!==p.history.datasetSha256||sha(await fs.readFile(path.join(backupRoot,historyReference.file)))!==historyReference.sha256))throw Error('VERIFIED_IMMUTABLE_HISTORY_BACKUP_REQUIRED');
 const main=await dump(pool,{...p.database,password:s.databasePassword}),history=includeHistory?await dump(historical,{...p.history.database,password:s.historyPassword}):null;
 const archive={purpose:p.mode==='lab'?'RUY_D1_SYNTHETIC_BACKUP':'RUY_OPERATIONAL_CANDIDATE_BACKUP',contract:'RUY-CENTRAL-BACKUP/1',version:1,createdAt:new Date().toISOString(),historyManifest:{datasetSha256:p.history.datasetSha256,records:p.history.records,attachments:p.history.attachments},dump:main.toString('base64'),dumpHash:sha(main),...(history?{historyDump:history.toString('base64'),historyDumpHash:sha(history)}:{historyReference}),attachments:[]};
 const key=Buffer.from(s.backupKey,'hex'),bytes=encryptArchive(archive,key);decryptArchive(bytes,key);key.fill(0);
 const file=path.join(backupRoot,'central-'+Date.now()+'-'+randomBytes(4).toString('hex')+'.ruybak');await fs.writeFile(file,bytes,{flag:'wx'});return {file,sha256:sha(bytes),bytes:bytes.length,encrypted:true,historyIncluded:includeHistory,...(!includeHistory?{historyReference}:{})};
}
