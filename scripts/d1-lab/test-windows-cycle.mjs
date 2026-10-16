import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {allowedNavigation,webPreferences} from '../../desktop/policy.mjs';
import {syncState} from '../../lab/d1/sync-state.mjs';
import {backup,restoreIsolated,encryptArchive,decryptArchive} from '../../server/d1-lab/backup.mjs';
import {home,validateHome,config} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {save} from '../../server/d1-lab/entities.mjs';

test('Desktop: somente origem D1, sem Node, sem webview, sandbox ativo',()=>{
 for(const value of ['https://example.invalid','http://127.0.0.1:8080/','http://127.0.0.1:18087.evil.invalid/','file:///C:/Windows/system.ini','javascript:alert(1)','http://user:pass@127.0.0.1:18087/'])assert.equal(allowedNavigation(value),false);
 assert.equal(allowedNavigation('http://127.0.0.1:18087/setores'),true);
 assert.equal(webPreferences.nodeIntegration,false);assert.equal(webPreferences.contextIsolation,true);assert.equal(webPreferences.sandbox,true);assert.equal(webPreferences.webviewTag,false);
});
test('Indicador: zero pendências não implica sucesso; verde exige recibos e cursor',()=>{
 assert.equal(syncState(null),'unknown');
 assert.equal(syncState({pending:0}),'unknown');
 assert.equal(syncState({enabled:false,pending:0,lastSyncAt:new Date().toISOString(),receiptsVerified:true,pullComplete:true,cursor:0}),'unknown');
 assert.equal(syncState({pending:1}),'pending');assert.equal(syncState({pendingFiles:1}),'pending');
 assert.equal(syncState({sending:1}),'syncing');assert.equal(syncState({conflicts:1}),'error');assert.equal(syncState({lastError:'sem rede'}),'error');
 const complete={mode:'operational',operationalSyncEnabled:true,enabled:true,pending:0,sending:0,conflicts:0,rejected:0,pendingFiles:0,lastSyncAt:new Date().toISOString(),receiptsVerified:true,pullComplete:true,cursor:3};
 assert.equal(syncState(complete),'confirmed');assert.equal(syncState({...complete,receiptsVerified:false}),'unknown');
});
test('Backup: autenticação criptográfica recusa corrupção, chave errada e texto aberto',()=>{
 const key=randomBytes(32),archive={purpose:'RUY_D1_SYNTHETIC_BACKUP',version:1,dump:'',dumpHash:'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',attachments:[],pending:[]};
 const bytes=encryptArchive(archive,key);assert.deepEqual(decryptArchive(bytes,key),archive);
 assert.equal(bytes.includes(Buffer.from('SYNTHETIC_BACKUP')),false);
 const corrupted=Buffer.from(bytes);corrupted[25]^=1;
 assert.throws(()=>decryptArchive(corrupted,key));assert.throws(()=>decryptArchive(bytes,randomBytes(32)));assert.throws(()=>decryptArchive(Buffer.from('{}'),key));
});
test('D1.1: replay com impacto adulterado é recusado sem duplicar operação',async()=>{
 const pool=poolFor(await config()),marker=await validateHome();
 try{
  const user={id:randomUUID(),role:'writer'};
  await pool.query('INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,$4)',[user.id,user.id+'@example.invalid',await hashPassword(randomBytes(24).toString('hex')),user.role]);
  const id=randomUUID(),body={operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO Replay '+id,status:'ativo'}};
  await save(pool,user,marker.deviceId,'Sector',id,body);
  const update={operationId:randomUUID(),operation:'update',baseVersion:1,confirmRename:true,renameImpact:{colaboradores:0,funcoes:0},data:{name:'FICTICIO Renomeado '+id}};
  await save(pool,user,marker.deviceId,'Sector',id,update);
  await assert.rejects(save(pool,user,marker.deviceId,'Sector',id,{...update,renameImpact:{colaboradores:1,funcoes:0}}),e=>e.status===409);
  assert.equal((await pool.query('SELECT count(*)::int n FROM lab_outbox WHERE operation_id=$1',[update.operationId])).rows[0].n,1);
 }finally{await pool.end();}
});
test('Backup real: dump consistente, anexo sintético e fila restaurados em outro banco',async()=>{
 await validateHome();const dir=path.join(home,'attachments');await fs.mkdir(dir,{recursive:true});
 const name='FICTICIO-'+randomUUID()+'.txt',bytes=Buffer.from('FICTICIO anexo para restauração');
 await fs.writeFile(path.join(dir,name),bytes,{flag:'wx'});
 const result=await backup({retain:24});
 assert.equal(result.externalProtected,false);assert.equal(result.state,'local-only');
 const restored=await restoreIsolated(path.join(home,'backups',result.file));
 assert.equal(restored.pendingOperations,result.pendingOperations);assert.ok(restored.attachments>=1);assert.equal(restored.syncEnabled,false);
 assert.deepEqual(await fs.readFile(path.join(home,'restore-attachments',restored.database,name)),bytes);
});
