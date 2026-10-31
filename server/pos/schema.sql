-- POS integration schema (isolated dev). Do not run in production without approval.
CREATE TABLE IF NOT EXISTS pos_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  terminal_code TEXT UNIQUE NOT NULL,
  name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  token_hash TEXT UNIQUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pos_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, sku)
);

CREATE TABLE IF NOT EXISTS pos_orders (
  id UUID PRIMARY KEY,
  workspace_id UUID,
  device_id UUID REFERENCES pos_devices(id),
  operator_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  sync_status TEXT NOT NULL DEFAULT 'RECEIVED',
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BRL',
  items JSONB NOT NULL,
  meta JSONB,
  stone_transaction_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT pos_orders_payment_status_check CHECK (payment_status IN ('UNPAID','PENDING','PAID','REFUSED','CANCELLED','REFUNDED','UNKNOWN')),
  CONSTRAINT pos_orders_status_check CHECK (status IN ('RECEIVED','CONFIRMED','CANCELLED','REFUNDED'))
);

CREATE INDEX IF NOT EXISTS idx_pos_orders_device_id ON pos_orders(device_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_received_at ON pos_orders(received_at);
CREATE INDEX IF NOT EXISTS idx_pos_catalog_workspace_active ON pos_catalog(workspace_id, active);
