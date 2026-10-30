CREATE TABLE principals(token_hash text PRIMARY KEY,device_id uuid NOT NULL UNIQUE,actor_id uuid NOT NULL,workspace_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,can_read boolean NOT NULL DEFAULT true,can_write boolean NOT NULL DEFAULT true);
CREATE TABLE records(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,data jsonb NOT NULL,version bigint NOT NULL);
CREATE UNIQUE INDEX records_code ON records(workspace_id,upper(data->>'code'));
CREATE TABLE receipts(operation_id uuid PRIMARY KEY,device_id uuid NOT NULL,actor_id uuid NOT NULL,workspace_id uuid NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE change_clock(singleton boolean PRIMARY KEY CHECK(singleton),cursor bigint NOT NULL);
INSERT INTO change_clock VALUES(true,0);
CREATE TABLE changes(cursor bigint PRIMARY KEY,operation_id uuid NOT NULL UNIQUE,device_id uuid NOT NULL,workspace_id uuid NOT NULL,record_id uuid NOT NULL,version bigint NOT NULL,data jsonb NOT NULL);
