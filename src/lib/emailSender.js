// Legacy browser sender retired. Web3Forms configuration belongs exclusively to
// server/d1-lab/web3forms-mail.mjs and the protected backend profile.
// Never accept a browser-generated code or return a demonstrative OTP.
export const emailConfig=Object.freeze({serverOnly:true});
export function isEmailConfigured(){return false;}
export async function sendVerificationCode(){
 throw Object.assign(new Error('Envio de confirmação disponível somente pelo serviço de autenticação no servidor.'),{status:503});
}
