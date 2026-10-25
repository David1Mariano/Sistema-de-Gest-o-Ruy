-- New synthetic fixture ONLY; never applied to installed or historical databases.
DO $$ DECLARE old_definition text; BEGIN
 IF NOT ((current_setting('port')='55483' AND current_database() ~ '^ruy_d1_rc_[a-f0-9]{16}$') OR (current_setting('port')='55496' AND current_database()='ruy_d1_disposable' AND coalesce(current_setting('ruy.initializing_installation',true),'')='windows-operational')) THEN RAISE EXCEPTION 'New isolated payroll test database required'; END IF;
 SELECT pg_get_constraintdef(oid) INTO old_definition FROM pg_constraint WHERE conrelid='d2_catalog'::regclass AND conname='d2_catalog_entity_check';
 IF old_definition IS NULL THEN RAISE EXCEPTION 'Existing domain contract required'; END IF;
 ALTER TABLE d2_catalog DROP CONSTRAINT d2_catalog_entity_check;
 EXECUTE 'ALTER TABLE d2_catalog ADD CONSTRAINT d2_catalog_entity_check CHECK ('||substring(old_definition from 7)||' OR entity IN (''PayrollPolicy'',''PayrollRun''))';
END $$;
CREATE TABLE d1_payroll_history (
 owner_id uuid NOT NULL,record_id uuid NOT NULL,entity text NOT NULL,operation_id uuid NOT NULL,
 actor_id uuid NOT NULL,record_version bigint NOT NULL,action text NOT NULL,snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,record_id,operation_id)
);
GRANT SELECT,INSERT ON d1_payroll_history TO ruy_d1_app;
REVOKE UPDATE,DELETE ON d1_payroll_history FROM ruy_d1_app;
