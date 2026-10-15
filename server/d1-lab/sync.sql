-- Sidecar: a outbox/auditoria originais continuam append-only e preservadas.
CREATE TABLE IF NOT EXISTS d1_sync_binding (
 actor uuid PRIMARY KEY REFERENCES lab_users,device_id uuid NOT NULL,workspace_id uuid NOT NULL,
 cursor bigint NOT NULL DEFAULT 0,last_sync_at timestamptz,last_error text,pull_complete boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS d1_sync_queue (
 operation_id uuid PRIMARY KEY REFERENCES lab_outbox,
 state text NOT NULL CHECK(state IN ('pending','sending','acknowledged','conflict','rejected')),
 envelope jsonb,lease_until timestamptz,receipt jsonb,error text,confirmed_at timestamptz
);
CREATE TABLE IF NOT EXISTS d1_sync_versions (
 actor uuid NOT NULL REFERENCES lab_users,record_id uuid NOT NULL,entity text NOT NULL,
 remote_version bigint NOT NULL,local_version bigint NOT NULL,PRIMARY KEY(actor,record_id)
);
CREATE TABLE IF NOT EXISTS d1_sync_inbox (
 actor uuid NOT NULL REFERENCES lab_users,cursor bigint NOT NULL,operation_id uuid NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor,cursor),UNIQUE(actor,operation_id)
);
CREATE TABLE IF NOT EXISTS d1_sync_shadow (
 actor uuid NOT NULL REFERENCES lab_users,record_id uuid NOT NULL,entity text NOT NULL,
 remote_version bigint NOT NULL,data jsonb NOT NULL,PRIMARY KEY(actor,record_id)
);
CREATE INDEX IF NOT EXISTS d1_sync_actor_operations ON lab_outbox(actor,created_at,operation_id);
CREATE INDEX IF NOT EXISTS d1_sync_audit_order ON lab_audit(operation_id,id);
