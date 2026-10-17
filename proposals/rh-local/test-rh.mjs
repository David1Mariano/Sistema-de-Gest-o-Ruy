import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {RH_ENTITIES,authorizeRh,guardRh} from './rh-contract.mjs';
import {patchCore,patchEntities} from './integration.mjs';
import {proposeEntities} from '../c1-c2-transport/entity-changes.mjs';
const root='C:/Users/Pichau/Sistema-de-Gest-o-Ruy/';
let core=patchCore(await fs.readFile(root+'server/local/core.mjs','utf8'));
core=core.replace("'./c2.mjs'",JSON.stringify(pathToFileURL(root+'server/local/c2.mjs').href)).replace("'./rh-contract.mjs'",JSON.stringify(new URL('./rh-contract.mjs',import.meta.url).href));
core=core.replace("'pg'",JSON.stringify(pathToFileURL(root+'node_modules/pg/lib/index.js').href));
const {mutate}=await import('data:text/javascript;base64,'+Buffer.from(core).toString('base64'));
const {createLocalEntity}=await import('data:text/javascript;base64,'+Buffer.from(patchEntities(proposeEntities(await fs.readFile(root+'src/lib/localEntities.mjs','utf8')))).toString('base64'));
const admin={id:randomUUID(),role:'admin',active:true};
const day='2026-10-09';
export const fixtures={
  EmployeeDocument:{employee_id:'emp',date:day,name:'Synthetic metadata',category:'outros',file_url:''},
  EmployeePayment:{employee_id:'emp',payment_date:day,payment_type:'salario',gross_amount:100,discount_amount:10,net_amount:90,status:'pendente'},
  Evaluation:{employee_id:'emp',date:day,score:7,notes:'Synthetic'},
  Warning:{employee_id:'emp',date:day,category:'outros',description:'Synthetic',status:'pendente'},
  Vale:{employee_id:'emp',date:day,amount:10,status:'pendente',type:'dinheiro'},
  Absence:{employee_id:'emp',date:day,type:'falta',status:'ativo',minutes:0},
  TimeRecord:{employee_id:'emp',date:day,entry_time:'08:00',status:'presente'},
  Schedule:{employee_id:'emp',date:day,start_time:'08:00',end_time:'17:00',day_type:'trabalho',status:'ativo'},
  StandardSchedule:{employee_id:'emp',weekday:5,start_time:'08:00',end_time:'17:00',day_type:'trabalho'},
};
// Synthetic SQL boundary, not PostgreSQL. Executes real proposed guard and B mutation code.
class MemoryPool {
  records=new Map([['Employee:emp',{id:'emp',data:{id:'emp',name:'Synthetic'},version:1,deleted:false}]]);
  pending=[];audit=[];
  async connect(){return this;}
  release(){}
  async query(sql,args=[]) {
    const result=rows=>({rows,rowCount:rows.length});
    if(sql==='BEGIN'){this.snapshot=structuredClone({records:this.records,pending:this.pending,audit:this.audit});return result([]);}
    if(sql==='ROLLBACK'){Object.assign(this,this.snapshot);return result([]);}
    if(sql==='COMMIT'||sql.includes('pg_advisory_xact_lock'))return result([]);
    if(sql.startsWith('SELECT * FROM local_pending'))return result(this.pending.filter(r=>r.operation_id===args[0]));
    if(sql.startsWith('SELECT data FROM local_records WHERE entity=$1'))return result([this.records.get(args[0]+':'+args[1])].filter(Boolean).map(r=>({data:r.data})));
    if(sql.includes("entity='Employee'"))return result([this.records.get('Employee:'+args[0])].filter(r=>r&&!r.deleted));
    if(sql.includes("entity='Schedule' AND id<>"))return result([...this.records.entries()].filter(([k,r])=>k.startsWith('Schedule:')&&r.id!==args[0]&&!r.deleted&&r.data.employee_id===args[1]&&r.data.date===args[2]).map(([,r])=>r));
    if(sql.includes("entity='Schedule'"))return result([this.records.get('Schedule:'+args[0])].filter(r=>r&&!r.deleted));
    if(sql.includes("entity IN ('Absence','TimeRecord')"))return result([...this.records.entries()].filter(([k,r])=>/^(Absence|TimeRecord):/.test(k)&&r.data.schedule_id===args[0]).map(([,r])=>r));
    if(sql.includes('id<>$2'))return result([...this.records.entries()].filter(([k,r])=>k.startsWith(args[0]+':')&&r.id!==args[1]&&!r.deleted&&r.data.employee_id===args[2]&&String(r.data[args[3]])===args[4]).map(([,r])=>r));
    if(sql.startsWith('INSERT INTO local_records')) {
      const key=args[0]+':'+args[1];if(this.records.has(key))return result([]);
      const row={id:args[1],entity:args[0],data:args[2],version:1,deleted:false};this.records.set(key,row);return result([row]);
    }
    if(sql.startsWith('UPDATE local_records')) {
      const row=this.records.get(args[0]+':'+args[1]);if(!row||row.deleted||row.version!==args[2])return result([]);
      row.data=args[3]?row.data:JSON.parse(args[4]);row.deleted=args[3];row.version++;return result([row]);
    }
    if(sql.startsWith('INSERT INTO local_pending')){this.pending.push({operation_id:args[0],entity:args[1],record_id:args[2],operation:args[3],base_version:args[4],payload:args[5],author:args[6],state:'pending'});return result([]);}
    if(sql.startsWith('INSERT INTO local_audit')){this.audit.push({actor:args[0],action:args[1],details:JSON.parse(args[2])});return result([]);}
    throw Error('Unexpected SQL: '+sql);
  }
}
function session(pool,user=admin) {return {request:async(path,body)=>{
  const [,entity,id]=path.split('?')[0].split('/');authorizeRh(user,entity);
  if(body)return mutate(pool,user,entity,id,body);
  return {records:[...pool.records.entries()].filter(([key,row])=>key.startsWith(entity+':')&&!row.deleted&&(!id||row.id===id)).map(([,row])=>structuredClone(row))};
}};}
for(const entity of RH_ENTITIES)test(`${entity}: create/read/filter/update/conflict/delete, queue and audit`,async()=>{
  const pool=new MemoryPool(),a=createLocalEntity(entity,session(pool)),b=createLocalEntity(entity,session(pool));
  const first=await a.create(fixtures[entity]);assert.equal((await b.get(first.id)).employee_id,'emp');
  assert.equal((await a.filter({employee_id:'emp'})).length,1);
  const updated=await a.update(first.id,{observation:'Changed',_localVersion:1});assert.equal(updated._localVersion,2);
  await assert.rejects(b.update(first.id,{observation:'Stale',_localVersion:1}),{status:409});
  await assert.rejects(a.delete(first.id,{baseVersion:2}),{status:400});
  await a.delete(first.id,{baseVersion:2,confirmation:'EXCLUIR'});
  assert.equal((await a.list()).length,0);assert.equal(pool.records.get(entity+':'+first.id).data.employee_id,'emp');
  assert.equal(pool.pending.length,3);assert.equal(pool.audit.length,3);assert.ok(pool.pending.every(op=>op.author===admin.id&&op.state==='pending'));
});
test('all RH fields denied to operator/viewer, including tampered direct requests',async()=>{
  for(const entity of RH_ENTITIES)for(const role of ['operator','viewer']) {
    const pool=new MemoryPool(),user={...admin,role};
    assert.throws(()=>authorizeRh(user,entity),{status:403});
    await assert.rejects(mutate(pool,user,entity,'id',{operationId:randomUUID(),operation:'create',data:fixtures[entity]}),{status:403});
    assert.equal(pool.pending.length,0);
  }
});
test('same UUID idempotent, changed intent blocked, no duplicate audit',async()=>{
  const pool=new MemoryPool();const body={operationId:randomUUID(),operation:'create',data:fixtures.Vale};
  await mutate(pool,admin,'Vale','id',body);assert.equal((await mutate(pool,admin,'Vale','id',body)).replay,true);
  await assert.rejects(mutate(pool,admin,'Vale','id',{...body,data:{...body.data,amount:20}}),{status:409});assert.equal(pool.pending.length,1);assert.equal(pool.audit.length,1);
});
test('invalid employee, reassignment, schedule mismatch and privilege fields blocked',async()=>{
  const pool=new MemoryPool(),a=createLocalEntity('Absence',session(pool));
  await assert.rejects(a.create({...fixtures.Absence,employee_id:'missing'}),{status:409});
  await assert.rejects(a.create({...fixtures.Absence,role:'admin'}),{status:400});
  await assert.rejects(a.create({...fixtures.Absence,schedule_id:'missing'}),{status:409});
  const row=await a.create(fixtures.Absence);await assert.rejects(a.update(row.id,{employee_id:'other',_localVersion:1}),{status:409});
});
test('invalid money/date/time, new remote attachment and duplicate employee period blocked',async()=>{
  const pool=new MemoryPool();
  for(const [entity,payload,status] of [['EmployeePayment',{...fixtures.EmployeePayment,net_amount:99},400],['Vale',{...fixtures.Vale,amount:-1},400],['Absence',{...fixtures.Absence,date:'2026-02-31'},400],['TimeRecord',{...fixtures.TimeRecord,entry_time:'99:99'},400],['EmployeeDocument',{...fixtures.EmployeeDocument,file_url:'https://remote.invalid/a'},501]])await assert.rejects(createLocalEntity(entity,session(pool)).create(payload),{status});
  for(const entity of ['TimeRecord','StandardSchedule']){const a=createLocalEntity(entity,session(pool));await a.create(fixtures[entity]);await assert.rejects(a.create({...fixtures[entity],observation:'Different ID'}),{status:409});}
});
test('failure after record mutation rolls back record, queue and audit in B transaction',async()=>{
  const pool=new MemoryPool();await assert.rejects(mutate(pool,admin,'Warning','id',{operationId:randomUUID(),operation:'create',data:fixtures.Warning},async()=>{throw Error('Injected failure');}));
  assert.equal(pool.records.has('Warning:id'),false);assert.equal(pool.pending.length,0);assert.equal(pool.audit.length,0);
});
test('schedule historical links block tombstone; existing remote references preserved as metadata only',async()=>{
  const pool=new MemoryPool(),s=createLocalEntity('Schedule',session(pool));const row=await s.create(fixtures.Schedule);
  await createLocalEntity('Absence',session(pool)).create({...fixtures.Absence,schedule_id:row.id});
  await assert.rejects(s.delete(row.id,{baseVersion:1,confirmation:'EXCLUIR'}),{status:409});
  pool.records.set('EmployeeDocument:legacy',{id:'legacy',version:1,deleted:false,data:{...fixtures.EmployeeDocument,file_url:'https://remote.invalid/a'}});
  await guardRh(pool,'EmployeeDocument','legacy','update',{...fixtures.EmployeeDocument,file_url:'https://remote.invalid/a',name:'Renamed'});
});
test('overlapping schedule and vacation/work conflict denied by backend',async()=>{
  const pool=new MemoryPool(),s=createLocalEntity('Schedule',session(pool));await s.create(fixtures.Schedule);
  await assert.rejects(s.create({...fixtures.Schedule,start_time:'09:00'}),{status:409});
  await assert.rejects(s.create({...fixtures.Schedule,day_type:'ferias'}),{status:409});
});
