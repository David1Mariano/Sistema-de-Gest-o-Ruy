CREATE TABLE IF NOT EXISTS d1_principals (
 token_hash text PRIMARY KEY,device_id uuid NOT NULL,actor_id uuid NOT NULL,workspace_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,role text NOT NULL CHECK(role IN ('admin','viewer')),
 UNIQUE(device_id,actor_id)
);
CREATE TABLE IF NOT EXISTS d1_central_records (
 workspace_id uuid NOT NULL,entity text NOT NULL,id uuid NOT NULL,data jsonb NOT NULL,
 name_key text NOT NULL,version bigint NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,entity,name_key)
);
CREATE TABLE IF NOT EXISTS d1_central_receipts (
 operation_id uuid PRIMARY KEY,device_id uuid NOT NULL,actor_id uuid NOT NULL,
 workspace_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS d1_central_clock (singleton boolean PRIMARY KEY CHECK(singleton),cursor bigint NOT NULL);
INSERT INTO d1_central_clock VALUES(true,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS d1_central_changes (
 cursor bigint PRIMARY KEY,operation_id uuid NOT NULL UNIQUE,workspace_id uuid NOT NULL,
 device_id uuid NOT NULL,changes jsonb NOT NULL
);
