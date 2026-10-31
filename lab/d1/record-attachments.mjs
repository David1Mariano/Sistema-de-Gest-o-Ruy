import {validatePayableAttachmentFile} from '../../src/lib/payableAttachment.js';
import {verifiedPdfDocument} from '../../src/components/rh/PdfPages.jsx';
export function attachmentUploadMessage(error){
 if(error.status===401)return 'Sessão expirada. Entre novamente para enviar o comprovante.';
 if(error.status===403)return 'Acesso negado: sua conta não pode anexar a este registro.';
 if(error.status===413)return 'O arquivo excede o limite de 15 MiB.';
 if(error.status===409)return 'O registro foi alterado. Reabra a ficha antes de tentar novamente.';
 if(error.status===503){if(/armazenamento/i.test(error.message))return 'Falha de armazenamento central. O envio não foi confirmado.';return 'Falha de rede ou central indisponível. O envio não foi confirmado; tente novamente.';}
 return error.message||'Não foi possível validar o arquivo.';
}
export function createRecordAttachments({request,getSession}){
 async function inspect(file){await validatePayableAttachmentFile(file);const ext=file.name.split('.').at(-1).toLowerCase(),mediaType=({pdf:'application/pdf',jpeg:'image/jpeg',jpg:'image/jpeg',png:'image/png',webp:'image/webp'})[ext],bytes=new Uint8Array(await file.arrayBuffer());if(mediaType==='application/pdf'){try{const doc=await verifiedPdfDocument(bytes.slice());await doc.destroy();}catch(error){throw Error(error.name==='PasswordException'?'PDF protegido por senha: selecione uma cópia autorizada sem senha.':'PDF inválido ou incompleto. O envio não foi realizado.');}}return {bytes,mediaType};}
 return {inspect,async upload({file,recordId,recordVersion,entity,field}){
  const session=getSession();if(!session?.sharedMode)throw Error('Serviço central de anexos indisponível neste perfil.');
  const {bytes,mediaType}=await inspect(file);const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const key='ruy-inline-upload:'+session.user.id+':'+recordId+':'+field+':'+sha256+':'+file.name;
  const intent=JSON.parse(localStorage.getItem(key)||'null')||{id:crypto.randomUUID(),operationId:crypto.randomUUID(),recordVersion};localStorage.setItem(key,JSON.stringify(intent));
  try{const chunks=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
   const receipt=await request('/attachments',{...intent,recordId,entity,field,filename:file.name,mediaType,sha256,bytes:btoa(chunks.join(''))});
   if(receipt.recordId!==recordId||receipt.sha256!==sha256||!/^[a-f0-9-]{36}$/.test(receipt.id))throw Error('Recibo central incompatível. O envio ainda não foi confirmado.');
   localStorage.removeItem(key);window.dispatchEvent(new Event('d1-changed'));return {confirmed:true,file_url:'/api/d1/attachments/'+receipt.id+'/download',id:receipt.id,sha256,metadata:{filename:file.name,mediaType,size:bytes.length}};
  }catch(error){if(error.status>=400&&error.status<500&&![408,429].includes(error.status))localStorage.removeItem(key);throw Object.assign(Error(attachmentUploadMessage(error)),{status:error.status});}
 },async related(recordId){const [old,live]=await Promise.all([request('/history/attachments-for-record?record='+recordId),request('/attachments/remote?record='+recordId)]);return [...old.records,...live.records.filter(f=>!old.records.some(o=>o.id===f.id)).map(f=>({...f,url:'/api/d1/attachments/'+f.id+'/download'}))];}};
}
