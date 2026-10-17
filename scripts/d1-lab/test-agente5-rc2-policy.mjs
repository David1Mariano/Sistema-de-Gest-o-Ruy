import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowedDownload,localOrigin} from '../../desktop/policy.mjs';
test('Electron permits only authenticated same-origin attachment downloads',()=>{
 const route='/api/d1/attachments/12345678-1234-4123-a123-123456789012/download';
 assert.equal(allowedDownload(localOrigin+route),true);
 for(const value of ['data:text/plain,FICTICIO','file:///C:/private.txt','https://example.invalid'+route,'http://127.0.0.1:8080'+route,'http://127.0.0.1:18080'+route,localOrigin+'/assets/file.txt',localOrigin+route+'?token=FICTICIO',localOrigin+route+'#fragment',localOrigin+'/api/d1/attachments/../download'])assert.equal(allowedDownload(value),false,value);
});
