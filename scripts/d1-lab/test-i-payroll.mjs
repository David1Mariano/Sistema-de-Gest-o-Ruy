import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {validatePaymentBatch} from '../../server/d1-lab/payment-batch.mjs';
import {createDomainAdapter} from '../../lab/d1/domain-client.mjs';
import {integratePayrollBatches} from '../../lab/d1/financial-guards.mjs';
const entry=()=>({employee_id:randomUUID(),gross_amount:10,discount_amount:0,net_amount:10,payment_date:'2026-10-16',payment_method:'pix',status:'pago',payment_type:'salario'});
test('API contract rejects unconfirmed, duplicate, malformed and RH batches',()=>{
 const make=()=>({token:'confirm-local-payroll',data:{payments:[entry()]}});
 assert.equal(validatePaymentBatch(make()).length,1);
 for(const change of [b=>delete b.token,b=>b.data.payments.push(b.data.payments[0]),b=>b.data.payments[0].net_amount=1.001,b=>b.data.payments[0].gross_amount=Infinity,b=>b.data.payments[0].payment_method='unknown',b=>b.data.payments[0].payment_type='vale',b=>b.data.payments[0].payment_date='2026-02-30',b=>b.data.payments[0].observation={},b=>b.data.payments[0].reference_start='2026-02-30']){const b=make();change(b);assert.throws(()=>validatePaymentBatch(b));}
});
test('Batch adapter sends action at root, keeps stable UUID on lost response and stores no payroll data',async()=>{
 const store=new Map(),previousStorage=globalThis.localStorage,previousDispatch=globalThis.dispatchEvent;
 globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};globalThis.dispatchEvent=()=>true;
 const bodies=[];let lost=true;
 try{
  // Same user across retries is part of the idempotency key.
  const user={id:randomUUID(),role:'admin'};const stable=createDomainAdapter({getSession:()=>({user}),signal:error=>{throw error;},request:async(_route,body)=>{bodies.push(body);if(lost)throw Error('lost');return {domainRecord:{id:body.id,_version:1}};}});
  const entries=[entry()];await assert.rejects(stable.batchPayments(entries),/lost/);
  const saved=[...store.values()][0];assert.equal(saved.includes(entries[0].employee_id),false);assert.equal(JSON.parse(saved).body.data,undefined);
  lost=false;await stable.batchPayments(entries);assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies[0].action,'batch');assert.equal(bodies[0].token,'confirm-local-payroll');assert.equal(store.size,0);
 }finally{globalThis.localStorage=previousStorage;globalThis.dispatchEvent=previousDispatch;}
});
test('Official multi-payment handler requires confirmation and never enters legacy separate writes',async()=>{
 const original=await fs.readFile(new URL('../../src/pages/Financeiro.jsx',import.meta.url),'utf8');const integrated=integratePayrollBatches(original);
 const start=integrated.indexOf('if(multi){',integrated.indexOf('if(base44.localDomain){',integrated.indexOf('function PaymentDialog(')));
 assert.ok(start>0);const end=integrated.indexOf('\n      if(!f.employee_id',start);assert.ok(end>start);
 const body=integrated.slice(start,end),AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const run=new AsyncFunction('multi','selectedIds','saving','window','setSaving','base44','rows','f','draft','onClose','onSaved','setSaveError',body);
 let calls=0,confirmed=false;const execute=()=>run(true,['employee'],false,{confirm:()=>confirmed},()=>{}, {localDomain:{batchPayments:async rows=>{calls++;assert.equal(rows.length,1);}}},{employee:{amount:'15'}},{payment_type:'salario'}, {markSaved(){},markFailed(){}},()=>{},async()=>{},()=>{});
 await execute();assert.equal(calls,0);confirmed=true;await execute();assert.equal(calls,1);
 assert.throws(()=>integratePayrollBatches('changed'),/Contrato/);
});
