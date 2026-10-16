-- Execute only through the marked, synthetic D1 environment configuration.
-- This extends a CHECK without rewriting, replacing or deleting any row.
ALTER TABLE d2_catalog DROP CONSTRAINT IF EXISTS d2_catalog_entity_check;
ALTER TABLE d2_catalog ADD CONSTRAINT d2_catalog_entity_check CHECK(entity IN (
 'ExpenseCategory','Supplier','InventoryItem','SystemSettings',
 'ProductionProduct','ProductionOrder','DailyProduction','FinancialExpense',
 'EmployeePayment','Revenue','AccountsPayable','FinancialAccount','CostCenter',
 'Sangria','CashMovement','FechamentoCaixa','AccountsReceivable','CardReceivable',
 'DeliverySettlement','ManualReconciliation','MachineRotation','RecurringExpense','DailyFinancialClose','Vale','Consumption'
));

CREATE TABLE IF NOT EXISTS d1_rh_history (
 owner_id uuid NOT NULL, record_id uuid NOT NULL, entity text NOT NULL CHECK(entity IN ('Vale','Consumption')),
 operation_id uuid NOT NULL, actor_id uuid NOT NULL, device_id uuid NOT NULL,
 record_version bigint NOT NULL, action text NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,record_id,operation_id)
);
GRANT SELECT,INSERT ON d1_rh_history TO ruy_d1_app;
REVOKE UPDATE,DELETE ON d1_rh_history FROM ruy_d1_app;
