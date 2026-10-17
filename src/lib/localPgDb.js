// Banco de dados LOCAL PostgreSQL (PGlite — WASM), com a MESMA interface
// do localDb (IndexedDB) e cloudDb (Supabase): list, filter, get, create,
// update, delete, bulkCreate, deleteMany, subscribe, transact.
//
// Diferente do IndexedDB, o PGlite roda PostgreSQL real no navegador,
// suportando transações ACID, tipos nativos (numeric, timestamp, jsonb),
// constraints, índices e SQL. É ideal para dados financeiros que exigem
// precisão decimal e integridade referencial.
//
// Persistência: o PGlite pode persistir no IndexedDB (opcional) via
// 'dataDir' (OPFS) ou exportar/importar dump SQL. Por padrão, mantém
// em memória na sessão — igual ao IndexedDB atual.

import { PGlite } from '@electric-sql/pglite';
import { sortRows, matchesQuery } from './localDb';

const DB_NAME = 'gestao_ruy_pg';
let pgPromise = null;
let schemaApplied = false;

const ENTITY_TABLES = {
  FinancialExpense: 'financial_expenses',
  EmployeePayment: 'employee_payments',
  Vale: 'vales',
  AccountsPayable: 'accounts_payable',
  AccountsReceivable: 'accounts_receivable',
  CashMovement: 'cash_movements',
  DailyFinancialClose: 'daily_financial_closes',
  FechamentoCaixa: 'fechamentos_caixa',
  Sangria: 'sangrias',
  RecurringExpense: 'recurring_expenses',
  Revenue: 'revenues',
  Consumption: 'consumptions',
  Supplier: 'suppliers',
  ExpenseCategory: 'expense_categories',
  CostCenter: 'cost_centers',
  FinancialAccount: 'financial_accounts',
  Employee: 'employees',
  EmployeeDocument: 'employee_documents',
  Purchase: 'purchases',
  PurchaseItem: 'purchase_items',
  InventoryItem: 'inventory_items',
  StockMovement: 'stock_movements',
  AuditLog: 'audit_logs',
  Warning: 'warnings',
  Sector: 'sectors',
  JobRole: 'job_roles',
  Schedule: 'schedules',
  StandardSchedule: 'standard_schedules',
  Absence: 'absences',
  Evaluation: 'evaluations',
  CardReceivable: 'card_receivables',
  DeliverySettlement: 'delivery_settlements',
  MachineRotation: 'machine_rotations',
  ManualReconciliation: 'manual_reconciliations',
  ProductionOrder: 'production_orders',
  ProductionProduct: 'production_products',
  RecipeIngredient: 'recipe_ingredients',
  SystemSettings: 'system_settings',
  TimeRecord: 'time_records',
};

function getTableName(entity) {
  return ENTITY_TABLES[entity] || entity.toLowerCase().replace(/([A-Z])/g, '_$1').slice(1) + 's';
}

async function getPg() {
  if (pgPromise) return pgPromise;
  pgPromise = (async () => {
    const pg = new PGlite('idb://' + DB_NAME);
    await pg.waitReady;
    return pg;
  })();
  return pgPromise;
}

