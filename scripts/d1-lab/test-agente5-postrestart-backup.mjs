import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {home,config,DB_PORT,validateHome} from '../../server/d1-lab/environment.mjs';
import {backup,restoreIsolated,backupConfig} from '../../server/d1-lab/backup.mjs';
const marker=await validateHome();
if(DB_PORT!==55437||!marker.restartFixture||process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Only the dedicated copied restart fixture is permitted.');
const settings=await backupConfig();if(settings.externalDirectory)throw Error('External destination outside this test.');
await fs.mkdir(path.join(home,'backups'),{recursive:true});
if((await fs.readdir(path.join(home,'backups'))).filter(n=>n.endsWith('.ruybak')).length>=365)throw Error('Retention would remove existing backups.');
const name='FICTICIO-postrestart-'+randomUUID()+'.txt',bytes=Buffer.from('FICTICIO attachment after PostgreSQL restart');
await fs.mkdir(path.join(home,'attachments'),{recursive:true});await fs.writeFile(path.join(home,'attachments',name),bytes,{flag:'wx'});
const before=new pg.Client(await config());await before.connect();
let canaries;
try{canaries=(await before.query("SELECT id,owner_id,data,version,deleted FROM lab_notes WHERE data->>'name'='FICTICIO PostgreSQL restart canary' ORDER BY id")).rows;assert.ok(canaries.length>0);}finally{await before.end();}
const result=await backup({retain:365}),restored=await restoreIsolated(path.join(home,'backups',result.file));
assert.equal(restored.syncEnabled,false);
assert.deepEqual(await fs.readFile(path.join(home,'restore-attachments',restored.database,name)),bytes);
const client=new pg.Client({...await config(true),database:restored.database});await client.connect();
try{assert.deepEqual((await client.query("SELECT id,owner_id,data,version,deleted FROM lab_notes WHERE data->>'name'='FICTICIO PostgreSQL restart canary' ORDER BY id")).rows,canaries);}finally{await client.end();}
const report={fixture:marker.restartFixture,port:DB_PORT,...restored,syntheticCanariesRestored:canaries.length,attachmentVerified:true,attachmentSHA256:createHash('sha256').update(bytes).digest('hex'),file:result.file,existingBackupsPreserved:true};
await fs.writeFile('logs/agente5-postrestart-backup.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
