-- RC2 new synthetic fixtures only.
CREATE TABLE d1_business_local (
 actor uuid PRIMARY KEY REFERENCES lab_users,workspace uuid NOT NULL,head bigint NOT NULL,
 state jsonb NOT NULL,applied boolean NOT NULL
);

CREATE TABLE d1_local_reversals(owner_id uuid NOT NULL,reference uuid NOT NULL,operation uuid NOT NULL,reason text NOT NULL,PRIMARY KEY(owner_id,reference),UNIQUE(operation));
CREATE TABLE d1_reconciliation(id uuid PRIMARY KEY,actor uuid NOT NULL,plan_hash text NOT NULL,reason text NOT NULL,archive jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
