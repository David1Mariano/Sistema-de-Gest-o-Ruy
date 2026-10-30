import {config} from '../../server/d1-lab/environment.mjs';
import fs from 'node:fs/promises';
import {pg} from '../../server/d1-lab/core.mjs';
// Somente cluster D1: configuração valida host/porta/database/marker/DPAPI.
const db=new pg.Client(await config(true));await db.connect();
try{
 await db.query('BEGIN');
 await db.query(await fs.readFile(new URL('../../server/d1-lab/catalog.sql',import.meta.url),'utf8'));
 await db.query('GRANT SELECT,INSERT,UPDATE ON d2_catalog TO ruy_d1_app');
 await db.query('COMMIT');console.log('Catálogos sintéticos preparados somente no D1.');
}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
