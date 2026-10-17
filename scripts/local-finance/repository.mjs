import { createHash, randomUUID } from 'node:crypto';

export const FINANCIAL_ENTITIES = Object.freeze(['CashMovement','DailyFinancialClose','FinancialExpense','FinancialAccount','AccountsPayable','AccountsReceivable','CardReceivable','Revenue','ExpenseCategory','FechamentoCaixa','Sangria','CostCenter','DeliverySettlement','ManualReconciliation','RecurringExpense']);
const links = { account_id: 'FinancialAccount', financial_account_id: 'FinancialAccount', category_id: 'ExpenseCategory', cost_center_id: 'CostCenter', payable_id: 'AccountsPayable', receivable_id: 'AccountsReceivable', recurring_expense_id: 'RecurringExpense' };
const canonical = (value) => JSON.stringify(value && typeof value === 'object' ? (Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))]))) : value);
function assertActor(actor, write = false) {
  if (!actor?.id || !['admin', 'finance', 'finance_read'].includes(actor.role) || (write && actor.role === 'finance_read')) throw new Error('finance_forbidden');
}
function assertEntity(entity) { if (!FINANCIAL_ENTITIES.includes(entity)) throw new Error('invalid_entity'); }
function expose(row) { return row ? { ...row.data, id: row.id, version: row.version, created_date: new Date(row.created_date).toISOString(), updated_date: new Date(row.updated_date).toISOString() } : null; }

/** pool: pg-compatible connect()/release(); actor MUST come from verified server session. */
export function createFinanceRepository({ pool, authorizeAttachment }) {
  return {
    async list(actor, entity, query = {}, sort = '-created_date', limit = 1000) {
      assertActor(actor); assertEntity(entity);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !/^-?[a-z_]+$/.test(sort)) throw new Error('invalid_query');
      const descending = sort.startsWith('-'); const field = sort.replace(/^-/, '');
      const client = await pool.connect();
      try {
        const { rows } = await client.query(`SELECT * FROM ruy_finance.record WHERE entity=$1 AND data @> $2::jsonb ORDER BY CASE WHEN $3='created_date' THEN to_jsonb(created_date) WHEN $3='updated_date' THEN to_jsonb(updated_date) ELSE data->$3 END ${descending ? 'DESC' : 'ASC'} NULLS LAST, id LIMIT $4`, [entity, JSON.stringify(query), field, limit]);
        return rows.map(expose);
      } finally { client.release(); }
    },
    async get(actor, entity, id) {
      assertActor(actor); assertEntity(entity);
      const client = await pool.connect();
      try { return expose((await client.query('SELECT * FROM ruy_finance.record WHERE entity=$1 AND id=$2', [entity,id])).rows[0]); }
      finally { client.release(); }
    },
    /** Atomic batch: payment + movement + expense, or closing + reconciliation. */
    async execute(actor, operationId, changes) {
      assertActor(actor, true);
      if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(operationId) || !Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('invalid_operation');
      const hash = createHash('sha256').update(canonical(changes)).digest('hex');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [operationId]);
        const prior = (await client.query('SELECT * FROM ruy_finance.operation WHERE id=$1', [operationId])).rows[0];
        if (prior) {
          if (prior.actor_id !== actor.id || prior.request_hash !== hash) throw new Error('operation_conflict');
          await client.query('COMMIT'); return prior.result;
        }
        const result = []; const audits = [];
        for (const change of changes) {
          assertEntity(change.entity);
          if (!['create','update'].includes(change.action)) throw new Error('history_delete_forbidden');
          const id = change.id || (change.action === 'create' ? randomUUID() : null);
          if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid_id');
          const before = expose((await client.query('SELECT * FROM ruy_finance.record WHERE entity=$1 AND id=$2 FOR UPDATE', [change.entity,id])).rows[0]);
          if (change.action === 'create' && before) throw new Error('record_exists');
          if (change.action === 'update' && (!before || before.version !== change.expectedVersion)) throw new Error('version_conflict');
          if (!change.data || Array.isArray(change.data) || typeof change.data !== 'object') throw new Error('invalid_data');
          const data = { ...(before || {}), ...change.data };
          for (const key of ['id','version','created_date','updated_date']) delete data[key];
          for (const key of ['amount','paid_amount','balance','total','value']) {
            if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || Math.abs(data[key]) > 1e12 || Math.abs(data[key] * 100 - Math.round(data[key] * 100)) > 0.001)) throw new Error('invalid_money');
          }
          for (const [field, value] of Object.entries(data)) {
            if (typeof value === 'string' && value.startsWith('ruy-anexo://')) {
              if (!authorizeAttachment || !await authorizeAttachment({ actor, entity: change.entity, recordId: id, field, value })) throw new Error('attachment_forbidden');
            }
          }
          const row = change.action === 'create'
            ? (await client.query('INSERT INTO ruy_finance.record(entity,id,data) VALUES($1,$2,$3::jsonb) RETURNING *', [change.entity,id,JSON.stringify(data)])).rows[0]
            : (await client.query('UPDATE ruy_finance.record SET data=$3::jsonb,version=version+1,updated_date=clock_timestamp() WHERE entity=$1 AND id=$2 RETURNING *', [change.entity,id,JSON.stringify(data)])).rows[0];
          result.push(expose(row)); audits.push({ entity: change.entity, id, before, after: expose(row), data });
        }
        for (const audit of audits) {
          await client.query('DELETE FROM ruy_finance.relationship WHERE entity=$1 AND record_id=$2', [audit.entity,audit.id]);
          for (const [field,target] of Object.entries(links)) if (audit.data[field]) await client.query('INSERT INTO ruy_finance.relationship VALUES($1,$2,$3,$4,$5)', [audit.entity,audit.id,field,target,audit.data[field]]);
        }
        await client.query('INSERT INTO ruy_finance.operation VALUES($1,$2,$3,$4::jsonb)', [operationId,actor.id,hash,JSON.stringify(result)]);
        for (const audit of audits) await client.query('INSERT INTO ruy_finance.audit(operation_id,actor_id,entity,record_id,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [operationId,actor.id,audit.entity,audit.id,JSON.stringify(audit.before),JSON.stringify(audit.after)]);
        await client.query('COMMIT'); return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
