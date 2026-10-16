import {randomBytes,scrypt,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt),purpose='RUY_D1_RECOVERY_KEY',aad=Buffer.from(purpose+':1');
function password(value){
 if(typeof value!=='string'||value.length<16||Buffer.byteLength(value)>1024)throw Error('Frase de recuperação deve ter entre 16 caracteres e 1024 bytes.');
}
export async function wrapRecoveryKey(key,deviceId,passphrase){
 password(passphrase);
 if(!Buffer.isBuffer(key)||key.length!==32||typeof deviceId!=='string'||!/^[a-f0-9-]{36}$/i.test(deviceId))throw Error('Chave/dispositivo inválido.');
 const salt=randomBytes(16),iv=randomBytes(12),derived=await derive(passphrase,salt,32,{N:131072,r:8,p:1,maxmem:256*1024*1024});
 try{
  const cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(aad);
  const payload=Buffer.from(JSON.stringify({key:key.toString('hex'),deviceId}));
  try{return JSON.stringify({purpose,version:1,kdf:'scrypt-131072-8-1',salt:salt.toString('hex'),iv:iv.toString('hex'),ciphertext:Buffer.concat([cipher.update(payload),cipher.final()]).toString('hex'),tag:cipher.getAuthTag().toString('hex'),fingerprint:createHash('sha256').update(key).digest('hex')});}
  finally{payload.fill(0);}
 }finally{derived.fill(0);}
}
export async function unwrapRecoveryKey(bytes,passphrase){
 password(passphrase);
 if(Buffer.byteLength(bytes)>8192)throw Error('Envelope de recuperação inválido.');
 const value=JSON.parse(String(bytes));
 const hex=(text,length)=>typeof text==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(text);
 if(value.purpose!==purpose||value.version!==1||value.kdf!=='scrypt-131072-8-1'||!hex(value.salt,32)||!hex(value.iv,24)||!hex(value.tag,32)||!hex(value.fingerprint,64)||typeof value.ciphertext!=='string'||!/^([a-f0-9]{2}){1,1024}$/.test(value.ciphertext))throw Error('Envelope de recuperação inválido.');
 const derived=await derive(passphrase,Buffer.from(value.salt,'hex'),32,{N:131072,r:8,p:1,maxmem:256*1024*1024});let clear;
 try{
  const decipher=createDecipheriv('aes-256-gcm',derived,Buffer.from(value.iv,'hex'));decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(value.tag,'hex'));
  clear=Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'hex')),decipher.final()]);
  const payload=JSON.parse(clear.toString());
  if(!hex(payload.key,64)||typeof payload.deviceId!=='string'||!/^[a-f0-9-]{36}$/i.test(payload.deviceId))throw Error('Chave de recuperação inválida.');
  const key=Buffer.from(payload.key,'hex');if(createHash('sha256').update(key).digest('hex')!==value.fingerprint){key.fill(0);throw Error('Fingerprint divergente.');}
  return {key,deviceId:payload.deviceId};
 }finally{derived.fill(0);clear?.fill(0);}
}
