CREATE TABLE identity(singleton boolean PRIMARY KEY CHECK(singleton),device_id uuid NOT NULL,actor_id uuid NOT NULL,workspace_id uuid NOT NULL);
CREATE TABLE records(id uuid PRIMARY KEY,data jsonb NOT NULL,local_version bigint NOT NULL,remote_version bigint,dirty boolean NOT NULL);
CREATE UNIQUE INDEX records_code ON records(upper(data->>'code'));
CREATE TABLE outbox(
 operation_id uuid PRIMARY KEY,record_id uuid NOT NULL,operation text NOT NULL,
 base_version bigint,payload jsonb NOT NULL,payload_hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','acknowledged','conflict','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz,lease_until timestamptz,
 receipt jsonb,error jsonb
);
CREATE TABLE inbox(cursor bigint PRIMARY KEY,operation_id uuid NOT NULL UNIQUE,source_device uuid NOT NULL,record_id uuid NOT NULL,received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shadow(record_id uuid PRIMARY KEY,version bigint NOT NULL,data jsonb NOT NULL);
CREATE TABLE sync_state(singleton boolean PRIMARY KEY CHECK(singleton),cursor bigint NOT NULL DEFAULT 0,last_sync_at timestamptz,last_error text);
INSERT INTO sync_state(singleton) VALUES(true);
