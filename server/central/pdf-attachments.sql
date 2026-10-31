-- Additive attachment metadata only. No recovered record or file is rewritten.
CREATE TABLE IF NOT EXISTS d1_attachment_targets (
 workspace_id uuid NOT NULL,record_id uuid NOT NULL,entity text NOT NULL,
 live_record_id uuid,history_dataset text,
 PRIMARY KEY(workspace_id,record_id),
 FOREIGN KEY(workspace_id,live_record_id) REFERENCES d1_central_records(workspace_id,id),
 CHECK ((live_record_id IS NOT NULL AND live_record_id=record_id AND history_dataset IS NULL) OR
        (live_record_id IS NULL AND history_dataset IS NOT NULL AND history_dataset ~ '^[a-f0-9]{64}$'))
);
ALTER TABLE d1_attachment_targets DROP CONSTRAINT IF EXISTS d1_attachment_targets_check;
ALTER TABLE d1_attachment_targets ADD CONSTRAINT d1_attachment_targets_check CHECK
 ((live_record_id IS NOT NULL AND live_record_id=record_id AND history_dataset IS NULL) OR
  (live_record_id IS NULL AND history_dataset IS NOT NULL AND history_dataset ~ '^[a-f0-9]{64}$'));
INSERT INTO d1_attachment_targets(workspace_id,record_id,entity,live_record_id)
 SELECT DISTINCT workspace_id,record_id,entity,record_id FROM d1_attachment_objects
 ON CONFLICT DO NOTHING;
ALTER TABLE d1_attachment_objects DROP CONSTRAINT IF EXISTS d1_attachment_objects_workspace_id_record_id_fkey;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='d1_attachment_objects'::regclass AND conname='d1_attachment_target_fk') THEN
  ALTER TABLE d1_attachment_objects ADD CONSTRAINT d1_attachment_target_fk
   FOREIGN KEY(workspace_id,record_id) REFERENCES d1_attachment_targets(workspace_id,record_id);
 END IF;
END $$;
ALTER TABLE d1_attachment_objects DROP CONSTRAINT IF EXISTS d1_attachment_objects_bytes_check;
ALTER TABLE d1_attachment_objects ADD CONSTRAINT d1_attachment_objects_bytes_check CHECK(octet_length(bytes) BETWEEN 1 AND 15728640);
