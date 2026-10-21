// Official HTTPS sending endpoint; no invocation without explicit provisioning.
export function resendSender({apiKey,from},request=fetch){
 if(typeof apiKey!=='string'||apiKey.length<16||typeof from!=='string'||from.length>254||/[\r\n]/.test(from)||!from.includes('@'))throw Error('MAIL_CONFIGURATION_REQUIRED');
 return async({to,code,purpose,id})=>{
  let response;
  try{response=await request('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from,to:[to],subject:purpose==='reset'?'Sistema Ruy — redefinição de senha':'Sistema Ruy — confirmação de e-mail',text:'Seu código é '+code+'. Ele expira em 10 minutos. Não compartilhe este código. Se não solicitou, ignore esta mensagem.'})});}catch{throw Error('MAIL_DELIVERY_NOT_CONFIRMED');}
  if(!response.ok)throw Error('MAIL_DELIVERY_NOT_CONFIRMED');
  return {accepted:true};
 };
}
