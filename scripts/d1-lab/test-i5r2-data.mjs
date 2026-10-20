import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createFixture} from './rc-fixture.mjs';
import {catalogSave} from '../../server/d1-lab/catalog.mjs';
import {createStockItem,operationalCommand} from '../../server/d1-lab/operations.mjs';
if(process.env.RUY_D1_RESTART_FIXTURE!=='e5aaec701010f607')throw Error('Isolated synthetic clone required');
const fixture=await createFixture();
let reopened;
try{
 const A=await fixture.database('local',['schema','entities','catalog','sync','operations','domain','attachments','business'].map(n=>'d1-lab/'+n+'.sql'));
 assert.equal(A.config.port,55437);
 const actor=randomUUID(),device=randomUUID(),item=randomUUID();
 await A.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);await A.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,'disabled-synthetic-login','admin')",[actor,actor+'@example.invalid']);
 await catalogSave(A.pool,{id:actor,role:'admin'},device,'Employee',randomUUID(),{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO R2 persistencia',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
 await createStockItem(A.pool,{id:actor,role:'admin'},device,{operationId:randomUUID(),itemId:item,data:{name:'FICTICIO R2 estoque',unit:'kg',status:'ativo',minimum_stock:0},initialMilli:10000,unitCents:100});
 await operationalCommand(A.pool,{id:actor,role:'admin'},device,{operationId:randomUUID(),kind:'entry',itemId:item,quantityMilli:1000,unitCents:100,baseVersion:1});
 const snapshot=async pool=>Object.fromEntries(await Promise.all(['d1_records','d2_catalog','d1_stock_balances','d1_stock_movements','d1_operation_events','lab_audit','lab_outbox'].map(async table=>[table,(await pool.query(`SELECT to_jsonb(t) r FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows])));
 const before=await snapshot(A.pool);const originalConnection=await A.pool.connect();originalConnection.release(true);reopened=new pg.Pool(A.config);assert.deepEqual(await snapshot(reopened),before);
 const restored=await fixture.roundTrip({...A,pool:reopened});assert.deepEqual(await snapshot(restored.pool),before);
 await fs.writeFile('logs/i5r2/data.json',JSON.stringify({syntheticOnly:true,databasePorts:fixture.databases.map(d=>d.port),newConnectionPersistence:true,encryptedBackupRestore:true,restoredIntoNewDatabase:true,existingDatabasesDropped:false,postgresRestarted:false,physicalRecoveryTested:false},null,2));
 console.log('I5R2_SYNTHETIC_PERSISTENCE_BACKUP_OK');
}finally{if(reopened)await reopened.end();await fixture.close();}