async function ensureSchema(pg) {
  if (schemaApplied) return;
  // Cria todas as tabelas necessárias para as entidades financeiras
  // Usamos JSONB para flexibilidade (igual ao Supabase), com colunas
  // separadas para id, created_date, updated_date para performance.
  const tables = Object.values(ENTITY_TABLES);
  for (const table of tables) {
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_${table}_created ON ${table} (created_date DESC);
      CREATE INDEX IF NOT EXISTS idx_${table}_updated ON ${table} (updated_date DESC);
    `);
  }
  // Tabela de auditoria
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  schemaApplied = true;
}

function uid() {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function stripMeta(row) {
  if (!row) return row;
  const { id, data, created_date, updated_date } = row;
  return { ...data, id, created_date, updated_date };
}

const listeners = {};
function notify(entity) {
  (listeners[entity] || new Set()).forEach((cb) => {
    try { cb(); } catch { /* noop */ }
  });
}

export async function createEntityClient(entity) {
  const pg = await getPg();
  await ensureSchema(pg);
  const table = getTableName(entity);

  const client = {
    async list(sort, limit) {
      let orderBy = 'created_date DESC';
      if (sort) {
        const field = sort.startsWith('-') ? sort.slice(1) : sort;
        const dir = sort.startsWith('-') ? 'DESC' : 'ASC';
        orderBy = `data->>'${field}' ${dir}, created_date DESC`;
      }
      const sql = `SELECT * FROM ${table} ORDER BY ${orderBy}${limit ? ` LIMIT ${limit}` : ''}`;
      const { rows } = await pg.query(sql);
      return rows.map(stripMeta);
    },

    async filter(query = {}, sort, limit) {
      let whereClause = '';
      const params = [];
      let paramIndex = 1;
      if (Object.keys(query).length > 0) {
        const conditions = [];
        for (const [k, v] of Object.entries(query)) {
          conditions.push(`data->>'${k}' = $${paramIndex++}`);
          params.push(String(v));
        }
        whereClause = 'WHERE ' + conditions.join(' AND ');
      }
      let orderBy = 'created_date DESC';
      if (sort) {
        const field = sort.startsWith('-') ? sort.slice(1) : sort;
        const dir = sort.startsWith('-') ? 'DESC' : 'ASC';
        orderBy = `data->>'${field}' ${dir}, created_date DESC`;
      }
      const sql = `SELECT * FROM ${table} ${whereClause} ORDER BY ${orderBy}${limit ? ` LIMIT ${limit}` : ''}`;
      const { rows } = await pg.query(sql, params);
      return rows.map(stripMeta);
    },

    async get(id) {
      const { rows } = await pg.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      if (!rows.length) throw new Error(`${entity} "${id}" não encontrado.`);
      return stripMeta(rows[0]);
    },

    async create(data) {
      const now = nowIso();
      const id = data?.id || uid();
      const rec = { ...data, id, created_date: data?.created_date || now, updated_date: now };
      await pg.query(
        `INSERT INTO ${table} (id, data, created_date, updated_date) VALUES ($1, $2, $3, $4)`,
        [id, JSON.stringify(rec), rec.created_date, rec.updated_date]
      );
      notify(entity);
      return rec;
    },

    async update(id, patch) {
      const existing = await client.get(id);
      const now = nowIso();
      const merged = { ...existing, ...patch, id, updated_date: now };
      await pg.query(
        `UPDATE ${table} SET data = $1, updated_date = $2 WHERE id = $3`,
        [JSON.stringify(merged), now, id]
      );
      notify(entity);
      return merged;
    },

    async delete(id) {
      await pg.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      notify(entity);
      return { id };
    },

    // Transação atômica nativa do PostgreSQL (compare-and-swap via versão)
    async transact(id, mutate) {
      const saved = await pg.transaction(async (tx) => {
        const { rows } = await tx.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        if (!rows.length) throw new Error(`${entity} "${id}" não encontrado.`);
        const existing = stripMeta(rows[0]);
        const patch = await mutate(existing);
        if (patch === null || patch === undefined) return existing;
        const merged = { ...existing, ...patch, id, updated_date: nowIso() };
        await tx.query(
          `UPDATE ${table} SET data = $1, updated_date = $2 WHERE id = $3`,
          [JSON.stringify(merged), merged.updated_date, id]
        );
        return merged;
      });
      notify(entity);
      return saved;
    },

    async bulkCreate(items = []) {
      const now = nowIso();
      const out = [];
      await pg.transaction(async (tx) => {
        for (const data of items) {
          const id = data?.id || uid();
          const rec = { ...data, id, created_date: data?.created_date || now, updated_date: now };
          await tx.query(
            `INSERT INTO ${table} (id, data, created_date, updated_date) VALUES ($1, $2, $3, $4)`,
            [id, JSON.stringify(rec), rec.created_date, rec.updated_date]
          );
          out.push(rec);
        }
      });
      notify(entity);
      return out;
    },

    async deleteMany(target = []) {
      const ids = Array.isArray(target)
        ? target
        : (await client.list()).filter((r) => matchesQuery(r, target)).map((r) => r.id);
      if (!ids.length) return { deleted: 0 };
      await pg.transaction(async (tx) => {
        for (const id of ids) {
          await tx.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        }
      });
      notify(entity);
      return { deleted: ids.length };
    },

    subscribe(cb) {
      listeners[entity] = listeners[entity] || new Set();
      listeners[entity].add(cb);
      return () => listeners[entity].delete(cb);
    },
  };
  return client;
}

// Upload de arquivo local: converte em base64 (data URL) — mesmo comportamento
// do localDb e cloudDb. Para PostgreSQL local, poderíamos salvar como BYTEA
// em tabela separada, mas mantemos compatibilidade com o formato atual.
export async function uploadFileLocal({ file }) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Nenhum arquivo informado.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ file_url: reader.result, name: file.name });
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

export async function migrateLocalDataIfPending() {
  // Migração opcional: importa dados do IndexedDB (localDb) para o PGlite
  // Pode ser chamado uma vez na inicialização se houver flag no localStorage.
  const MIGRATION_FLAG = 'gr_pg_migrated_v1';
  if (localStorage.getItem(MIGRATION_FLAG)) return;

  try {
    const req = indexedDB.open('gestao_ruy_local_db');
    req.onsuccess = async () => {
      const db = req.result;
      try {
        const tx = db.transaction('records', 'readonly');
        const getAll = tx.objectStore('records').getAll();
        getAll.onsuccess = async () => {
          const rows = getAll.result || [];
          const pg = await getPg();
          await ensureSchema(pg);
          for (const row of rows) {
            if (!row._entity || !row.id) continue;
            const { _key, _entity, ...data } = row;
            const table = getTableName(_entity);
            await pg.query(
              `INSERT INTO ${table} (id, data, created_date, updated_date) VALUES ($1, $2, $3, $4)
               ON CONFLICT (id) DO NOTHING`,
              [data.id, JSON.stringify(data), data.created_date || nowIso(), data.updated_date || nowIso()]
            );
          }
          localStorage.setItem(MIGRATION_FLAG, String(Date.now()));
          console.info('[localPgDb] Migração IndexedDB → PGlite concluída.');
        };
        getAll.onerror = () => {};
      } catch {
        // Sem banco local, nada a migrar
      }
    };
    req.onerror = () => {};
  } catch {
    // IndexedDB indisponível
  }
}