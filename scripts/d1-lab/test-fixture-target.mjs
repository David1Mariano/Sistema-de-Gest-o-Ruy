import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixtureTarget} from './fixture-target.mjs';
test('Central isolation uses only the authorized clone and refuses shared destinations',()=>{
 const local={host:'127.0.0.1',port:55437},central={host:'127.0.0.1',port:55435};
 const options={local,central,isolateCentral:'1',allowTests:'1',restartFixture:'e5aaec701010f607'};
 for(const kind of ['local','central'])assert.equal(fixtureTarget(kind,options),local);
 for(const port of [55435,55436,5432])assert.throws(()=>fixtureTarget('central',{...options,local:{...local,port}}));
 assert.throws(()=>fixtureTarget('central',{...options,allowTests:'0'}));
 assert.throws(()=>fixtureTarget('central',{...options,restartFixture:'other'}));
 assert.throws(()=>fixtureTarget('central',{...options,local:{...local,host:'0.0.0.0'}}));
 assert.throws(()=>fixtureTarget('unknown',options));
 assert.equal(fixtureTarget('central',{...options,isolateCentral:undefined}),central);
});
