// Reuses the SINGLE attachment viewer; only its transport is local and authenticated.
export {PAYMENT_PROOF_DIAG,PAYMENT_PROOF_PREFIX,PAYMENT_PROOF_TYPES,PAYMENT_PROOF_MAX_BYTES,validatePaymentProofFile,paymentProofExtension} from '../../src/lib/paymentProof.js';
import {validateContent} from '../../src/lib/paymentProof.js';
export async function uploadPaymentProof(){throw Error('Utilize o mecanismo autenticado de anexos da instalação; upload direto ao Supabase desativado.');}
export async function loadPaymentProof(record,options={}){
  // Chain mirrors attachmentViewer.js:129 — a payment-proof record may carry the
  // URL under proof_url, file_url or attachment_url. Never confuse these with
  // general attachments (those use the central /attachments/ routes).
  const proofField=record?.proof_url||record?.file_url||record?.attachment_url;
  let url;try{url=new URL(proofField,location.origin);}catch{throw Error('Comprovante local indisponível.');}
 if(url.origin!==location.origin||!/^\/api\/d1\/(?:(?:migrated|history)\/)?attachments\/[a-f0-9-]{36}\/download$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('Comprovante fora do servidor autorizado.');
 const response=await fetch(url.href,{credentials:'same-origin',redirect:'error',signal:options.signal,referrerPolicy:'no-referrer'});
 if(!response.ok)throw Error('Comprovante indisponível ou acesso não autorizado.');
 const expected=response.headers.get('X-Content-SHA256');if(!/^[a-f0-9]{64}$/.test(expected||''))throw Error('Integridade do comprovante não confirmada.');
 const bytes=await response.arrayBuffer(),actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(actual!==expected)throw Error('Integridade do comprovante não confirmada.');
 return validateContent(new Blob([bytes],{type:(response.headers.get('Content-Type')||'').split(';')[0]}));
}
