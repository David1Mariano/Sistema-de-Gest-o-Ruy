// Este app não depende mais do Base44. `base44` continua com o mesmo
// formato de antes (base44.entities.X.list/create/update/delete...,
// base44.auth.*, base44.integrations.Core.UploadFile) para que nenhuma
// página precisasse ser reescrita — só a implementação por trás mudou:
// agora tudo roda localmente no navegador (IndexedDB + localStorage),
// sem servidor externo.
import { createEntityClient, uploadFileLocal } from '@/lib/localDb';
import { localAuth } from '@/lib/localAuth';

// Mesmas entidades que existiam no projeto Base44 (base44/entities/*.jsonc).
const ENTITY_NAMES = [
  'Absence',
  'AccountsPayable',
  'AccountsReceivable',
  'AuditLog',
  'CardReceivable',
  'CashMovement',
  'Consumption',
  'CostCenter',
  'DailyFinancialClose',
  'DailyProduction',
  'DeliverySettlement',
  'Employee',
  'EmployeeDocument',
  'EmployeePayment',
  'Evaluation',
  'ExpenseCategory',
  'FechamentoCaixa',
  'FinancialAccount',
  'FinancialExpense',
  'InventoryItem',
  'JobRole',
  'MachineRotation',
  'ManualReconciliation',
  'ProductionOrder',
  'ProductionProduct',
  'Purchase',
  'PurchaseItem',
  'RecipeIngredient',
  'RecurringExpense',
  'Revenue',
  'Sangria',
  'Schedule',
  'Sector',
  'StandardSchedule',
  'StockMovement',
  'Supplier',
  'SystemSettings',
  'TimeRecord',
  'Vale',
  'Warning',
];

const entities = {};
for (const name of ENTITY_NAMES) entities[name] = createEntityClient(name);

export const base44 = {
  entities,
  auth: localAuth,
  integrations: {
    Core: {
      UploadFile: uploadFileLocal,
    },
  },
};
