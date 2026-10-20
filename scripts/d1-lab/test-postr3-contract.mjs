import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentsEnabled,deliveryCapability} from '../../server/d1-lab/capabilities.mjs';
import {installationFor} from '../../server/d1-lab/installation.mjs';
import {validateTLS} from '../../server/d1-lab/tls-provision.mjs';
import {relayD1} from '../../lab/c2-runtime/server/local/d1-relay.mjs';
const development={RUY_D1_ALLOW_TESTS:'1',RUY_D1_INSTALLATION:'i5r4-dev-20261020',RUY_D1_TEST_API_PORT:'18113'};
test('Ordinary new namespace enables the existing local mechanisms without inherited flags',()=>{
 assert.equal(attachmentsEnabled(development),true);assert.equal(deliveryCapability(development),true);
 const old={RUY_D1_ALLOW_TESTS:'1',RUY_D1_INSTALLATION:'i5r3-20261020',RUY_D1_TEST_API_PORT:'18103'};
 assert.equal(attachmentsEnabled(old),false);assert.equal(deliveryCapability(old),false);
 assert.equal(attachmentsEnabled({}),false);assert.equal(deliveryCapability({}),false);
});
test('Reused fixtures, old ports, unknown namespaces and missing opt-in fail closed',()=>{
 for(const patch of [{RUY_D1_RESTART_FIXTURE:'e5aaec701010f607'},{RUY_D1_TEST_API_PORT:'18091'},{RUY_D1_INSTALLATION:'untrusted'},{RUY_D1_ALLOW_TESTS:'0'}])assert.throws(()=>installationFor({...development,...patch}));
});
test('New namespace refuses TLS provisioning into the former laboratory',()=>{
 assert.equal(process.env.RUY_D1_INSTALLATION,development.RUY_D1_INSTALLATION);
 assert.throws(()=>validateTLS({endpoint:'https://127.0.0.1:18443/'}),e=>e.status===403);
});
test('C2 facade refuses previous gateway targets in the isolated new namespace',async()=>{
 for(const origin of ['http://127.0.0.1:18094','http://127.0.0.1:18080','http://example.invalid:18555'])await assert.rejects(relayD1({url:'/api/local/d1/changes?cursor=0'}, {},origin),/Invalid synthetic central origin/);
});
