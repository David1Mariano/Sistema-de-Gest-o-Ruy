import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {syncState,attachmentStatus} from '../../lab/d1/sync-state.mjs';
import {syncStatus} from '../../server/d1-lab/sync.mjs';
import {createFixture} from './rc-fixture.mjs';

const complete={mode:'operational',operationalSyncEnabled:true,enabled:true,pending:0,sending:0,conflicts:0,rejected:0,
 lastSyncAt:'2026-10-16T12:00:00Z',receiptsVerified:true,pullComplete:true,cursor:3};

test('Confirmação de operações exige contadores válidos, data e cursor',()=>{
 assert.equal(syncState(complete),'confirmed');
 for(const key of ['pending','sending','conflicts','rejected']){
  for(const invalid of [undefined,null,-1,NaN,'0',0.5])assert.notEqual(syncState({...complete,[key]:invalid}),'confirmed');
 }
 for(const lastSyncAt of [undefined,null,'data inválida',''])assert.equal(syncState({...complete,lastSyncAt}),'unknown');
 for(const cursor of [-1,0.5,'3',null])assert.equal(syncState({...complete,cursor}),'unknown');
 assert.equal(syncState({...complete,pending:1}),'pending');
 assert.equal(syncState({...complete,pendingBusiness:1}),'pending');
 assert.equal(syncState({...complete,sending:1}),'syncing');
 assert.equal(syncState({...complete,conflicts:1}),'error');
 assert.equal(syncState({...complete,lastError:'sem rede'}),'error');
});

test('Anexos nunca são declarados confirmados por ausência de contagem',()=>{
 assert.match(attachmentStatus(null),/não verificada/);
 assert.match(attachmentStatus({pendingFiles:0}),/não verificada/);
 assert.match(attachmentStatus({pendingFiles:2}),/2 pendente/);
 assert.match(attachmentStatus({attachmentsState:'not-implemented',pendingFiles:null}),/pendências desconhecidas/);
});

test('PostgreSQL sintético: status distingue schemas sem anexos e transferência de laboratório',async()=>{
 const fixture=await createFixture();
 try{
  const minimal=await fixture.database('local',['d1-lab/schema.sql']);
  const completeDb=await fixture.database('local',['schema','entities','catalog','sync','operations','domain','attachments','business'].map(n=>'d1-lab/'+n+'.sql'));
  for(const [db,pendingFiles,state] of [[minimal,null,'not-implemented'],[completeDb,0,'lab-transfer-only']]){
   const status=await syncStatus(db.pool,randomUUID());
   assert.equal(status.pendingFiles,pendingFiles);assert.equal(status.attachmentsState,state);
   assert.equal(status.operationalSyncEnabled,false);assert.equal(syncState(status),'unknown');
  }
 }finally{await fixture.close();}
});

