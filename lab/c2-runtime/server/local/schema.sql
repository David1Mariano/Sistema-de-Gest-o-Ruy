-- Development only. No remote migration or import.
CREATE TABLE local_users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','super_admin','gerente','producao','operator','viewer')), active boolean NOT NULL DEFAULT true,
 remote_identity text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE local_sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES local_users(id),
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE local_records (
 entity text NOT NULL, id text NOT NULL, data jsonb NOT NULL,
 version bigint NOT NULL DEFAULT 1, deleted boolean NOT NULL DEFAULT false,
 created_date timestamptz NOT NULL DEFAULT now(), updated_date timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(entity,id)
);
CREATE TABLE local_pending (
 operation_id uuid PRIMARY KEY, entity text NOT NULL, record_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('create','update','delete')),
 base_version bigint, payload jsonb NOT NULL, author uuid NOT NULL REFERENCES local_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','synced','conflict','failed'))
);
CREATE TABLE local_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid REFERENCES local_users(id),
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE local_activation (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), administrator uuid NOT NULL REFERENCES local_users(id),
 confirmed_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
