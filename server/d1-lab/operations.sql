CREATE TABLE IF NOT EXISTS d1_stock_balances (
 owner_id uuid NOT NULL REFERENCES lab_users,item_id uuid NOT NULL REFERENCES d2_catalog,
 quantity_milli bigint NOT NULL DEFAULT 0 CHECK(quantity_milli>=0),quota_milli bigint NOT NULL DEFAULT 0 CHECK(quota_milli>=0),
 average_cents bigint NOT NULL DEFAULT 0 CHECK(average_cents>=0),last_cents bigint NOT NULL DEFAULT 0 CHECK(last_cents>=0),
 version bigint NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,item_id)
);
CREATE TABLE IF NOT EXISTS d1_stock_movements (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES lab_users,operation_id uuid NOT NULL,item_id uuid NOT NULL,
 item_name text NOT NULL,unit text NOT NULL,quantity_milli bigint NOT NULL,unit_cents bigint NOT NULL,
 balance_after bigint NOT NULL,movement_type text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(operation_id,item_id)
);
CREATE TABLE IF NOT EXISTS d1_financial_accounts (
 owner_id uuid NOT NULL REFERENCES lab_users,account text NOT NULL,
 balance_cents bigint NOT NULL DEFAULT 0,version bigint NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,account)
);
CREATE TABLE IF NOT EXISTS d1_financial_entries (
 owner_id uuid NOT NULL REFERENCES lab_users,operation_id uuid NOT NULL,account text NOT NULL,cents bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(operation_id,account)
);
CREATE TABLE IF NOT EXISTS d1_operation_events (
 id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES lab_users,entity text NOT NULL CHECK(entity='OperationalEvent'),
 data jsonb NOT NULL,name_key text NOT NULL,version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(owner_id,entity,name_key)
);
