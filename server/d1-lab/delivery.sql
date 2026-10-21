-- NEW synthetic fixture databases only; never a startup/operational migration.
DO $$ BEGIN IF current_database() !~ '^ruy_d1_rc_[a-f0-9]{16}$' AND NOT (current_database()='ruy_d1_disposable' AND ((current_setting('port')='55453' AND coalesce(current_setting('ruy.initializing_installation',true),'')='i5r4-dev-20261020') OR (current_setting('port')='55483' AND coalesce(current_setting('ruy.initializing_installation',true),'')='final-dev-20261021'))) THEN RAISE EXCEPTION 'New isolated RC fixture required'; END IF; END $$;
ALTER TABLE d2_catalog DROP CONSTRAINT d2_catalog_entity_check;
ALTER TABLE d2_catalog ADD CONSTRAINT d2_catalog_entity_check CHECK(entity IN (
 'ExpenseCategory','Supplier','InventoryItem','SystemSettings','ProductionProduct','ProductionOrder','DailyProduction','FinancialExpense',
 'EmployeePayment','Revenue','AccountsPayable','FinancialAccount','CostCenter','Sangria','CashMovement','FechamentoCaixa','AccountsReceivable','CardReceivable',
 'DeliverySettlement','ManualReconciliation','MachineRotation','RecurringExpense','DailyFinancialClose','Vale','Consumption',
 'DeliveryOrder','DeliveryCustomer','DeliveryMenuItem','DeliveryDriver'
));
