import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateAttachment} from '../../server/d1-lab/attachment-contract.mjs';
import {attachmentSamples,attachmentBody} from './stage3-attachment-samples.mjs';
for(const sample of attachmentSamples){
 test('A4 adaptation: complete structural '+sample.mediaType,()=>assert.deepEqual(validateAttachment(attachmentBody(sample.bytes,{filename:sample.filename,mediaType:sample.mediaType})),sample.bytes));
 test('A4 adaptation: truncated '+sample.mediaType+' with matching SHA-256 is rejected',()=>assert.throws(()=>validateAttachment(attachmentBody(sample.prefix,{filename:sample.filename,mediaType:sample.mediaType})),e=>e.status===400));
 test('A4 adaptation: closure outside bounded tail '+sample.mediaType+' is rejected',()=>assert.throws(()=>validateAttachment(attachmentBody(Buffer.concat([sample.bytes,Buffer.alloc(4097)]),{filename:sample.filename,mediaType:sample.mediaType})),e=>e.status===400));
}
test('unchanged text and WebP signatures remain supported; hostile declaration rejected',()=>{
 assert.ok(validateAttachment(attachmentBody()).length>0);
 const webp=Buffer.from('524946460400000057454250','hex');assert.deepEqual(validateAttachment(attachmentBody(webp,{filename:'FICTICIO-signature.webp',mediaType:'image/webp'})),webp);
 for(const patch of [{filename:'../FICTICIO-stage3.txt'},{entity:'DeliveryOrder'},{bytes:'invalid=='},{sha256:'0'.repeat(64)},{mediaType:'text/html'}])assert.throws(()=>validateAttachment(attachmentBody(undefined,patch)),e=>e.status===400);
});
