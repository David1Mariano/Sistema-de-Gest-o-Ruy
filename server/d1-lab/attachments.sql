-- New synthetic fixture only. Never installed automatically on existing databases.
CREATE TABLE d1_attachment_queue (
 actor uuid NOT NULL,id uuid NOT NULL,operation_id uuid UNIQUE NOT NULL,
 body jsonb NOT NULL,payload_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','acknowledged','conflict','rejected')),
 receipt jsonb,PRIMARY KEY(actor,id)
);
CREATE TABLE d1_attachment_cache (
 actor uuid NOT NULL,id uuid NOT NULL,record_id uuid NOT NULL,entity text NOT NULL,
 sha256 text NOT NULL,bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 524288),
 PRIMARY KEY(actor,id)
);
