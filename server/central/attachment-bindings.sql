-- Append-only field associations; original files and business records are untouched.
CREATE TABLE IF NOT EXISTS d1_attachment_bindings (
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,record_id uuid NOT NULL,
 field text NOT NULL CHECK(field IN ('document_url','proof_url','invoice_url','file_url','photo_url','attachment_url')),
 object_id uuid NOT NULL,live_object_id uuid,history_dataset text,actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,record_id) REFERENCES d1_attachment_targets(workspace_id,record_id),
 FOREIGN KEY(workspace_id,live_object_id) REFERENCES d1_attachment_objects(workspace_id,id),
 CHECK ((live_object_id IS NOT NULL AND live_object_id=object_id AND history_dataset IS NULL) OR
        (live_object_id IS NULL AND history_dataset IS NOT NULL AND history_dataset ~ '^[a-f0-9]{64}$'))
);
CREATE INDEX IF NOT EXISTS d1_attachment_bindings_record ON d1_attachment_bindings(workspace_id,record_id,field,created_at DESC);
