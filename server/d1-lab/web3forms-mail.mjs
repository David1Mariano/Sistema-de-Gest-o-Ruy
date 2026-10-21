// Server-only adapter for the EXISTING Web3Forms form. Free notifications have a
// fixed recipient bound to the key; replyto/to cannot authorize arbitrary users.
export function web3formsSender({accessKey,recipient},request=fetch){
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(accessKey||'')||typeof recipient!=='string'||recipient.length>254||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient))throw Error('WEB3FORMS_BACKEND_CONFIGURATION_REQUIRED');
 const fixedRecipient=recipient.trim().toLowerCase();
 const send=async({to,code,purpose})=>{
  if(String(to).trim().toLowerCase()!==fixedRecipient)throw Error('WEB3FORMS_FIXED_RECIPIENT_REFUSED');
  if(!/^\d{6}$/.test(String(code))||!['verify','reset'].includes(purpose))throw Error('WEB3FORMS_MESSAGE_REFUSED');
  let response,data;
  try{
   response=await request('https://api.web3forms.com/submit',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({access_key:accessKey,subject:'Sistema Ruy - '+(purpose==='verify'?'Confirmacao de e-mail':'Redefinicao de senha'),from_name:'Sistema Ruy',botcheck:false,message:'Código de confirmação: '+code+'\nExpira em 10 minutos e pode ser utilizado uma única vez. Não compartilhe. Se não solicitou, ignore esta mensagem.'})});
   data=await response.json();
  }catch(e){throw Object.assign(Error('WEB3FORMS_ACCEPTANCE_NOT_CONFIRMED'),{providerStatus:response?.status||null,transportCode:/^[A-Z_0-9]{1,60}$/.test(e.cause?.code||e.code||'')?e.cause?.code||e.code:response?'NON_JSON_RESPONSE':'REQUEST_FAILED'});}
  if(!response.ok||data?.success!==true)throw Object.assign(Error('WEB3FORMS_ACCEPTANCE_NOT_CONFIRMED'),{providerStatus:response.status});
  return {accepted:true,deliveryVerified:false,recipientMode:'fixed'};
 };
 send.accepts=to=>typeof to==='string'&&to.trim().toLowerCase()===fixedRecipient;
 return Object.freeze(send);
}
