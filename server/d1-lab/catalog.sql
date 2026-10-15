CREATE TABLE IF NOT EXISTS d2_catalog (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES lab_users,
 entity text NOT NULL CHECK(entity IN ('ExpenseCategory','Supplier','InventoryItem','SystemSettings')),
 data jsonb NOT NULL,name_key text NOT NULL,version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,entity,name_key)
);
