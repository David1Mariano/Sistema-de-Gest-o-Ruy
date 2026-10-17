// Backend selection is independent of session validity. No browser database fallback.
import { uploadFileLocal } from '@/lib/localDb';
import { createLocalApiEntityClient, authAdapter as localApiAuthAdapter } from '@/lib/localApiClient';
import { createEntityClient as createCloudEntityClient, isCloudConfigured } from '@/lib/cloudDb';
import { supabaseAuth } from '@/lib/supabaseClient';
import { resolveBackend, localContractUnavailable } from '@/lib/backendSelection.mjs';

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


const mode = () => globalThis.localStorage?.getItem('gr_data_backend') || null;
const selected = () => resolveBackend(mode(), {
  local: { entity: createLocalApiEntityClient, auth: localApiAuthAdapter, upload: localContractUnavailable },
  cloud: { entity: createCloudEntityClient, auth: supabaseAuth, upload: uploadFileLocal },
  cloudConfigured: isCloudConfigured(),
});
// Stable facades: modules capturing an entity at import time still use the selected mode.
const entities = Object.fromEntries(ENTITY_NAMES.map(name => [name, Object.fromEntries(
  ['list','filter','get','create','update','delete','transact','bulkCreate','deleteMany','subscribe'].map(method => [method, (...args) => {
    const client = selected().entity(name);
    return client[method](...args);
  }])
)]));
export const base44 = {
  entities,
  auth: new Proxy({}, { get: (_, method) => (...args) => {
    const auth = selected().auth;
    return auth[method](...args);
  }}),
  integrations: { Core: { UploadFile: (...args) => selected().upload(...args) } },
};
export async function setDataBackend(backend) {
  if (!['local-api', 'supabase'].includes(backend)) throw new Error('Escolha LOCAL (local-api) ou NUVEM (supabase).');
  localStorage.setItem('gr_data_backend', backend);
  // Reload clears captured identities and query caches. Session expiry never changes mode.
  window.location.reload();
}
export function getDataBackend() { return mode(); }
export { localApiAuthAdapter as localApiAuth };
export async function loginViaLocalApi(email, password) {
  if (mode() !== 'local-api') throw new Error('Selecione LOCAL antes do login local.');
  return localApiAuthAdapter.login(email, password);
}
