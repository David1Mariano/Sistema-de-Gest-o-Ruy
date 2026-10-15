-- Execute only through the marked, synthetic D1 environment configuration.
-- This extends a CHECK without rewriting, replacing or deleting any row.
ALTER TABLE d2_catalog DROP CONSTRAINT IF EXISTS d2_catalog_entity_check;
ALTER TABLE d2_catalog ADD CONSTRAINT d2_catalog_entity_check CHECK(entity IN (
 'ExpenseCategory','Supplier','InventoryItem','SystemSettings',
 'ProductionProduct','ProductionOrder','DailyProduction','FinancialExpense',
 'EmployeePayment','Revenue','AccountsPayable','FinancialAccount','CostCenter',
 'Sangria','CashMovement','FechamentoCaixa','AccountsReceivable','CardReceivable',
 'DeliverySettlement','ManualReconciliation','MachineRotation','RecurringExpense','DailyFinancialClose'
));
