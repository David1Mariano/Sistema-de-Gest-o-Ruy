import {randomUUID} from 'node:crypto';
import {attachmentHash} from '../../server/d1-lab/attachment-contract.mjs';
// Synthetic structural fixtures, not a claim of complete media decoding.
export const attachmentSamples=[
 {filename:'FICTICIO-complete.pdf',mediaType:'application/pdf',bytes:Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\nstartxref\n0\n%%EOF\n'),prefix:Buffer.from('%PDF-')},
 {filename:'FICTICIO-complete.png',mediaType:'image/png',bytes:Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex'),prefix:Buffer.from('89504e470d0a1a0a','hex')},
 {filename:'FICTICIO-complete.jpg',mediaType:'image/jpeg',bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9','hex'),prefix:Buffer.from('ffd8ff','hex')},
];
export function attachmentBody(bytes=Buffer.from('FICTICIO stage3 synthetic bytes'),patch={}){
 return {id:randomUUID(),operationId:randomUUID(),recordId:randomUUID(),recordVersion:1,entity:'Employee',filename:'FICTICIO-stage3.txt',mediaType:'text/plain',sha256:attachmentHash(bytes),bytes:bytes.toString('base64'),...patch};
}
