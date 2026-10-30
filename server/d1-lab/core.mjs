import pg from 'pg';
import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { DB_PORT, database } from './environment.mjs';
const scrypt=promisify(derive);
export const fail=(status,message)=>Object.assign(Error(message),{status});
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function poolFor(c) {
  if(c.host!=='127.0.0.1'||c.port!==DB_PORT||c.database!==database||c.user!=='ruy_d1_app') throw Error('Somente banco descartável/loopback/papel restrito.');
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

export {default as pg} from 'pg';
