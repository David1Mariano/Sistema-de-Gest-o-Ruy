import pg from 'pg';
import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { DB_PORT, database } from './environment.mjs';
const scrypt=promisify(derive);
export const fail=(status,message)=>Object.assign(Error(message),{status});
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function poolFor(c) {
  if(c.host!=='127.0.0.1'||c.port!==DB_PORT||c.database!==database||c.user!=='ruy_b_app') throw Error('Somente banco descartável/loopback/papel restrito.');
  const pool=new pg.Pool({...c,max:5,connectionTimeoutMillis:3000,statement_timeout:5000});
  pool.on('error',()=>console.error('Conexão do laboratório interrompida.'));
  return pool;
}
export async function transaction(pool,fn) {
  const c=await pool.connect();
  try {await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}
  catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}
export async function hashPassword(value) {
  if(typeof value!=='string'||value.length<12||Buffer.byteLength(value)>256)throw fail(400,'Senha local inválida.');
  const salt=randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex')}`;
}
export async function verifyPassword(value,hash) {
  if(typeof value!=='string'||Buffer.byteLength(value)>256)return false;
  const [algorithm,salt,key]=String(hash).split(':');
  if(algorithm!=='scrypt'||!/^[0-9a-f]{32}$/.test(salt)||!/^[0-9a-f]{128}$/.test(key))return false;
  return timingSafeEqual(await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}),Buffer.from(key,'hex'));
}
export async function seedSynthetic(pool) {
  const accounts=[];
  for(const role of ['admin','writer','viewer']) {
    const password=randomBytes(24).toString('base64url'),id=randomUUID();
    const login=`${role}-${id}@example.invalid`;
    await pool.query('INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,$4)',[id,login,await hashPassword(password),role]);
    accounts.push({id,login,password,role});
  }
  return accounts;
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export async function mutate(pool,user,deviceId,id,body,hook=async()=>{}) {
  const {operationId,operation,baseVersion,data}=body;
  if(!uuid(id)||!uuid(operationId)||!['create','update','delete'].includes(operation))throw fail(400,'Operação inválida.');
  if(operation!=='create'&&(!Number.isSafeInteger(baseVersion)||baseVersion<1))throw fail(400,'Versão necessária.');
  if(operation==='create'&&baseVersion!=null)throw fail(400,'Criação não aceita versão.');
  if(operation!=='delete'&&(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>k!=='text')||typeof data.text!=='string'||data.text.length>4000))throw fail(400,'Somente nota sintética com campo text.');
  const payload=operation==='delete'?{}:{text:data.text};
  const hash=digest(JSON.stringify(canonical({operation,id,baseVersion:baseVersion??null,payload})));
  return transaction(pool,async c=>{
    const actor=(await c.query('SELECT * FROM lab_users WHERE id=$1 AND active FOR SHARE',[user.id])).rows[0];
    if(!actor)throw fail(401,'Sessão revogada.');
    if(!['admin','writer'].includes(actor.role))throw fail(403,'Sem permissão de escrita.');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[operationId]);
    const prior=(await c.query('SELECT * FROM lab_outbox WHERE operation_id=$1',[operationId])).rows[0];
    if(prior){if(prior.actor!==actor.id||prior.payload_hash!==hash)throw fail(409,'Identificador reutilizado.');return {...prior.result,replay:true};}
    const current=(await c.query('SELECT * FROM lab_notes WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(current&&current.owner_id!==actor.id&&actor.role!=='admin')throw fail(403,'Registro de outro usuário.');
    let row;
    if(operation==='create') {
      row=(await c.query('INSERT INTO lab_notes(id,owner_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id,owner_id,data,version,deleted',[id,actor.id,payload])).rows[0];
    }else if(current&&!current.deleted&&Number(current.version)===baseVersion){
      row=(await c.query('UPDATE lab_notes SET data=CASE WHEN $3 THEN data ELSE $4::jsonb END,deleted=$3,version=version+1 WHERE id=$1 AND version=$2 RETURNING id,owner_id,data,version,deleted',[id,baseVersion,operation==='delete',JSON.stringify(payload)])).rows[0];
    }
    if(!row)throw fail(409,'Conflito de versão ou registro ausente.');
    await hook(c);
    const result={record:row,operationId,replay:false};
    await c.query('INSERT INTO lab_outbox(operation_id,device_id,actor,record_id,operation,base_version,payload_hash,payload,result,record_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[operationId,deviceId,actor.id,id,operation,baseVersion??null,hash,payload,result,row.version]);
    await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[actor.id,operation,operationId]);
    return result;
  });
}
