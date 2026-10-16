// Somente leitura; não imprime dados, hashes de senhas ou credenciais.
import {createHash} from 'node:crypto';
import {config,validateHome} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
const marker=await validateHome(),pool=poolFor(await config());
try{
 const hash=createHash('sha256'),counts={};
 const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const table of ['d1_records','d2_catalog','d1_rh_history','lab_outbox','lab_audit','d1_sync_binding','d1_sync_queue','d1_sync_versions','d1_sync_inbox','d1_sync_shadow','d1_stock_balances','d1_stock_movements','d1_financial_accounts','d1_financial_entries','d1_operation_events']){
   const rows=(await c.query(`SELECT to_jsonb(t)::text AS data FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
   hash.update(table);for(const row of rows)hash.update(row.data+'\n');counts[table]=rows.length;
  }
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 console.log(JSON.stringify({purpose:'D1_INSTALLATION_PRESERVATION',deviceId:marker.deviceId,sha256:hash.digest('hex'),counts}));
}finally{await pool.end();}
