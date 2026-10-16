import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {wrapRecoveryKey,unwrapRecoveryKey} from '../../server/d1-lab/key-envelope.mjs';
import {createSupervisor} from '../../desktop/supervisor.mjs';
import {syncState} from '../../lab/d1/sync-state.mjs';
test('Chave portátil autenticada: frase correta, corrupção, KDF fixo e limites',async()=>{
 const key=randomBytes(32),device=randomUUID(),phrase='FICTICIO frase independente longa';
 const encrypted=await wrapRecoveryKey(key,device,phrase),restored=await unwrapRecoveryKey(encrypted,phrase);
 assert.ok(timingSafeEqual(restored.key,key));assert.equal(restored.deviceId,device);restored.key.fill(0);
 assert.equal(encrypted.includes(key.toString('hex')),false);assert.equal(encrypted.includes(phrase),false);
 await assert.rejects(unwrapRecoveryKey(encrypted,'FICTICIO frase diferente longa'));
 const corrupt=JSON.parse(encrypted);corrupt.tag='0'.repeat(32);await assert.rejects(unwrapRecoveryKey(JSON.stringify(corrupt),phrase));
 await assert.rejects(unwrapRecoveryKey(JSON.stringify({...JSON.parse(encrypted),kdf:'custom-unbounded'}),phrase));
 await assert.rejects(wrapRecoveryKey(key,device,'short'));await assert.rejects(unwrapRecoveryKey('x'.repeat(9000),phrase));key.fill(0);
});
test('Central sintética e sincronização desativada nunca produzem verde',()=>{
 const complete={enabled:true,operationalSyncEnabled:false,mode:'central-test-only',pending:0,sending:0,conflicts:0,rejected:0,lastSyncAt:new Date().toISOString(),receiptsVerified:true,pullComplete:true,cursor:2};
 assert.equal(syncState(complete),'unknown');assert.equal(syncState({...complete,operationalSyncEnabled:true}),'unknown');
 assert.equal(syncState({...complete,pending:1}),'pending');assert.equal(syncState({...complete,lastError:'falha'}),'error');
});
test('Supervisor serializa recuperação e bloqueia ciclos infinitos/serviço inesperado',async()=>{
 let healthy=false,launches=0,db=0;
 const supervisor=createSupervisor({health:async()=>{if(!healthy)throw Error('offline');},ensureDatabase:async()=>{db++;},ensureApi:async()=>{launches++;healthy=true;},wait:async()=>{}});
 const [a,b]=await Promise.all([supervisor.recover(),supervisor.recover()]);assert.equal(a,true);assert.equal(b,true);assert.equal(launches,1);assert.equal(db,1);
 supervisor.close();assert.equal(await supervisor.recover(),false);
 let attempts=0;
 const failed=createSupervisor({health:async()=>{throw Error('down');},ensureDatabase:async()=>{attempts++;throw Error('db');},ensureApi:async()=>{},wait:async()=>{}});
 assert.equal(await failed.recover(),false);assert.equal(attempts,3);await failed.recover();assert.equal(attempts,3);
 await failed.retry();assert.equal(attempts,6);
 const blocked=createSupervisor({health:async()=>{throw Object.assign(Error('unexpected'),{recoverable:false});},ensureDatabase:async()=>{throw Error('Não deve tocar no banco');},ensureApi:async()=>{throw Error('Não deve tocar na porta');}});
 assert.equal(await blocked.recover(),false);
});
