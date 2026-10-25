-- Explicit provisioning ONLY in a NEW synthetic final-development database.
DO $$ BEGIN
 IF NOT ((current_setting('port')='55483' AND current_database() ~ '^ruy_d1_rc_[a-f0-9]{16}$') OR (current_setting('port')='55496' AND current_database()='ruy_d1_disposable' AND coalesce(current_setting('ruy.initializing_installation',true),'')='windows-operational')) THEN
  RAISE EXCEPTION 'New isolated attendance test database required';
 END IF;
END $$;
ALTER TABLE d2_catalog DROP CONSTRAINT d2_catalog_entity_check;
ALTER TABLE d2_catalog ADD CONSTRAINT d2_catalog_entity_check CHECK(entity IN (
 'ExpenseCategory','Supplier','InventoryItem','SystemSettings','ProductionProduct','ProductionOrder','DailyProduction','FinancialExpense',
 'EmployeePayment','Revenue','AccountsPayable','FinancialAccount','CostCenter','Sangria','CashMovement','FechamentoCaixa',
 'AccountsReceivable','CardReceivable','DeliverySettlement','ManualReconciliation','MachineRotation','RecurringExpense','DailyFinancialClose',
 'Vale','Consumption','DeliveryOrder','DeliveryCustomer','DeliveryMenuItem','DeliveryDriver','Schedule','StandardSchedule','TimeRecord','Absence','Warning'
));
CREATE TABLE d1_attendance_history (
 owner_id uuid NOT NULL,record_id uuid NOT NULL,entity text NOT NULL,operation_id uuid NOT NULL,
 actor_id uuid NOT NULL,record_version bigint NOT NULL,action text NOT NULL,snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,record_id,operation_id)
);
GRANT SELECT,INSERT ON d1_attendance_history TO ruy_d1_app;
REVOKE UPDATE,DELETE ON d1_attendance_history FROM ruy_d1_app;
