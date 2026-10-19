import {test} from 'node:test';import assert from 'node:assert/strict';
import {assertDeliveryDatabase} from '../../server/d1-lab/delivery.mjs';
test('Delivery refuses shared ports and nonfixture databases even with explicit laboratory flags',async()=>{
 const names=['RUY_D1_ALLOW_TESTS','RUY_D1_DELIVERY_LAB','RUY_D1_RESTART_FIXTURE'],prior=names.map(n=>process.env[n]);
 try{
  process.env.RUY_D1_ALLOW_TESTS='1';process.env.RUY_D1_DELIVERY_LAB='1';process.env.RUY_D1_RESTART_FIXTURE='e5aaec701010f607';
  for(const row of [{port:'55435',database:'ruy_d1_rc_0123456789abcdef'},{port:'55436',database:'ruy_d1_rc_0123456789abcdef'},{port:'55437',database:'ruy_d1_disposable'}])await assert.rejects(assertDeliveryDatabase({query:async()=>({rows:[row]})}),e=>e.status===403);
  await assertDeliveryDatabase({query:async()=>({rows:[{port:'55437',database:'ruy_d1_rc_0123456789abcdef'}]})});
  delete process.env.RUY_D1_DELIVERY_LAB;await assert.rejects(assertDeliveryDatabase({query:async()=>{throw Error('Must not query while disabled');}}),e=>e.status===403);
 }finally{for(let i=0;i<names.length;i++)if(prior[i]===undefined)delete process.env[names[i]];else process.env[names[i]]=prior[i];}
});
