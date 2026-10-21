// Backend only. Provider acceptance is NOT proof of delivery or verification.
const address=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
export function brevoSender({apiKey,senderEmail,senderVerified},request=fetch){
 if(typeof apiKey!=='string'||apiKey.length<20||apiKey.length>512||/\s/.test(apiKey)||!address(senderEmail)||senderVerified!==true)throw Error('BREVO_BACKEND_CONFIGURATION_REQUIRED');
 const send=async({to,code,purpose})=>{
  if(!address(to)||!/^\d{6}$/.test(String(code))||!['verify','reset'].includes(purpose))throw Error('BREVO_MESSAGE_REFUSED');
  let response,data;
  try{
   response=await request('https://api.brevo.com/v3/smtp/email',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'api-key':apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({sender:{email:senderEmail,name:'Sistema Ruy'},to:[{email:to}],subject:purpose==='verify'?'Sistema Ruy - Confirmacao de e-mail':'Sistema Ruy - Redefinicao de senha',textContent:'Seu codigo: '+code+'\nExpira em 10 minutos e pode ser usado uma unica vez. Nao compartilhe. Se nao solicitou, ignore esta mensagem.'})});
   if(response.status===201)data=await response.json();
  }catch{throw Object.assign(Error('BREVO_ACCEPTANCE_NOT_CONFIRMED'),{providerStatus:response?.status||null});}
  if(response.status!==201||typeof data?.messageId!=='string'||!data.messageId.trim()||data.messageId.length>512)throw Object.assign(Error('BREVO_ACCEPTANCE_NOT_CONFIRMED'),{providerStatus:response.status});
  // No automatic retry: an ambiguous transport failure may already have sent mail.
  return {accepted:true,deliveryVerified:false};
 };
 send.accepts=address;
 return Object.freeze(send);
}
