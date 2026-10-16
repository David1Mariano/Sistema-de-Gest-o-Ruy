import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {initializeLab,ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {config,home,cluster,validateHome,pgCommand} from '../../server/d1-lab/environment.mjs';
import {poolFor,pg} from '../../server/d1-lab/core.mjs';
import {save} from '../../server/d1-lab/entities.mjs';
import {productionWitness} from './production-witness.mjs';
const exec=promisify(execFile),self=fileURLToPath(import.meta.url),cli=fileURLToPath(new URL('../d1-lab.mjs',import.meta.url));
if(process.argv.includes('--child')){
 const result=await initializeLab({account:{login:'homologacao@example.invalid',password:randomBytes(24).toString('hex')}});
 const marker=await validateHome();let pool=poolFor(await config());
 try{
  const actor=(await pool.query("SELECT id,role FROM lab_users WHERE login='homologacao@example.invalid'")).rows[0];
  const id=randomUUID(),command={operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO Primeiro cadastro G',status:'ativo'}};
  await save(pool,actor,marker.deviceId,'Sector',id,command);
  await assert.rejects(pool.query("UPDATE d1_rh_history SET action='adulterado'"),e=>e.code==='42501');
  await pool.end();pool=null;
  // Fixture de versão anterior somente neste perfil recém-criado, sem histórico RH.
  const owner=new pg.Client(await config(true));await owner.connect();
  try{assert.equal((await owner.query('SELECT count(*)::int n FROM d1_rh_history')).rows[0].n,0);await owner.query('DROP TABLE d1_rh_history');}finally{await owner.end();}
  pgCommand(marker.bin,'pg_ctl',['-D',cluster,'-m','fast','-w','stop']);
  assert.equal((await ensureLocalDatabase()).started,true);
  pool=poolFor(await config());
  assert.ok((await pool.query("SELECT to_regclass('public.d1_rh_history') AS name")).rows[0].name);
  assert.equal((await pool.query('SELECT 1 FROM lab_outbox WHERE operation_id=$1',[command.operationId])).rowCount,1);
  assert.equal((await save(pool,actor,marker.deviceId,'Sector',id,command)).replay,true);
  await assert.rejects(initializeLab());
  const sealedOwner=await fs.readFile(path.join(home,'owner.dpapi'),'utf8');assert.equal(sealedOwner.includes('ruy_d1_owner'),false);
  console.log(JSON.stringify({freshProfile:true,sameWindowsHost:true,created:result.created,syntheticRecordPersisted:true,pendingQueuePersisted:true,postgresRestarted:true,schemaUpgradeWithoutRowLoss:true,credentialsDPAPI:true,historyAppendOnly:true}));
 }finally{await pool?.end();pgCommand(marker.bin,'pg_ctl',['-D',cluster,'-m','fast','-w','stop']);}
}else{
 if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório: pausa somente laboratório D1.');
 const before=await productionWitness(),profile=path.resolve('artifacts','g-profile-'+randomUUID());
 const control=(...args)=>exec(process.execPath,[cli,...args],{windowsHide:true,timeout:30000});
 await control('stop-api');await control('stop-db');
 try{
  const child=await exec(process.execPath,[self,'--child'],{env:{...process.env,LOCALAPPDATA:profile},windowsHide:true,timeout:120000,maxBuffer:100000});
  const evidence=JSON.parse(child.stdout.trim());assert.deepEqual(await productionWitness(),before);
  await fs.writeFile('logs/etapa-g-bootstrap.json',JSON.stringify({...evidence,profile,productionPreserved:true},null,2));
  console.log('G_BOOTSTRAP_OK: fresh profile, real PostgreSQL restart, queue and DPAPI; same Windows host.');
 }finally{await control('start-db');await control('start-api');}
}
