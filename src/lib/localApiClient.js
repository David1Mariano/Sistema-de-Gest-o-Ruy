// Provisional entity adapter recovered from interrupted work.
// B/C1 contracts are absent: protocol-dependent operations are blocked before work.
// Do not remove guards until the actual server contract has been reviewed.
// Interface compatível com localDb.js e cloudDb.js:
// list, filter, get, create, update, delete, bulkCreate, deleteMany, subscribe, transact

import { matchesQuery } from './localDb';
import { localContractUnavailable } from './backendSelection.mjs';
import { createLocalAuthAdapter } from './localApiAuth';

const ENTITIES = new Set([
  'Absence', 'AccountsPayable', 'AccountsReceivable', 'AuditLog', 'CardReceivable',
  'CashMovement', 'Consumption', 'CostCenter', 'DailyFinancialClose', 'DailyProduction',
  'DeliverySettlement', 'Employee', 'EmployeeDocument', 'EmployeePayment', 'Evaluation',
  'ExpenseCategory', 'FechamentoCaixa', 'FinancialAccount', 'FinancialExpense',
  'InventoryItem', 'JobRole', 'MachineRotation', 'ManualReconciliation', 'ProductionOrder',
  'ProductionProduct', 'Purchase', 'PurchaseItem', 'RecipeIngredient', 'RecurringExpense',
  'Revenue', 'Sangria', 'Schedule', 'Sector', 'StandardSchedule', 'StockMovement',
  'Supplier', 'SystemSettings', 'TimeRecord', 'Vale', 'Warning',
]);

function fail(message, status = 500) {
  return Object.assign(new Error(message), { status });
}

function generateOperationId() {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const authAdapter = createLocalAuthAdapter();
const listeners = {};

function notify(entity) {
  (listeners[entity] || new Set()).forEach((cb) => {
    try { cb(); } catch { /* noop */ }
  });
}

function startPolling(entity) {
  if (listeners[entity]?.__polling) return;
  listeners[entity] = listeners[entity] || new Set();
  listeners[entity].__polling = true;
  setInterval(() => notify(entity), 30000);
}

// Métodos internos que recebem o client como parâmetro (evita referência circular)
const methods = {
  async list(client, sort, limit) {
    localContractUnavailable();
    const params = new URLSearchParams();
    if (sort) {
      const field = sort.startsWith('-') ? sort.slice(1) : sort;
      const dir = sort.startsWith('-') ? 'desc' : 'asc';
      params.set('sort', `${field}.${dir}`);
    }
    if (limit) params.set('limit', String(limit));
    const path = `/records/${client.entity}?${params.toString()}`;
    const data = await authAdapter.request(path);
    return (data?.records || []).map((r) => r.data);
  },

  async filter(client, query = {}, sort, limit) {
    localContractUnavailable();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      params.set(`data->>${key}`, `eq.${value}`);
    }
    if (sort) {
      const field = sort.startsWith('-') ? sort.slice(1) : sort;
      const dir = sort.startsWith('-') ? 'desc' : 'asc';
      params.set('sort', `${field}.${dir}`);
    }
    if (limit) params.set('limit', String(limit));
    const path = `/records/${client.entity}?${params.toString()}`;
    const data = await authAdapter.request(path);
    return (data?.records || []).map((r) => r.data);
  },

  async get(client, id) {
    localContractUnavailable();
    const path = `/records/${client.entity}/${encodeURIComponent(id)}`;
    const data = await authAdapter.request(path);
    const record = data?.records?.[0];
    if (!record) throw fail(`${client.entity} "${id}" não encontrado.`, 404);
    return record.data;
  },

  async create(client, data) {
    localContractUnavailable();
    const operationId = generateOperationId();
    const payload = { ...data, id: data?.id || `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` };
    const path = `/records/${client.entity}/${encodeURIComponent(payload.id)}`;
    const result = await authAdapter.request(path, {
      method: 'POST',
      body: { operationId, operation: 'create', data: payload },
    });
    notify(client.entity);
    return result?.data || payload;
  },

  async update(client, id, patch) {
    localContractUnavailable();
    const operationId = generateOperationId();
    const current = await methods.get(client, id);
    const baseVersion = current.version || 1;
    const payload = { ...patch, id };
    const path = `/records/${client.entity}/${encodeURIComponent(id)}`;
    const result = await authAdapter.request(path, {
      method: 'POST',
      body: { operationId, operation: 'update', baseVersion, data: payload },
    });
    notify(client.entity);
    return result?.data || { ...current, ...patch };
  },

  async delete(client, id) {
    localContractUnavailable();
    const operationId = generateOperationId();
    const current = await methods.get(client, id);
    const baseVersion = current.version || 1;
    const path = `/records/${client.entity}/${encodeURIComponent(id)}`;
    await authAdapter.request(path, {
      method: 'POST',
      body: { operationId, operation: 'delete', baseVersion, data: {} },
    });
    notify(client.entity);
    return { id };
  },

  async transact(client, id, mutate) {
    // A callback cannot represent an atomic multi-record business command.
    // No retry, no callback execution, no partial financial/stock writes.
    return localContractUnavailable();
  },

  async bulkCreate(client, items = []) {
    localContractUnavailable();
    const results = [];
    for (const data of items) {
      const result = await methods.create(client, data);
      results.push(result);
    }
    return results;
  },

  async deleteMany(client, target = []) {
    localContractUnavailable();
    const ids = Array.isArray(target)
      ? target
      : (await methods.list(client)).filter((r) => matchesQuery(r, target)).map((r) => r.id);
    if (!ids.length) return { deleted: 0 };
    let deleted = 0;
    for (const id of ids) {
      try {
        await methods.delete(client, id);
        deleted++;
      } catch {
        // Continua tentando apagar os outros
      }
    }
    return { deleted };
  },

  subscribe(client, cb) {
    listeners[client.entity] = listeners[client.entity] || new Set();
    listeners[client.entity].add(cb);
    startPolling(client.entity);
    return () => {
      listeners[client.entity]?.delete(cb);
    };
  },
};

export function createLocalApiEntityClient(entity) {
  if (!ENTITIES.has(entity)) {
    throw fail(`Entidade desconhecida: ${entity}`, 400);
  }

  const client = { entity };

  // Bind methods to client
  return {
    list: (sort, limit) => methods.list(client, sort, limit),
    filter: (query, sort, limit) => methods.filter(client, query, sort, limit),
    get: (id) => methods.get(client, id),
    create: (data) => methods.create(client, data),
    update: (id, patch) => methods.update(client, id, patch),
    delete: (id) => methods.delete(client, id),
    transact: (id, mutate) => methods.transact(client, id, mutate),
    bulkCreate: (items) => methods.bulkCreate(client, items),
    deleteMany: (target) => methods.deleteMany(client, target),
    subscribe: (cb) => methods.subscribe(client, cb),
  };
}

// Função para login no sistema local
export async function localApiLoginUser(email, password) {
  return authAdapter.login(email, password);
}

export async function localApiLogoutUser() {
  return authAdapter.logout();
}

export async function localApiGetCurrentUser() {
  return authAdapter.me();
}

export async function localApiIsAuthenticated() {
  return authAdapter.isAuthenticated();
}

export { authAdapter };