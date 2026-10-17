-- Proposal only: execute exclusively in a new isolated database after review.
CREATE SCHEMA ruy_finance;
CREATE TABLE ruy_finance.record (
  entity text NOT NULL CHECK (entity IN ('CashMovement','DailyFinancialClose','FinancialExpense','FinancialAccount','AccountsPayable','AccountsReceivable','CardReceivable','Revenue','ExpenseCategory','FechamentoCaixa','Sangria','CostCenter','DeliverySettlement','ManualReconciliation','RecurringExpense')),
  id text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  version integer NOT NULL DEFAULT 1,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity,id)
);
CREATE TABLE ruy_finance.operation (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL
);
CREATE TABLE ruy_finance.audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id text NOT NULL REFERENCES ruy_finance.operation(id),
  actor_id text NOT NULL,
  entity text NOT NULL,
  record_id text NOT NULL,
  before_data jsonb,
  after_data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ruy_finance.relationship (
  entity text NOT NULL,
  record_id text NOT NULL,
  field text NOT NULL,
  target_entity text NOT NULL,
  target_id text NOT NULL,
  PRIMARY KEY(entity,record_id,field),
  FOREIGN KEY(entity,record_id) REFERENCES ruy_finance.record(entity,id),
  FOREIGN KEY(target_entity,target_id) REFERENCES ruy_finance.record(entity,id)
);
-- Runtime role must receive SELECT/INSERT/UPDATE on record, SELECT/INSERT on
-- operation/audit, SELECT/INSERT/DELETE on relationship and sequence USAGE.
-- Never grant DELETE on record or UPDATE/DELETE on operation/audit.
