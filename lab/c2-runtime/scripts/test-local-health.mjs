import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalServer} from '../server/local/api.mjs';
for(const available of [true,false])test(`health database available=${available}`,async()=>{
  const server=createLocalServer({query:async sql=>{assert.equal(sql,'SELECT 1');if(!available)throw Error('private database secret');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/local/health`);
    assert.equal(response.status,available?200:503);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{status:available?'ok':'unavailable'});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
