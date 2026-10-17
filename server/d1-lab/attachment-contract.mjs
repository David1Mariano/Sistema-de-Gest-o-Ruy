import {createHash} from 'node:crypto';
import {fail,uuid} from './core.mjs';
const entities=['Employee','FinancialExpense','EmployeePayment','AccountsPayable','DailyProduction'];
export const attachmentHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateAttachment(body){
 if(!body||Object.keys(body).sort().join(',')!=='bytes,entity,filename,id,mediaType,operationId,recordId,recordVersion,sha256'||!uuid(body.id)||!uuid(body.operationId)||!uuid(body.recordId)||!entities.includes(body.entity)||!Number.isSafeInteger(body.recordVersion)||body.recordVersion<1||!/^FICTICIO-[a-zA-Z0-9_-]+\.(pdf|png|jpg|webp|txt)$/.test(body.filename||'')||!['application/pdf','image/png','image/jpeg','image/webp','text/plain'].includes(body.mediaType)||!/^[a-f0-9]{64}$/.test(body.sha256||'')||typeof body.bytes!=='string'||body.bytes.length>699052)throw fail(400,'Invalid synthetic attachment.');
 const bytes=Buffer.from(body.bytes,'base64');
 if(!bytes.length||bytes.length>524288||bytes.toString('base64')!==body.bytes||attachmentHash(bytes)!==body.sha256)throw fail(400,'Attachment integrity failed.');
 const type=body.mediaType,ext=body.filename.split('.').at(-1);
 if(type==='text/plain'?ext!=='txt'||!bytes.toString('utf8').startsWith('FICTICIO ')||!Buffer.from(bytes.toString('utf8')).equals(bytes):type==='application/pdf'?ext!=='pdf'||bytes.subarray(0,5).toString()!=='%PDF-':type==='image/png'?ext!=='png'||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a':type==='image/jpeg'?ext!=='jpg'||bytes.subarray(0,3).toString('hex')!=='ffd8ff':ext!=='webp'||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP')throw fail(400,'Attachment media mismatch.');
 return bytes;
}
