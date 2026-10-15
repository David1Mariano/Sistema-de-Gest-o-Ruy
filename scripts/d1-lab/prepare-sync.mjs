import fs from 'node:fs/promises';
import {config as localConfig} from '../../server/d1-lab/environment.mjs';
import {config as centralConfig} from '../../server/sync-lab/environment.mjs';
import {pg} from '../../server/d1-lab/core.mjs';
for(const [config,file,grants] of [
 [await localConfig(true),new URL('../../server/d1-lab/sync.sql',import.meta.url),'GRANT SELECT,INSERT,UPDATE ON d1_sync_binding,d1_sync_queue,d1_sync_versions,d1_sync_inbox,d1_sync_shadow TO ruy_d1_app'],
 [await centralConfig('central',true),new URL('../../server/sync-lab/d1-central.sql',import.meta.url),'GRANT SELECT ON d1_principals TO ruy_c2_central_app; GRANT SELECT,INSERT ON d1_central_records,d1_central_receipts,d1_central_changes TO ruy_c2_central_app; GRANT UPDATE ON d1_central_records,d1_central_clock TO ruy_c2_central_app; GRANT SELECT ON d1_central_clock TO ruy_c2_central_app'],
]){
 const db=new pg.Client(config);await db.connect();
 try{await db.query('BEGIN');await db.query(await fs.readFile(file,'utf8'));await db.query(grants);await db.query('COMMIT');}
 catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
}
console.log('Ponte D1/C2 preparada somente nos bancos marcados de laboratório. Nenhum usuário habilitado automaticamente.');
