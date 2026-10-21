-- Explicit opt-in provisioning, exclusively in a newly created isolated database.
CREATE TABLE identity_accounts (
 user_id uuid PRIMARY KEY REFERENCES lab_users, full_name text NOT NULL,
 verified_at timestamptz, approved_at timestamptz, approved_by uuid REFERENCES lab_users,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_codes (
 user_id uuid NOT NULL REFERENCES lab_users, purpose text NOT NULL CHECK(purpose IN ('verify','reset')),
 code_hash text NOT NULL, expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0,
 sent_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz,
 PRIMARY KEY(user_id,purpose)
);
CREATE TABLE identity_bootstrap (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), token_hash text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
REVOKE ALL ON identity_bootstrap FROM PUBLIC,ruy_d1_app;
GRANT SELECT,UPDATE ON identity_bootstrap TO ruy_d1_app;
GRANT SELECT,INSERT,UPDATE ON identity_accounts,identity_codes TO ruy_d1_app;
