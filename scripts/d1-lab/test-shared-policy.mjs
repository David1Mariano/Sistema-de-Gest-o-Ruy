import test from 'node:test';import assert from 'node:assert/strict';
import {sharedCommandPolicy,sharedCapabilities} from '../../server/sync-lab/shared-policy.mjs';
import {createSyncSupervisor} from '../../server/d1-lab/sync-supervisor.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('shared offline policy blocks financial and stock effects even in forged snapshots',()=>{
 for(const entity of ['PayrollRun','EmployeePayment','OperationalEvent','DailyProduction','DeliveryOrder'])assert.throws(()=>sharedCommandPolicy({changes:[{entity,data:{}}]},{offline:true}));
 for(const status of ['pago','recebido','cancelado'])assert.throws(()=>sharedCommandPolicy({changes:[{entity:'FinancialExpense',data:{payload_json:JSON.stringify({status})}}]}));
 assert.equal(sharedCommandPolicy({changes:[{entity:'Employee'}]},{offline:true}),true);assert.equal(sharedCapabilities.operationalEnabled,false);
});
test('scheduler does not overlap; shutdown waits for its own pending cycle',async()=>{
 let release,active=0,max=0,calls=0;const gate=new Promise(r=>release=r);
 const s=createSyncSupervisor({intervalMs:50,synchronize:async()=>{calls++;max=Math.max(max,++active);await gate;active--;return {pending:0};}});
 s.start();await wait(20);for(let n=0;n<20;n++)s.wake();let done=false;const stopping=s.stop().then(()=>done=true);await wait(20);assert.equal(done,false);release();await stopping;assert.equal(max,1);assert.equal(calls,1);await wait(80);assert.equal(calls,1);
});
test('reconnect automatically resumes and exposes stale/authentication/conflict states',async()=>{
 let online=false,session=true;
 const s=createSyncSupervisor({intervalMs:50,maxRetryMs:100,hasSession:()=>session,synchronize:async()=>{if(!online)throw Error('offline');return {pending:0,conflicts:1};}});
 s.start();await wait(40);assert.equal(s.status().connection,'offline');assert.equal(s.status().stale,true);online=true;s.wake();await wait(30);assert.equal(s.status().connection,'conflict');session=false;s.wake();await wait(30);assert.equal(s.status().connection,'authentication-required');await s.stop();
});
