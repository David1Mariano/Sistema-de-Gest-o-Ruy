import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {initializeLab,ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {validateHome,config,home,cluster,pgCommand} from '../../server/d1-lab/environment.mjs';
import {poolFor,pg} from '../../server/d1-lab/core.mjs';
import {save} from '../../server/d1-lab/entities.mjs';
import {backup,configureExternalBackup,exportRecoveryKey,restoreWithRecovery} from '../../server/d1-lab/backup.mjs';
import {productionWitness} from './production-witness.mjs';
const self=fileURLToPath(import.meta.url),cli=fileURLToPath(new URL('../d1-lab.mjs',import.meta.url)),exec=promisify(execFile);
if(process.argv.includes('--source')){
 let text='';for await(const part of process.stdin)text+=part;const {phrase,directory}=JSON.parse(text);
 await initializeLab({account:{login:'foreign@example.invalid',password:randomBytes(24).toString('hex')}});
 const marker=await validateHome(),pool=poolFor(await config()),id=randomUUID(),operationId=randomUUID();
 try{
  const user=(await pool.query("SELECT id,role FROM lab_users WHERE login='foreign@example.invalid'")).rows[0];
  await save(pool,user,marker.deviceId,'Sector',id,{operationId,operation:'create',baseVersion:null,data:{name:'FICTICIO Origem recuperação H',status:'ativo'}});
  await fs.mkdir(path.join(home,'attachments'),{recursive:true});await fs.writeFile(path.join(home,'attachments','FICTICIO-H.txt'),'FICTICIO recuperação externa');
  await configureExternalBackup(directory,{retain:2});
  const keyFile=path.join(directory,'foreign.ruykey');await exportRecoveryKey(keyFile,phrase);
  let last;for(let i=0;i<3;i++)last=await backup();assert.equal(last.externalRetention.deleted,1);
  console.log(JSON.stringify({deviceId:marker.deviceId,operationId,id,keyFile,backupFile:last.externalFile,retention:last.externalRetention,externalProtected:last.externalProtected}));
 }finally{await pool.end();pgCommand(marker.bin,'pg_ctl',['-D',cluster,'-m','fast','-w','stop']);}
}else{
 if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório: pausa exclusivamente D1.');
 const production=await productionWitness(),marker=await validateHome(),directory=path.resolve('artifacts','h-recovery-'+randomUUID());await fs.mkdir(directory);
 const control=(...args)=>exec(process.execPath,[cli,...args],{windowsHide:true,timeout:30000});
 const beforeKey=await fs.readFile(path.join(home,'backup-key.dpapi')),phrase=randomBytes(32).toString('base64url');let source;
 await control('stop-api');await control('stop-db');
 try{
  source=await new Promise((resolve,reject)=>{
   const child=execFile(process.execPath,[self,'--source'],{env:{...process.env,LOCALAPPDATA:path.join(directory,'source-profile')},windowsHide:true,timeout:120000},(error,stdout)=>{if(error)reject(Error('Perfil de origem sintético falhou; logs privados preservados.'));else resolve(JSON.parse(stdout));});
   child.stdin.end(JSON.stringify({phrase,directory}));
  });
 }finally{await ensureLocalDatabase();await control('start-api');}
 assert.notEqual(source.deviceId,marker.deviceId);
 const owner=new pg.Client(await config(true));await owner.connect();
 try{
  const count=async()=>(await owner.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'ruy_d1_restore_%'")).rows[0].n;
  const before=await count();await assert.rejects(restoreWithRecovery(source.backupFile,source.keyFile,'FICTICIO frase errada longa'));assert.equal(await count(),before);
  const restored=await restoreWithRecovery(source.backupFile,source.keyFile,phrase);assert.equal(restored.recoveryKeyVerified,true);assert.equal(restored.activationBlocked,true);assert.ok(restored.recoveryTablesVerified>=12);
  const db=new pg.Client({...await config(true),database:restored.database});await db.connect();
  try{assert.equal((await db.query('SELECT id FROM lab_device WHERE singleton')).rows[0].id,source.deviceId);assert.equal((await db.query('SELECT 1 FROM lab_outbox WHERE operation_id=$1',[source.operationId])).rowCount,1);}finally{await db.end();}
  assert.equal(await fs.readFile(path.join(home,'restore-attachments',restored.database,'FICTICIO-H.txt'),'utf8'),'FICTICIO recuperação externa');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(await fs.readFile(path.join(home,'backup-key.dpapi'))),hash(beforeKey));
  assert.deepEqual(await productionWitness(),production);
  await fs.writeFile('logs/etapa-h-recovery.json',JSON.stringify({source,restored,destinationDevice:marker.deviceId,differentDeviceIds:true,sameWindowsHost:true,passwordNotPersisted:true,wrongPhraseCreatesNoDatabase:true,currentDPAPIUnchanged:true,productionPreserved:true,physicalIndependentDiskTested:false},null,2));
  console.log('H_RECOVERY_OK: foreign synthetic profile, portable encrypted key, retention, attachment/outbox restored; activation blocked.');
 }finally{await owner.end();}
}
