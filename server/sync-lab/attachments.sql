-- Apply only to a new, explicitly marked synthetic fixture. No startup migration.
CREATE TABLE d1_attachment_objects (
 workspace_id uuid NOT NULL,id uuid NOT NULL,record_id uuid NOT NULL,entity text NOT NULL,
 filename text NOT NULL,media_type text NOT NULL,sha256 text NOT NULL,
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 524288),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,record_id) REFERENCES d1_central_records(workspace_id,id)
);
CREATE TABLE d1_attachment_receipts (
 operation_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,device_id uuid NOT NULL,
 payload_hash text NOT NULL,result jsonb NOT NULL
);
CREATE TABLE d1_attachment_audit (
 id bigserial PRIMARY KEY,workspace_id uuid NOT NULL,actor_id uuid NOT NULL,
 object_id uuid NOT NULL,action text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
