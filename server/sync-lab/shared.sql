-- Laboratory only: apply exclusively in a newly created synthetic database.
CREATE TABLE shared_devices(
 device_id uuid PRIMARY KEY, workspace_id uuid NOT NULL,
 credential_hash text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true
);
CREATE TABLE shared_memberships(
 user_id uuid NOT NULL REFERENCES lab_users, workspace_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','viewer')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(user_id,workspace_id)
);
CREATE TABLE shared_sessions(
 token_hash text PRIMARY KEY REFERENCES d1_principals(token_hash) ON UPDATE CASCADE ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
