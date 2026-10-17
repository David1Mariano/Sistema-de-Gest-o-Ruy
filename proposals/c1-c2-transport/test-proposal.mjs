import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createLocalSession} from './localSession.proposed.mjs';
import {proposeEntities} from './entity-changes.mjs';
const baseline=await fs.readFile('C:/Users/Pichau/Sistema-de-Gest-o-Ruy/src/lib/localEntities.mjs','utf8');
const {createLocalEntity}=await import('data:text/javascript;base64,'+Buffer.from(proposeEntities(baseline)).toString('base64'));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const profile={user:{id:'synthetic',email:'test@example.invalid',role:'admin'},csrf:'synthetic-csrf'};
const op=()=>({operationId:randomUUID(),operation:'create',data:{name:'Synthetic',status:'ativo'}});
const setup=handler=>createLocalSession({request:async(url,options)=>url.endsWith('/me')?json(profile):handler(url,options)});
for(const status of [401,403,409,500])test(`HTTP ${status}: status, UUID, details and outcome`,async()=>{
  const body=op();let denied=0;
  const session=createLocalSession({onUnauthorized:()=>denied++,request:async url=>url.endsWith('/me')?json(profile):json({error:'Denied',code:'SERVER_CODE',dependencies:{Vale:1},total:1,resumo:[]},status)});
  await assert.rejects(session.request('records/Employee/id',body),e=>e.status===status&&e.operationId===body.operationId&&e.code==='SERVER_CODE'&&e.outcome===(status===500?'unknown':'rejected')&&e.dependencies.Vale===1);
  assert.equal(denied,status===401?1:0);
});
test('C1 login JSON CSRF, me, logout and same-origin cookie contract',async()=>{
  const calls=[];const session=createLocalSession({request:async(url,options)=>{calls.push({url,options});return json(url.endsWith('/logout')?{ok:true}:profile);}});
  assert.equal((await session.loginViaEmailPassword('individual@example.invalid','synthetic-password')).identity_source,'local');
  await session.me();await session.logout();
  assert.equal(calls[0].options.headers['x-csrf-token'],undefined);
  assert.equal(calls[2].options.headers['x-csrf-token'],profile.csrf);
  assert.ok(calls.every(c=>c.options.credentials==='same-origin'&&c.url.startsWith('/api/local/')));
});
test('invalid JSON never becomes an empty successful object',async()=>{
  const session=setup(()=>new Response('{broken',{status:200}));const body=op();
  await assert.rejects(session.request('records/Employee/id',body),e=>e.code==='INVALID_RESPONSE'&&e.outcome==='unknown'&&e.operationId===body.operationId);
});
test('malformed 403 preserves HTTP rejection',async()=>{
  await assert.rejects(setup(()=>new Response('html',{status:403})).request('records/Employee/id',op()),e=>e.status===403&&e.outcome==='rejected');
});
test('timeout before dispatch sends nothing',async()=>{
  let calls=0;const session=createLocalSession({timeoutMs:0,request:()=>{calls++;}});
  await assert.rejects(session.loginViaEmailPassword('test','test'),e=>e.code==='TIMEOUT'&&e.outcome==='not_sent');assert.equal(calls,0);
});
test('failed CSRF preflight: intended write not sent, UUID retained',async()=>{
  let calls=0;const body=op();const session=createLocalSession({timeoutMs:5,request:()=>{calls++;return new Promise(()=>{});}});
  await assert.rejects(session.request('records/Employee/id',body),e=>e.outcome==='not_sent'&&e.operationId===body.operationId);assert.equal(calls,1);
});
test('timeout after possible commit: unknown, exactly one write',async()=>{
  let writes=0;const session=createLocalSession({timeoutMs:5,request:async url=>{if(url.endsWith('/me'))return json(profile);writes++;return new Promise(()=>{});}});
  const body=op();await assert.rejects(session.request('records/Employee/id',body),e=>e.code==='TIMEOUT'&&e.outcome==='unknown'&&e.operationId===body.operationId);assert.equal(writes,1);
});
test('timeout during response body even if fetch mock ignores abort',async()=>{
  const session=createLocalSession({timeoutMs:5,request:async url=>url.endsWith('/me')?json(profile):{ok:true,status:200,text:()=>new Promise(()=>{})}});
  await assert.rejects(session.request('records/Employee/id',op()),e=>e.code==='TIMEOUT'&&e.outcome==='unknown');
});
test('interrupted response body classified separately',async()=>{
  await assert.rejects(setup(()=>({ok:true,status:200,text:async()=>{throw TypeError('stream interrupted');}})).request('records/Employee/id',op()),e=>e.code==='RESPONSE_INTERRUPTED'&&e.outcome==='unknown');
});
test('same UUID same intention allowed; changed intention blocked before dispatch',async()=>{
  let writes=0;const session=setup(()=>{writes++;return json({replay:true});});const body=op();
  await session.request('records/Employee/id',body);await session.request('records/Employee/id',body);
  await assert.rejects(session.request('records/Employee/id',{...body,data:{name:'Other'}}),e=>e.code==='IDEMPOTENCY_REUSE'&&e.outcome==='not_sent');
  await assert.rejects(session.request('records/Employee/other',body),e=>e.code==='IDEMPOTENCY_REUSE');assert.equal(writes,2);
});
test('invalid UUID or unserializable input blocked before dispatch',async()=>{
  let writes=0;const session=setup(()=>{writes++;return json({});});
  await assert.rejects(session.request('records/Employee/id',{operationId:'op_old'}),e=>e.code==='INVALID_OPERATION_ID');
  await assert.rejects(session.request('records/Employee/id',{value:1n}),e=>e.code==='INVALID_REQUEST');assert.equal(writes,0);
});
test('C2 pagination offset, external versions and confirmed tombstone',async()=>{
  const calls=[];const entity=createLocalEntity('Employee',{request:async(path,body)=>{calls.push({path,body});if(body)return {id:'id',data:{id:'id',name:'Synthetic'},version:'2',deleted:true};return {records:path.endsWith('offset=0')?Array.from({length:200},(_,i)=>({id:String(i),data:{name:'Synthetic'},version:'3'})):[]};}});
  const rows=await entity.list();assert.equal(rows.length,200);assert.equal(rows[0]._localVersion,3);assert.ok(calls[1].path.endsWith('offset=200'));
  await entity.delete('id',{baseVersion:1,confirmation:'EXCLUIR'});assert.equal(calls[2].body.confirmation,'EXCLUIR');assert.equal(calls[2].body.baseVersion,1);
});
test('C2 lost create response keeps UUID, no automatic retry',async()=>{
  let writes=0;const ids=[];const entity=createLocalEntity('Employee',{request:async(path,body)=>{writes++;ids.push(body.operationId);if(writes===1)throw Object.assign(Error('lost'),{outcome:'unknown'});return {id:path.split('/').at(-1),data:body.data,version:'1'};}});
  const data={name:'Synthetic',status:'ativo'};await assert.rejects(entity.create(data),e=>e.operationId===ids[0]);assert.equal(writes,1);await entity.create(data);assert.equal(writes,2);assert.equal(ids[0],ids[1]);
});
test('C2 invalid write acknowledgement keeps intended operation for explicit retry',async()=>{
  const ids=[];const entity=createLocalEntity('Employee',{request:async(path,body)=>{ids.push(body.operationId);return ids.length===1?{}:{id:path.split('/').at(-1),data:body.data,version:1};}});
  const data={name:'Synthetic',status:'ativo'};await assert.rejects(entity.create(data),e=>e.outcome==='unknown'&&e.operationId===ids[0]);await entity.create(data);assert.equal(ids[0],ids[1]);
});
test('unsupported modules and operations stay blocked',async()=>{
  let calls=0;const entity=createLocalEntity('FinancialExpense',{request:()=>{calls++;}});
  await assert.rejects(entity.list());assert.equal(calls,0);assert.equal(entity.transact,undefined);assert.equal(entity.bulkCreate,undefined);
});
test('C2 update merges fields, keeps external baseVersion and original UUID after unknown result',async()=>{
  let writes=0;const bodies=[];
  const entity=createLocalEntity('Employee',{request:async(path,body)=>{
    if(!body)return {records:[{id:'id',data:{name:'Synthetic',salary:100,status:'ativo'},version:'4'}]};
    writes++;bodies.push(body);
    if(writes===1)throw Object.assign(Error('interrupted'),{status:200,code:'INVALID_RESPONSE',outcome:'unknown'});
    return {id:'id',data:body.data,version:'5'};
  }});
  const patch={name:'Changed',_localVersion:4};
  await assert.rejects(entity.update('id',patch),e=>e.operationId===bodies[0].operationId);assert.equal(writes,1);
  const saved=await entity.update('id',patch);assert.equal(saved._localVersion,5);
  assert.equal(bodies[0].operationId,bodies[1].operationId);assert.equal(bodies[0].baseVersion,4);assert.equal(bodies[0].data.salary,100);assert.equal(bodies[0].data._localVersion,undefined);
});
test('C2 version conflict never sends a write',async()=>{
  let writes=0;const entity=createLocalEntity('Employee',{request:async(path,body)=>{if(body)writes++;return {records:[{id:'id',data:{name:'Synthetic'},version:5}]};}});
  await assert.rejects(entity.update('id',{name:'Stale',_localVersion:4}),{status:409});assert.equal(writes,0);
});
test('C2 replay confirmation rereads server state without another write',async()=>{
  let writes=0;const entity=createLocalEntity('Employee',{request:async(path,body)=>{if(body){writes++;return {operationId:body.operationId,replay:true};}return {records:[{id:path.split('/').at(-1),data:{name:'Synthetic'},version:2}]};}});
  assert.equal((await entity.create({name:'Synthetic'}))._localVersion,2);assert.equal(writes,1);
});
test('no fallback and no retry on local failure',async()=>{
  const urls=[];const session=createLocalSession({request:async url=>{urls.push(url);throw TypeError('offline');}});
  await assert.rejects(session.me(),e=>e.code==='CONNECTION_ERROR');assert.deepEqual(urls,['/api/local/me']);
});
