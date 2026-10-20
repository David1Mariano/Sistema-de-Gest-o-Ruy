import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installationFor,installations} from '../../server/d1-lab/installation.mjs';
test('Independent immutable namespaces and no implicit installation',()=>{
 assert.equal(installationFor({}),null);
 const a=installations['i5r3-20261020'],b=installations['i5r3-peer-20261020'];
 assert.notEqual(a.id,b.id);assert.notEqual(a.apiPort,b.apiPort);assert.notEqual(a.dbPort,b.dbPort);
 assert.equal(Object.isFrozen(a),true);
});
test('Unknown installations, inherited fixture and conflicting ports fail closed',()=>{
 for(const change of [{RUY_D1_INSTALLATION:'unknown'},{RUY_D1_TEST_API_PORT:'18091'},{RUY_D1_ALLOW_TESTS:'0'},{RUY_D1_RESTART_FIXTURE:'e5aaec701010f607'}])assert.throws(()=>installationFor({RUY_D1_INSTALLATION:'i5r3-20261020',RUY_D1_ALLOW_TESTS:'1',RUY_D1_TEST_API_PORT:'18103',...change}));
});
