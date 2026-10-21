import {createHash} from 'node:crypto';
import {transaction} from './core.mjs';
// Snapshot import only. Never invokes a command handler, stock service or payment.
// Source is the independently verified recovery archive restored into a NEW DB.
export async function importOperationalHistory(pool,{principalId,expected=1186,failAfter=null}={}){
 if(!/^[a-f0-9-]{36}$/.test(principalId||''))throw Error('MIGRATION_PRINCIPAL_REQUIRED');
 return transaction(pool,async c=>{
  const target=(await c.query("SELECT current_database() db,current_setting('port') port")).rows[0];
  if(!/^ruy_operational_trial_[a-f0-9]{12}$/.test(target.db)||target.port!=='55463')throw Error('NEW_ISOLATED_OPERATIONAL_TRIAL_REQUIRED');
  const projects=(await c.query('SELECT DISTINCT project FROM history.batches')).rows;
  if(projects.length!==1||projects[0].project!=='wvcvveqdkecsoygtilop')throw Error('HISTORICAL_PROJECT_MISMATCH');
  await c.query('SELECT pg_advisory_xact_lock(810232)');
  if((await c.query('SELECT count(*)::int n FROM history.records')).rows[0].n!==expected)throw Error('HISTORICAL_SOURCE_COUNT_MISMATCH');
  await c.query(`CREATE TABLE IF NOT EXISTS historical_import_receipts (
   source_id uuid PRIMARY KEY,entity text NOT NULL,legacy_id text NOT NULL,source_sha256 text NOT NULL,
   target_table text NOT NULL,target_id uuid NOT NULL UNIQUE,imported_at timestamptz NOT NULL DEFAULT now(),UNIQUE(entity,legacy_id));
   CREATE TABLE IF NOT EXISTS historical_import_policy(singleton boolean PRIMARY KEY CHECK(singleton),mode text NOT NULL CHECK(mode='PREVIEW_ONLY'));
   INSERT INTO historical_import_policy VALUES(true,'PREVIEW_ONLY') ON CONFLICT DO NOTHING;`);
  const existing=Number((await c.query('SELECT count(*) FROM historical_import_receipts')).rows[0].count);
  if(existing){
   const mismatched=(await c.query(`SELECT count(*)::int n FROM history.records r LEFT JOIN historical_import_receipts p ON p.source_id=r.id WHERE p.source_id IS NULL OR p.source_sha256<>r.sha256 OR p.legacy_id<>r.legacy_id OR p.entity<>r.entity`)).rows[0].n;
   if(existing!==expected||mismatched)throw Error('MIGRATION_REPLAY_SOURCE_MISMATCH');
   const missing=(await c.query(`SELECT count(*)::int n FROM historical_import_receipts p LEFT JOIN d1_records r ON p.target_table='d1_records' AND r.id=p.target_id LEFT JOIN d2_catalog k ON p.target_table='d2_catalog' AND k.id=p.target_id WHERE r.id IS NULL AND k.id IS NULL`)).rows[0].n;
   if(missing)throw Error('MIGRATION_REPLAY_TARGET_MISMATCH');return {imported:0,existing,replay:true};
  }
  const populated=(await c.query('SELECT (SELECT count(*) FROM d1_records)+(SELECT count(*) FROM d2_catalog) n')).rows[0].n;
  if(Number(populated)!==0)throw Error('EMPTY_OPERATIONAL_TARGET_REQUIRED');
  // This is a technical inactive owner, not an imported AuthUser or a login account.
  await c.query("INSERT INTO lab_users(id,login,password_hash,role,active) VALUES($1,$2,'disabled:no-login','viewer',false)",[principalId,'migration-owner-'+principalId+'@invalid']);
  // Snapshot entities not writable by current operational command contracts remain visible only through authorized history views.
  await c.query(`ALTER TABLE d2_catalog DROP CONSTRAINT d2_catalog_entity_check;
   ALTER TABLE d2_catalog ADD CONSTRAINT d2_catalog_entity_check CHECK(entity IN (
    'FinancialExpense','EmployeePayment','Vale','Consumption','Absence','Warning','InventoryItem','StockMovement','ExpenseCategory','AccountsPayable','FechamentoCaixa','AuditLog'));`);
  const records=(await c.query('SELECT id,entity,legacy_id,raw_json,sha256 FROM history.records ORDER BY entity,legacy_id')).rows;
  const wrapped=new Set(['FinancialExpense','EmployeePayment','Vale','Consumption','AccountsPayable','FechamentoCaixa']);let n=0;
  for(const r of records){
   if(createHash('sha256').update(r.raw_json).digest('hex')!==r.sha256)throw Error('MIGRATION_SOURCE_INTEGRITY_FAILED');
   const table=['Employee','Sector','JobRole'].includes(r.entity)?'d1_records':'d2_catalog';
   // SQL preserves decimal precision. Legacy reference fields and values stay exact;
   // canonical relationships are kept separately in history.references.
   await c.query(`INSERT INTO ${table}(id,owner_id,entity,data,name_key,version,created_at,updated_at)
    SELECT id,$2,entity,CASE WHEN $3 THEN jsonb_build_object('payload_json',payload::text) ELSE payload END,
     'legacy:'||id,1,(raw_json::jsonb->>'created_date')::timestamptz,(raw_json::jsonb->>'updated_date')::timestamptz
    FROM history.records WHERE id=$1`,[r.id,principalId,wrapped.has(r.entity)]);
   await c.query('INSERT INTO historical_import_receipts(source_id,entity,legacy_id,source_sha256,target_table,target_id) VALUES($1,$2,$3,$4,$5,$1)',[r.id,r.entity,r.legacy_id,r.sha256,table]);
   if(++n===failAfter)throw Error('INJECTED_MIGRATION_ROLLBACK');
  }
  // All imported documents are immutable in this rehearsal, including master data.
  await c.query(`CREATE OR REPLACE FUNCTION historical_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF EXISTS(SELECT 1 FROM historical_import_receipts WHERE target_id=OLD.id) THEN RAISE EXCEPTION 'Historical snapshot is read only' USING ERRCODE='42501'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER historical_record_guard BEFORE UPDATE OR DELETE ON d1_records FOR EACH ROW EXECUTE FUNCTION historical_document_guard();
   CREATE TRIGGER historical_catalog_guard BEFORE UPDATE OR DELETE ON d2_catalog FOR EACH ROW EXECUTE FUNCTION historical_document_guard();
   REVOKE ALL ON historical_import_receipts,historical_import_policy FROM PUBLIC,ruy_d1_app;
   GRANT SELECT ON historical_import_receipts TO ruy_d1_app;`);
  return {imported:n,existing:0,replay:false};
 });
}
