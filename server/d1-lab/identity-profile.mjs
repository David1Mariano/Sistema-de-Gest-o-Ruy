import {installation,unseal} from './environment.mjs';
import {createIdentity} from './identity.mjs';
import {resendSender} from './identity-mail.mjs';
import {gmailSender} from './gmail-mail.mjs';
export async function loadIdentity(pool){
 if(installation?.id!=='final-dev-20261021')return null;
 let c;try{c=await unseal('identity-service.dpapi');}catch{throw Error('IDENTITY_PROVISIONING_REQUIRED');}
 if(c.purpose!=='RUY_INDIVIDUAL_IDENTITY_DEV'||c.installationId!==installation.id)throw Error('IDENTITY_PROFILE_REFUSED');
 const pepper=Buffer.from(c.pepper||'','base64');
 let mail=c.mail;
 if(c.mail?.provider==='gmail-oauth-dpapi'){
  mail=await unseal('gmail-oauth.dpapi');if(mail.purpose!=='RUY_GMAIL_SEND_ONLY'||mail.installationId!==installation.id)throw Error('GMAIL_PROFILE_REFUSED');
 }
 const sender=mail?.provider==='gmail'?gmailSender(mail):mail?.provider==='resend'?resendSender(mail):async()=>{throw Error('MAIL_NOT_PROVISIONED');};
 return createIdentity({pool,pepper,sender});
}
