// Server-side OAuth only. The application requests gmail.send, never mailbox read.
export function gmailSender({from,clientId,clientSecret,refreshToken},request=fetch){
 if(!/^[a-z0-9._+%-]+@gmail\.com$/i.test(from||'')||![clientId,clientSecret,refreshToken].every(v=>typeof v==='string'&&v.length>10))throw Error('GMAIL_OAUTH_PROVISIONING_REQUIRED');
 let access,expires=0,refresh;
 async function token(){
  if(access&&Date.now()<expires)return access;
  if(!refresh)refresh=(async()=>{
   const r=await request('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
   if(!r.ok)throw Error('GMAIL_AUTHORIZATION_REQUIRED');const result=await r.json();
   if(typeof result.access_token!=='string'||!Number.isFinite(result.expires_in))throw Error('GMAIL_AUTHORIZATION_REQUIRED');
   access=result.access_token;expires=Date.now()+Math.max(0,result.expires_in-60)*1000;return access;
  })().finally(()=>{refresh=null;});return refresh;
 }
 return async({to,code,purpose,id})=>{
  if(!/^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/.test(to||'')||!/^\d{6}$/.test(code)||!['reset','verify'].includes(purpose)||!/^[a-f0-9-]{36}$/.test(id))throw Error('GMAIL_MESSAGE_REFUSED');
  try{
   const raw=Buffer.from(['From: '+from,'To: '+to,'Subject: Sistema Ruy - '+(purpose==='reset'?'Redefinir senha':'Confirmar e-mail'),'Message-ID: <'+id+'@ruy.local>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from('Seu código é '+code+'. Expira em 10 minutos. Não compartilhe. Se não solicitou, ignore esta mensagem.').toString('base64')].join('\r\n')).toString('base64url');
   const r=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/json'},body:JSON.stringify({raw})});
   if(!r.ok)throw Error();return {accepted:true};
  }catch{throw Error('MAIL_DELIVERY_NOT_CONFIRMED');}
 };
}
