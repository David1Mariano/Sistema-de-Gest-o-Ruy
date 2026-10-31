import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAuthorizedAttachmentDownload as allowed} from '../../desktop/download-policy.mjs';
const origin='http://127.0.0.1:18199',id='12345678-1234-5678-1234-123456789abc';
test('historical and original attachments download only through the authenticated local facade',()=>{
 for(const prefix of ['', 'history/'])assert.equal(allowed(origin+'/api/d1/'+prefix+'attachments/'+id+'/download',origin),true);
 for(const value of [origin+'/api/d1/history/records/'+id,origin+'/api/d1/history/attachments/'+id+'/download?token=x',origin+'/api/d1/attachments/'+id+'/download#x','https://example.invalid/api/d1/attachments/'+id+'/download',origin.replace('http://','http://someone:secret@')+'/api/d1/attachments/'+id+'/download',origin+'/api/d1/attachments/'+'-'.repeat(36)+'/download','file:///test.pdf'])assert.equal(allowed(value,origin),false);
});
