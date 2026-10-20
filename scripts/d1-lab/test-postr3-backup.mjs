import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {installation,home,config} from '../../server/d1-lab/environment.mjs';
import {backup,restoreIsolated} from '../../server/d1-lab/backup.mjs';
import {stopStartedDatabase} from '../../server/d1-lab/database-stop.mjs';
import {ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
assert.equal(installation?.id,'i5r4-dev-20261020');
const snapshot=async()=>{const client=new pg.Client(await config());await client.connect();try{return (await client.query('SELECT id,body,state FROM d1_attachment_queue ORDER BY id')).rows;}finally{await client.end();}};
const before=await snapshot();assert.ok(before.length>0);
await stopStartedDatabase();await ensureLocalDatabase();assert.deepEqual(await snapshot(),before);
const file=await backup({preserveExisting:true});const recovered=await restoreIsolated(path.join(home,'backups',file.file));
const client=new pg.Client({...await config(true),database:recovered.database});await client.connect();
try{
 const restored=(await client.query('SELECT id,body,state FROM d1_attachment_queue ORDER BY id')).rows;assert.deepEqual(restored,before);
 for(const row of restored)assert.equal(createHash('sha256').update(Buffer.from(row.body.bytes,'base64')).digest('hex'),row.body.sha256);
}finally{await client.end();}
await fs.writeFile('logs/i5r4-dev/persistence-backup.json',JSON.stringify({controlledRestartPersistence:true,encryptedBackupRestore:true,attachmentQueueAndHashesVerified:before.length,recoveryTablesVerified:recovered.recoveryTablesVerified,restoreDatabase:recovered.database,port:installation.dbPort,existingBackupsPreserved:true,operationalSyncEnabled:false},null,2));
await stopStartedDatabase();console.log('POSTR3_RESTART_BACKUP_RESTORE_OK');
