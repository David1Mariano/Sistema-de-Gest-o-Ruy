import {centralOperational} from '../central/context.mjs';
import {createHash} from 'node:crypto';
import {fail,uuid} from './core.mjs';
const entities=['Employee','FinancialExpense','EmployeePayment','Vale','AccountsPayable','DailyProduction','Revenue','AccountsReceivable','Purchase','ProductionOrder'];
export const MAX_ATTACHMENT_BYTES=15*1024*1024;
export function attachmentFilename(name){return typeof name==='string'&&name.length<=180&&!/[<>:"/\\|?*]/.test(name)&&![...name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&!/[. ]$/.test(name)&&!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)&&/\.(pdf|png|jpe?g|webp|txt)$/i.test(name);}
export const attachmentHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateAttachment(body,{operational=centralOperational()}={}){
 const keys=body&&Object.keys(body).filter(k=>k!=='field').sort().join(',');
 if(!body||keys!=='bytes,entity,filename,id,mediaType,operationId,recordId,recordVersion,sha256'||body.field!==undefined&&(!operational||!['document_url','proof_url','invoice_url','file_url','photo_url','attachment_url'].includes(body.field))||!uuid(body.id)||!uuid(body.operationId)||!uuid(body.recordId)||!entities.includes(body.entity)||!Number.isSafeInteger(body.recordVersion)||body.recordVersion<1||!(operational?attachmentFilename(body.filename):/^FICTICIO-[a-zA-Z0-9_-]+\.(pdf|png|jpg|webp|txt)$/.test(body.filename||''))||!['application/pdf','image/png','image/jpeg','image/webp','text/plain'].includes(body.mediaType)||!/^[a-f0-9]{64}$/.test(body.sha256||'')||typeof body.bytes!=='string'||body.bytes.length>(operational?Math.ceil(MAX_ATTACHMENT_BYTES/3)*4:699052))throw fail(400,'Nome, vínculo ou tipo de anexo inválido.');
 const bytes=Buffer.from(body.bytes,'base64');
 if(!bytes.length||bytes.length>(operational?MAX_ATTACHMENT_BYTES:524288)||bytes.toString('base64')!==body.bytes||attachmentHash(bytes)!==body.sha256)throw fail(400,'Attachment integrity failed.');
 const type=body.mediaType,ext=body.filename.split('.').at(-1).toLowerCase().replace('jpeg','jpg');
 if(type==='text/plain'?ext!=='txt'||!operational&&!bytes.toString('utf8').startsWith('FICTICIO ')||!Buffer.from(bytes.toString('utf8')).equals(bytes):type==='application/pdf'?ext!=='pdf'||bytes.subarray(0,5).toString()!=='%PDF-':type==='image/png'?ext!=='png'||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a':type==='image/jpeg'?ext!=='jpg'||bytes.subarray(0,3).toString('hex')!=='ffd8ff':ext!=='webp'||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP')throw fail(400,'Attachment media mismatch.');
 // A matching digest proves byte identity, not that an upload has a closing marker.
 // Adapted from A4: bounded structural check, not a complete media parser.
 const closing={'application/pdf':Buffer.from('%%EOF'),'image/png':Buffer.from('IEND'),'image/jpeg':Buffer.from([0xff,0xd9])}[type];
 if(closing&&!bytes.subarray(-4096).includes(closing))throw fail(400,'Incomplete attachment content.');
 if(operational&&type==='application/pdf'){
  const markers=[...bytes.subarray(-4096).toString('latin1').matchAll(/startxref\s+(\d+)\s+%%EOF/g)],offset=Number(markers.at(-1)?.[1]);
  if(!Number.isSafeInteger(offset)||offset<5||offset>=bytes.length||!/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(bytes.subarray(offset,offset+60).toString('latin1')))throw fail(400,'Estrutura PDF inválida ou incompleta.');
 }
 return bytes;
}
