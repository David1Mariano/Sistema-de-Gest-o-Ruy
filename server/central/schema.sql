-- Existing shared policies reserve writes for admin and already project
-- writer/viewer reads. Identity-approved writers must also be able to log in.
-- This bundle is applied exclusively while provisioning an EMPTY central.
ALTER TABLE d1_principals DROP CONSTRAINT d1_principals_role_check;
ALTER TABLE d1_principals ADD CONSTRAINT d1_principals_role_check CHECK(role IN ('admin','writer','viewer'));
CREATE TABLE central_deployment(singleton boolean PRIMARY KEY CHECK(singleton),purpose text NOT NULL CHECK(purpose IN ('RUY_CENTRAL_LAB','RUY_CENTRAL_CONTROLLED')),schema_sha256 text NOT NULL,active boolean NOT NULL DEFAULT false,maintenance boolean NOT NULL DEFAULT true);
CREATE TABLE central_history_binding(workspace_id uuid PRIMARY KEY,dataset_sha256 text NOT NULL,records integer NOT NULL,attachments integer NOT NULL);
CREATE TABLE central_reconciliation(id uuid PRIMARY KEY,workspace_id uuid NOT NULL,category text NOT NULL CHECK(category IN ('attachment','reference','stock-opening','financial-opening')),source_sha256 text NOT NULL,evidence jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),approved_by uuid REFERENCES lab_users,approved_at timestamptz);
REVOKE ALL ON central_deployment,central_history_binding,central_reconciliation FROM PUBLIC;
-- Provisioning is an owner-only operation. The API never initializes/migrates SQL.
