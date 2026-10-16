import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { guardC2 } from './c2.mjs';
import {LOCAL_ROLES,canLocalEntity} from '../../src/lib/localPermissions.mjs';

const scrypt = promisify(derive);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const fail = (status, message) => Object.assign(new Error(message), { status });
export function createPool(config) {
  if (config.host !== '127.0.0.1' || !/^ruy_local_test_[a-z0-9_]+$/.test(config.database || '') || config.port !== 55432) {
    throw Error('Only isolated loopback development databases on port 55432 are permitted.');
  }
  const pool = new pg.Pool({ ...config, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  pool.on('error', () => console.error('Local database connection interrupted; next request will reconnect.'));
  return pool;
}
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) throw fail(400, 'Password must have 12–256 bytes.');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt:32768:8:1:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const [algorithm,n,r,p,salt,hex] = encoded.split(':');
  if (algorithm !== 'scrypt' || n !== '32768' || r !== '8' || p !== '1' || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export const ENTITIES = new Set(['Absence','AccountsPayable','AccountsReceivable','AuditLog','CardReceivable','CashMovement','Consumption','CostCenter','DailyFinancialClose','DailyProduction','DeliverySettlement','Employee','EmployeeDocument','EmployeePayment','Evaluation','ExpenseCategory','FechamentoCaixa','FinancialAccount','FinancialExpense','InventoryItem','JobRole','MachineRotation','ManualReconciliation','ProductionOrder','ProductionProduct','Purchase','PurchaseItem','RecipeIngredient','RecurringExpense','Revenue','Sangria','Schedule','Sector','StandardSchedule','StockMovement','Supplier','SystemSettings','TimeRecord','Vale','Warning']);
export function authorize(user, entity, write = false) {
  if (!user?.active) throw fail(401, 'Authentication required.');
  if (!ENTITIES.has(entity)) throw fail(400, 'Unknown entity.');
  if (canLocalEntity(user.role,entity,write)) return;
  throw fail(403, 'Permission denied.');
}
export async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function activate(pool, { email, password, confirmedBy }) {
  if (typeof confirmedBy !== 'string' || !confirmedBy.trim()) throw fail(400, 'Responsible person confirmation required.');
  const hash = await hashPassword(password);
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(708080)');
    if ((await client.query('SELECT 1 FROM local_activation')).rowCount) throw fail(409, 'Already activated.');
    const user = await createUser(client, { email, hash, role: 'admin' });
    await client.query('INSERT INTO local_activation(administrator,confirmed_by) VALUES($1,$2)', [user.id, confirmedBy]);
    await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)', [user.id,'local_administrator_activation',JSON.stringify({ confirmedBy, identity: 'new_local_identity', remoteVerified: false })]);
    return user;
  });
}
export async function createUser(client, { email, hash, role }) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !LOCAL_ROLES.includes(role)) throw fail(400,'Invalid user.');
  return (await client.query('INSERT INTO local_users(id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,role,active', [randomUUID(),email.trim().toLowerCase(),hash,role])).rows[0];
}
export async function mutate(pool, user, entity, id, { operationId, operation, baseVersion, data, confirmation }, hook = async () => {}) {
  return transaction(pool, client => mutateInClient(client,user,entity,id,{operationId,operation,baseVersion,data,confirmation},hook));
}
// The caller must own a transaction. Used to compose atomic, confirmed RH batches.
export async function mutateInClient(client, user, entity, id, { operationId, operation, baseVersion, data, confirmation }, hook = async () => {}) {
  authorize(user, entity, true);
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id) || !/^[a-f0-9-]{36}$/.test(operationId || '') || !['create','update','delete'].includes(operation)) throw fail(400,'Invalid operation.');
  if (operation !== 'create' && (!Number.isSafeInteger(baseVersion) || baseVersion < 1)) throw fail(400,'Base version required.');
  if (operation === 'create' && baseVersion != null) throw fail(400,'Create cannot have base version.');
  if (operation !== 'delete' && (!data || typeof data !== 'object' || Array.isArray(data) || (data.id && data.id !== id))) throw fail(400,'Invalid record.');
  const payload = operation === 'delete' ? {} : { ...data, id };
    // All local writers share this lock, including future related entities.
    await client.query('SELECT pg_advisory_xact_lock(708082)');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [operationId]);
    const previous = (await client.query('SELECT * FROM local_pending WHERE operation_id=$1',[operationId])).rows[0];
    if (previous) {
      if (previous.author !== user.id || previous.entity !== entity || previous.record_id !== id || previous.operation !== operation || Number(previous.base_version || 0) !== Number(baseVersion || 0) || JSON.stringify(sortObject(previous.payload)) !== JSON.stringify(sortObject(payload))) throw fail(409,'Operation ID reused with different content.');
      return { operationId, replay: true };
    }
    let result;
    await guardC2(client,entity,id,operation,payload,confirmation);
    if (operation === 'create') {
      result = await client.query('INSERT INTO local_records(entity,id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *',[entity,id,payload]);
    } else {
      result = await client.query('UPDATE local_records SET data=CASE WHEN $4 THEN data ELSE $5::jsonb END,deleted=$4,version=version+1,updated_date=now() WHERE entity=$1 AND id=$2 AND version=$3 AND NOT deleted RETURNING *',[entity,id,baseVersion,operation==='delete',JSON.stringify(payload)]);
    }
    if (!result.rowCount) throw fail(409,'Record exists, changed or unavailable.');
    await hook(client);
    await client.query('INSERT INTO local_pending(operation_id,entity,record_id,operation,base_version,payload,author) VALUES($1,$2,$3,$4,$5,$6,$7)',[operationId,entity,id,operation,baseVersion ?? null,payload,user.id]);
    await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)',[user.id,operation,JSON.stringify({ entity,id,operationId,fields:operation==='delete' ? [] : Object.keys(payload),tombstone:operation==='delete' })]);
    return result.rows[0];
}
function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,sortObject(value[key])]));
  return value;
}
