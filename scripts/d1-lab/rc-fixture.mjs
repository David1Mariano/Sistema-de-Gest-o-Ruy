import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {encryptArchive,decryptArchive} from '../../server/d1-lab/backup.mjs';
import {wrapRecoveryKey,unwrapRecoveryKey} from '../../server/d1-lab/key-envelope.mjs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {config as localConfig,validateHome} from '../../server/d1-lab/environment.mjs';
import {config as centralConfig,marker} from '../../server/sync-lab/environment.mjs';
const exec=promisify(execFile);
export async function createFixture(){
 if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Explicit synthetic opt-in required');
 const localMarker=await validateHome(),centralMarker=await marker(),local=await localConfig(true),central=await centralConfig('central',true);
 if(!(local.port===55436||local.port===55437&&localMarker.restartFixture===process.env.RUY_D1_RESTART_FIXTURE)||central.port!==55435)throw Error('Only marked synthetic clusters permitted');
 const suffix=randomBytes(8).toString('hex'),home=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-rc-'+suffix+'-'));
 await exec('icacls.exe',[home,'/inheritance:r','/grant:r',process.env.USERDOMAIN+'\\'+process.env.USERNAME+':(OI)(CI)F'],{windowsHide:true});
 const pools=[],databases=[];
 async function database(kind,schemas=[]){
  const base=kind==='central'?central:local,name='ruy_'+(kind==='central'?'c2':'d1')+'_rc_'+randomBytes(8).toString('hex');
  const owner=new pg.Client(base);await owner.connect();try{await owner.query('CREATE DATABASE '+name);}finally{await owner.end();}
  const pool=new pg.Pool({...base,database:name,max:8,connectionTimeoutMillis:5000});pools.push(pool);databases.push({name,port:base.port});
  for(const file of schemas)await pool.query(await fs.readFile(new URL('../../server/'+file,import.meta.url),'utf8'));
  return {pool,config:{...base,database:name},bin:kind==='central'?centralMarker.bin:localMarker.bin};
 }
 async function certificate(name){
  await exec('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(home,name+'.key'),'-out',path.join(home,name+'.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true});
  return {key:await fs.readFile(path.join(home,name+'.key'),'utf8'),cert:await fs.readFile(path.join(home,name+'.crt'),'utf8')};
 }
 async function roundTrip(source){
  const stem=randomUUID(),file=path.join(home,stem+'.dump'),c=source.config;
  const env={...process.env,PGHOST:c.host,PGPORT:String(c.port),PGUSER:c.user,PGPASSWORD:c.password};
  await exec(path.join(source.bin,'pg_dump.exe'),['--dbname='+c.database,'--format=custom','--no-owner','--no-acl','--file='+file],{env,windowsHide:true});
  const dump=await fs.readFile(file),hash=createHash('sha256').update(dump).digest('hex'),key=randomBytes(32),phrase=randomBytes(32).toString('hex');
  const envelope=await wrapRecoveryKey(key,randomUUID(),phrase),archive=encryptArchive({purpose:'RUY_D1_SYNTHETIC_BACKUP',version:1,dump:dump.toString('base64'),dumpHash:hash,attachments:[]},key);
  key.fill(0);await assert.rejects(unwrapRecoveryKey(envelope,'FICTICIO wrong recovery phrase'));
  const recovered=await unwrapRecoveryKey(envelope,phrase);
  let plain;try{plain=decryptArchive(archive,recovered.key);const damaged=Buffer.from(archive);damaged[25]^=1;assert.throws(()=>decryptArchive(damaged,recovered.key));}finally{recovered.key.fill(0);}
  await fs.writeFile(path.join(home,stem+'.ruybak'),archive,{flag:'wx'});
  const recoveredFile=path.join(home,stem+'-recovered.dump');await fs.writeFile(recoveredFile,Buffer.from(plain.dump,'base64'),{flag:'wx'});
  const target=await database(c.port===55435?'central':'local');
  await exec(path.join(source.bin,'pg_restore.exe'),['--dbname='+target.config.database,'--no-owner','--no-acl','--exit-on-error',recoveredFile],{env,windowsHide:true});
  return target;
 }
 return {home,database,certificate,databases,roundTrip,close:()=>Promise.all(pools.map(pool=>pool.end()))};
}
