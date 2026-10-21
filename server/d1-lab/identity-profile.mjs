import {installation,unseal} from './environment.mjs';
import {createIdentity} from './identity.mjs';
import {web3formsSender} from './web3forms-mail.mjs';
export async function loadIdentity(pool){
 if(installation?.id!=='final-dev-20261021')return null;
 let c;try{c=await unseal('identity-service.dpapi');}catch{throw Error('IDENTITY_PROVISIONING_REQUIRED');}
 if(c.purpose!=='RUY_INDIVIDUAL_IDENTITY_DEV'||c.installationId!==installation.id)throw Error('IDENTITY_PROFILE_REFUSED');
 const pepper=Buffer.from(c.pepper||'','base64');
 let mail=c.mail;
 if(c.mail?.provider==='web3forms-dpapi'){
  mail=await unseal('web3forms-confirmed.dpapi');if(mail.purpose!=='RUY_WEB3FORMS_FIXED_RECIPIENT'||mail.installationId!==installation.id||mail.deliveryConfirmed!==true)throw Error('WEB3FORMS_PROFILE_REFUSED');
 }
 const sender=mail?.provider==='web3forms'&&mail.deliveryConfirmed===true?web3formsSender(mail):async()=>{throw Error('MAIL_NOT_PROVISIONED');};
 return createIdentity({pool,pepper,sender});
}
