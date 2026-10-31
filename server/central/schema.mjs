import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const schemaFiles=['d1-lab/schema','d1-lab/identity','d1-lab/entities','d1-lab/catalog','d1-lab/sync','d1-lab/operations','d1-lab/domain','d1-lab/attachments','d1-lab/business','d1-lab/delivery','d1-lab/attendance','d1-lab/payroll','d1-lab/purchasing','d1-lab/settlements','sync-lab/d1-central','sync-lab/attachments','sync-lab/business','sync-lab/shared','central/schema'];
export async function schemaBundle(){const entries=await Promise.all(schemaFiles.map(async name=>({name,sql:await fs.readFile(new URL('../'+name+'.sql',import.meta.url),'utf8')})));return {entries,sha256:createHash('sha256').update(entries.map(e=>e.name+'\n'+e.sql).join('\n')).digest('hex')};}
// No automatic migrations on startup. This function provisions an empty target only.
export async function initializeCentralSchema(pool,{lab=false}={}){
 const c=await pool.connect();try{
  await c.query('BEGIN');const r=(await c.query("SELECT current_database() db,current_setting('port') port")).rows[0];
  if(lab?!(r.port==='55483'&&/^ruy_d1_rc_[a-f0-9]{16}$/.test(r.db)):!(r.port==='55516'&&r.db==='ruy_central_rc1_staging'))throw Error('CENTRAL_EMPTY_TARGET_REQUIRED');
  if(Number((await c.query("SELECT count(*) n FROM pg_tables WHERE schemaname='public'")).rows[0].n)!==0)throw Error('EXISTING_DATABASE_PRESERVED');
  if(!lab)await c.query("SET LOCAL ruy.initializing_installation='central-pichau-rc1'");
  const bundle=await schemaBundle();for(const e of bundle.entries)await c.query(e.sql.replace(/^(?:GRANT|REVOKE)[^;]*\bruy_d1_app\b[^;]*;/gm,''));
  await c.query('INSERT INTO central_deployment(singleton,purpose,schema_sha256,active) VALUES(true,$1,$2,false)',[lab?'RUY_CENTRAL_LAB':'RUY_CENTRAL_CONTROLLED',bundle.sha256]);await c.query('COMMIT');return bundle.sha256;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function grantCentralRuntime(c,role){
 if(!/^ruy_central_[a-f0-9]{16}$/.test(role))throw Error('CENTRAL_RUNTIME_ROLE_REQUIRED');
 await c.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
 const immutable=['lab_audit','d1_central_receipts','d1_central_changes','d1_attachment_objects','d1_attachment_receipts','d1_attachment_audit','d1_business_movements','d1_business_entries','d1_business_settlements','d1_business_reversals','d1_stock_movements','d1_financial_entries','d1_local_reversals','d1_rh_history','d1_attendance_history','d1_payroll_history','d1_purchase_history','d1_local_settlements','d1_local_settlement_reversals'];
 for(const table of immutable)await c.query(`REVOKE UPDATE,DELETE,TRUNCATE ON ${table} FROM ${role}`);
 await c.query(`REVOKE ALL ON central_deployment,central_history_binding,central_reconciliation,identity_bootstrap,shared_devices FROM ${role}; GRANT SELECT ON central_deployment,central_history_binding,central_reconciliation,identity_bootstrap,shared_devices TO ${role}`);
 // PostgreSQL FOR SHARE requires UPDATE on at least one column. Device rows
 // are locked during login/revocation; credential hashes remain non-writable.
 await c.query(`GRANT UPDATE(active) ON shared_devices TO ${role}`);
}
