import fs from 'node:fs/promises';
import {config} from '../../server/d1-lab/environment.mjs';
import {pg} from '../../server/d1-lab/core.mjs';
const c=new pg.Client(await config(true));await c.connect();
try{
 await c.query('BEGIN');await c.query(await fs.readFile(new URL('../../server/d1-lab/operations.sql',import.meta.url),'utf8'));
 await c.query('GRANT SELECT,INSERT,UPDATE ON d1_stock_balances,d1_financial_accounts TO ruy_d1_app; GRANT SELECT,INSERT ON d1_stock_movements,d1_financial_entries,d1_operation_events TO ruy_d1_app');
 await c.query('COMMIT');console.log('Persistência operacional preparada somente no banco sintético D1.');
}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
