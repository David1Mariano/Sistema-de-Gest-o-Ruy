import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {installation} from '../../server/d1-lab/environment.mjs';
import {initializeLab} from '../../server/d1-lab/bootstrap.mjs';
assert.equal(installation?.id,'i5r4-dev-20261020');
await initializeLab({bin:'C:/Program Files/PostgreSQL/17/bin',account:{login:'bootstrap-r4@example.invalid',password:randomBytes(32).toString('hex')}});
console.log('NEW_POSTR3_DISPOSABLE_CLUSTER_READY');
