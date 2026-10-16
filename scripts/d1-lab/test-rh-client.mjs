import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDomainAdapter} from '../../lab/d1/domain-client.mjs';

test('RH: resposta desconhecida preserva UUID e somente metadados no navegador',async()=>{
 const storage=new Map(),target=new EventTarget(),sent=[];
 const previous={localStorage:globalThis.localStorage,dispatchEvent:globalThis.dispatchEvent};
 globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 globalThis.dispatchEvent=event=>target.dispatchEvent(event);
 const adapter=createDomainAdapter({getSession:()=>({user:{id:'ficticio-user',role:'admin'}}),signal:error=>{throw error;},request:async(_route,body)=>{
  sent.push(structuredClone(body));
  if(sent.length===1)throw Object.assign(Error('FICTICIO ACK perdido'),{status:503});
  return {domainRecord:{...body.data,id:body.id,_version:1},record:{id:body.id},operationId:body.operationId};
 }});
 try{
  const data={employee_id:'FICTICIO employee',employee_name:'FICTICIO nome privado',date:'2026-10-16',amount:30.25,type:'pix',motive:'FICTICIO motivo privado',status:'pendente'};
  await assert.rejects(adapter.entity('Vale').create(data),/ACK perdido/);
  const stored=[...storage.values()].join('');
  assert.equal(stored.includes(data.employee_name),false);assert.equal(stored.includes(data.motive),false);assert.equal(stored.includes(data.employee_id),false);
  const metadata=JSON.parse([...storage.values()][0]);assert.match(metadata.fingerprint,/^[a-f0-9]{64}$/);assert.equal(metadata.body.data,undefined);
  await assert.rejects(adapter.entity('Vale').create({...data,amount:40}),/sem confirmação/);assert.equal(sent.length,1);
  adapter.clear();const result=await adapter.entity('Vale').create(data);
  assert.equal(result.id,sent[0].id);assert.deepEqual(sent[1],sent[0]);assert.equal(storage.size,0);
 }finally{
  if(previous.localStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.localStorage;
  if(previous.dispatchEvent===undefined)delete globalThis.dispatchEvent;else globalThis.dispatchEvent=previous.dispatchEvent;
 }
});
