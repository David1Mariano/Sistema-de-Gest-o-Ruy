import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {config,validateHome,home} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {operationalCommand} from '../../server/d1-lab/operations.mjs';
import {backup,restoreIsolated} from '../../server/d1-lab/backup.mjs';
import {productionWitness} from './production-witness.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in necessário: teste reinicia somente D1.');
let pool=poolFor(await config());const marker=await validateHome(),actor=randomUUID(),password=randomBytes(24).toString('hex'),suffix=randomUUID().slice(0,8);
const exec=promisify(execFile),control=(...args)=>exec(process.execPath,[fileURLToPath(new URL('../d1-lab.mjs',import.meta.url)),...args],{windowsHide:true,timeout:30000});
const production=await productionWitness();
let count=0;
const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const snapshot=async()=>{
 const result={};for(const table of ['d1_stock_balances','d1_stock_movements','d1_financial_accounts','d1_financial_entries','d1_operation_events'])result[table]=(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE owner_id=$1 ORDER BY to_jsonb(t)::text`,[actor])).rows;
 result.outbox=(await pool.query('SELECT * FROM lab_outbox WHERE actor=$1 ORDER BY operation_id',[actor])).rows;return result;
};
try{
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',await hashPassword(password)]);
 const origin='http://127.0.0.1:18087',login=await fetch(origin+'/api/d1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:actor+'@example.invalid',password})});assert.equal(login.status,200);
 const session={...await login.json(),cookie:login.headers.get('set-cookie').split(';')[0]};
 const call=async(route,body)=>{const r=await fetch(origin+'/api/d1'+route,{method:body?'POST':'GET',headers:{Cookie:session.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const raw=randomUUID(),output=randomUUID(),create={operationId:randomUUID(),itemId:raw,data:{name:'FICTICIO Insumo '+suffix,status:'ativo',unit:'kg',minimum_stock:0,location:'FICTICIO prateleira'},initialMilli:10000,unitCents:200};
 await check('tela/API de estoque usa cadastro + saldo + movimento + fila atômicos',async()=>{
  assert.equal((await call('/operations/create-item',create)).status,200);assert.equal((await call('/operations/create-item',create)).body.replay,true);
  assert.equal((await call('/operations/create-item',{...create,initialMilli:11000})).status,409);
  assert.equal((await call('/operations/state')).body.balances[0].quantity_milli,'10000');
  assert.equal((await pool.query('SELECT 1 FROM lab_outbox WHERE actor=$1',[actor])).rowCount,2);
  assert.equal((await call('/operations/create-item',{operationId:randomUUID(),itemId:output,data:{name:'FICTICIO Produto '+suffix,status:'ativo',unit:'un',minimum_stock:0},initialMilli:0,unitCents:0})).status,200);
 });
 const exit={operationId:randomUUID(),kind:'exit',itemId:raw,baseVersion:1,quantityMilli:6000};
 await check('baixa idempotente e concorrência não gastam o mesmo limite duas vezes',async()=>{
  assert.equal((await call('/operations/command',exit)).status,200);assert.equal((await call('/operations/command',exit)).body.replay,true);
  const results=await Promise.all([call('/operations/command',{...exit,operationId:randomUUID(),baseVersion:2,quantityMilli:3000}),call('/operations/command',{...exit,operationId:randomUUID(),baseVersion:2,quantityMilli:3000})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await call('/operations/state')).body.balances.find(r=>r.item_id===raw).quantity_milli,'1000');
 });
 await check('produção consome insumo e gera produto/custo na mesma transação',async()=>{
  const r=await call('/operations/command',{operationId:randomUUID(),kind:'production',inputs:[{itemId:raw,baseVersion:3,quantityMilli:1000}],output:{itemId:output,baseVersion:0,quantityMilli:500}});assert.equal(r.status,200);assert.equal(r.body.businessConfirmed,false);
  const state=(await call('/operations/state')).body;assert.equal(state.balances.find(r=>r.item_id===raw).quantity_milli,'0');assert.equal(state.balances.find(r=>r.item_id===output).quantity_milli,'500');assert.equal(state.balances.find(r=>r.item_id===output).average_cents,'400');
 });
 await check('falha após gravações operacionais reverte saldos, movimentos, fila e auditoria',async()=>{
  const before=await snapshot(),operationId=randomUUID();
  await assert.rejects(operationalCommand(pool,{id:actor,role:'admin'},marker.deviceId,{operationId,kind:'production',inputs:[{itemId:output,baseVersion:1,quantityMilli:100}],output:{itemId:raw,baseVersion:4,quantityMilli:100}},()=>{throw Error('FICTICIO falha antes de COMMIT');}));
  assert.deepEqual(await snapshot(),before);assert.equal((await pool.query('SELECT 1 FROM lab_audit WHERE operation_id=$1',[operationId])).rowCount,0);
 });
 await check('financeiro usa centavos, partidas balanceadas, CAS e limite sem pagamento externo',async()=>{
  const opening={operationId:randomUUID(),kind:'journal',entries:[{account:'cash',cents:10000,baseVersion:0},{account:'equity',cents:-10000,baseVersion:0}]};
  assert.equal((await call('/operations/command',opening)).status,200);assert.equal((await call('/operations/command',opening)).body.replay,true);
  const payment=await call('/operations/command',{operationId:randomUUID(),kind:'journal',entries:[{account:'cash',cents:-2500,baseVersion:1},{account:'expense',cents:2500,baseVersion:0}]});assert.equal(payment.status,200);assert.equal(payment.body.externalConfirmed,false);
  const before=await snapshot();
  assert.equal((await call('/operations/command',{operationId:randomUUID(),kind:'journal',entries:[{account:'expense',cents:999,baseVersion:1},{account:'cash',cents:-1000,baseVersion:2}]})).status,400);
  assert.equal((await call('/operations/command',{operationId:randomUUID(),kind:'journal',entries:[{account:'expense',cents:100000,baseVersion:1},{account:'cash',cents:-100000,baseVersion:2}]})).status,409);
  assert.deepEqual(await snapshot(),before);assert.equal((await pool.query('SELECT sum(cents) s FROM d1_financial_entries WHERE owner_id=$1',[actor])).rows[0].s,'0');
 });
 await check('autorização não pode ser elevada no payload nem pelo papel local',async()=>{
  assert.equal((await call('/operations/command',{...exit,operationId:randomUUID(),actorId:randomUUID()})).status,400);
  await pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actor]);assert.equal((await call('/operations/command',{...exit,operationId:randomUUID()})).status,403);await pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actor]);
 });
 const before=await snapshot();await pool.end();pool=null;
 await control('stop-api');await control('stop-db');assert.deepEqual(await productionWitness(),production);await control('start-db');await control('start-api');pool=poolFor(await config());
 await check('estoque/produção/financeiro sobrevivem ao fechamento e reinício API/PostgreSQL',async()=>{assert.deepEqual(await snapshot(),before);assert.equal((await call('/operations/state')).body.accounts.find(r=>r.account==='cash').balance_cents,'7500');});
 await check('backup criptografado restaura comandos, fila, cursores e recibos em banco novo',async()=>{
  const result=await backup();const restored=await restoreIsolated(path.join(home,'backups',result.file));assert.equal(restored.recoveryTablesVerified,10);assert.equal(restored.syncEnabled,false);
 });
 const report={checks:count,actor,production,syntheticOnly:true,externalPaymentConfirmed:false,globalStockConfirmed:false};await fs.writeFile('logs/operational-persistence-evidence.json',JSON.stringify(report,null,2));console.log('OPERATIONAL_PERSISTENCE_OK '+JSON.stringify(report));
}finally{await pool?.end();}
