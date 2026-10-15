-- ETAPA B: somente no cluster descartável validado pelo instalador.
CREATE TABLE lab_device (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id uuid NOT NULL UNIQUE);
CREATE TABLE lab_users (
 id uuid PRIMARY KEY, login text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','writer','viewer')), active boolean NOT NULL DEFAULT true
);
CREATE TABLE lab_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES lab_users,
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE lab_attempts (address text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE lab_notes (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES lab_users,
 data jsonb NOT NULL, version bigint NOT NULL DEFAULT 1, deleted boolean NOT NULL DEFAULT false
);
CREATE TABLE lab_outbox (
 operation_id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES lab_device(id),
 actor uuid NOT NULL REFERENCES lab_users, record_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('create','update','delete')),
 base_version bigint, payload_hash text NOT NULL, payload jsonb NOT NULL,
 result jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state='pending'),
 created_at timestamptz NOT NULL DEFAULT now(),
 entity text NOT NULL DEFAULT 'LabNote', record_version bigint NOT NULL,
 confirmed_at timestamptz, protocol_version integer NOT NULL DEFAULT 1
);
CREATE TABLE lab_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid REFERENCES lab_users,
 action text NOT NULL, operation_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
