-- Only new isolated databases. No installed database is upgraded implicitly.
DO $$ BEGIN
 IF NOT ((current_setting('port')='55483' AND current_database() ~ '^ruy_d1_rc_[a-f0-9]{16}$') OR (current_setting('port')='55496' AND current_database()='ruy_d1_disposable' AND coalesce(current_setting('ruy.initializing_installation',true),'')='windows-operational')) THEN
  RAISE EXCEPTION 'New settlement fixture required';
 END IF;
END $$;
CREATE TABLE d1_local_settlements (
 owner_id uuid NOT NULL REFERENCES lab_users,entity text NOT NULL CHECK(entity IN ('PayrollRun','DeliveryOrder')),
 record_id uuid NOT NULL,operation_id uuid NOT NULL UNIQUE,ledger_id uuid NOT NULL UNIQUE,
 document_id uuid NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),
 account text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,entity,record_id)
);
CREATE TABLE d1_local_settlement_reversals (
 owner_id uuid NOT NULL,entity text NOT NULL,record_id uuid NOT NULL,operation_id uuid NOT NULL UNIQUE,
 ledger_id uuid NOT NULL UNIQUE,reason text NOT NULL CHECK(length(reason) BETWEEN 8 AND 300),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,entity,record_id),
 FOREIGN KEY(owner_id,entity,record_id) REFERENCES d1_local_settlements(owner_id,entity,record_id)
);
GRANT SELECT,INSERT ON d1_local_settlements,d1_local_settlement_reversals TO ruy_d1_app;
REVOKE UPDATE,DELETE ON d1_local_settlements,d1_local_settlement_reversals FROM ruy_d1_app;
