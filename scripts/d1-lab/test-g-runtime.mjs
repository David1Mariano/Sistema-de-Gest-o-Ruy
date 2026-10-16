import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateAccount,initializeLab,ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {backup,configureExternalBackup,backupConfig,restoreIsolated} from '../../server/d1-lab/backup.mjs';
import {home,validateHome} from '../../server/d1-lab/environment.mjs';

test('Primeira execução valida conta fictícia e preserva laboratório existente',async()=>{
 const marker=await validateHome();
 for(const account of [{login:'real@example.com',password:'FICTICIO-123456'},{login:'test@example.invalid',password:'short'},null])assert.throws(()=>validateAccount(account));
 const account={login:'test@example.invalid',password:'FICTICIO-123456'};validateAccount(account);
 await assert.rejects(initializeLab({account}));
 assert.deepEqual(await validateHome(),marker);
 assert.equal((await ensureLocalDatabase()).deviceId,marker.deviceId);
});

test('Backup externo configurável verifica bytes, mantém local em falha e não alega proteção independente',async()=>{
 await validateHome();
 const settings=path.join(home,'backup-settings.json');let original;
 try{original=await fs.readFile(settings);}catch(e){if(e.code!=='ENOENT')throw e;}
 const destination=path.resolve('artifacts','backup-g-'+randomUUID());await fs.mkdir(destination,{recursive:true});
 try{
  await assert.rejects(configureExternalBackup(path.join(home,'backups')));
  await configureExternalBackup(destination);
  const result=await backup();assert.equal(result.externalState,'verified-copy');assert.equal(result.externalProtected,false);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(await fs.readFile(result.externalFile)),result.sha256);
  assert.equal(sha(await fs.readFile(path.join(home,'backups',result.file))),result.sha256);
  const restored=await restoreIsolated(path.join(home,'backups',result.file));assert.ok(restored.recoveryTablesVerified>=12);
  await fs.writeFile(settings,JSON.stringify({...await backupConfig(),externalDirectory:path.join(destination,'FICTICIO-missing')}));
  const failed=await backup();assert.equal(failed.externalState,'error');assert.equal(failed.state,'local-only');await fs.access(path.join(home,'backups',failed.file));
  await configureExternalBackup(null);assert.equal((await backupConfig()).externalDirectory,null);
 }finally{if(original)await fs.writeFile(settings,original);else await fs.unlink(settings);}
});
