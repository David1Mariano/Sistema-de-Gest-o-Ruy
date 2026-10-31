import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {X509Certificate,createPublicKey,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
// Dedicated per-user directory. No copying operational DPAPI or DB profiles.
export async function sharedProfileHome(){
 if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('WINDOWS_REQUIRED');
 const root=path.join(process.env.LOCALAPPDATA,'GestaoRuy','shared-client');
 await fs.mkdir(root,{recursive:true});if((await fs.realpath(root)).toLowerCase()!==path.resolve(root).toLowerCase())throw Error('PROFILE_REDIRECTION_REFUSED');
 const sid=ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
 execFileSync('icacls.exe',[root,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,stdio:'ignore'});return root;
}
function ps(command,input){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input,encoding:'utf8',windowsHide:true,timeout:30000});if(r.error||r.status!==0)throw Error('PROFILE_PROTECTION_FAILED');return r.stdout.trim();}
async function seal(root,name,value){const data=ps('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify(value));await fs.writeFile(path.join(root,name),data,{flag:'wx'});}
async function unseal(root,name){return JSON.parse(ps('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}',await fs.readFile(path.join(root,name),'utf8')));}
// Minimal PKCS#10: RSA/SHA-256, CN=device UUID, no private data in the CSR.
const der=(tag,bytes)=>{const b=Buffer.from(bytes),n=b.length,hex=n.toString(16).padStart(n.toString(16).length+(n.toString(16).length%2),'0'),len=Buffer.from(hex,'hex');return Buffer.concat([Buffer.from([tag]),n<128?Buffer.from([n]):Buffer.concat([Buffer.from([128+len.length]),len]),b]);};
const seq=(...v)=>der(0x30,Buffer.concat(v));
export function makeDeviceRequest(){
 const deviceId=randomUUID(),keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const name=seq(der(0x31,seq(Buffer.from('0603550403','hex'),der(0x0c,'Ruy-device-'+deviceId))));
 const info=seq(Buffer.from('020100','hex'),name,keys.publicKey,Buffer.from('a000','hex'));
 const csr=seq(info,Buffer.from('300d06092a864886f70d01010b0500','hex'),der(0x03,Buffer.concat([Buffer.from([0]),sign('sha256',info,keys.privateKey)])));
 return {deviceId,key:keys.privateKey,csr:'-----BEGIN CERTIFICATE REQUEST-----\n'+csr.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE REQUEST-----\n'};
}
export function validateSharedProfile(profile){
 if(profile?.purpose!=='RUY_SHARED_CLIENT_LAB'||profile.contract!=='RUY-SHARED-LAB/1'||!/^[a-f0-9-]{36}$/.test(profile.deviceId)||!/^[a-f0-9]{64}$/.test(profile.token||''))throw Error('SHARED_PROFILE_REFUSED');
 const u=new URL(profile.endpoint),privateHost=/^(127\.0\.0\.1|10\.(?:\d+\.){2}\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(u.hostname);
 if(u.protocol!=='https:'||!privateHost||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.port)throw Error('PRIVATE_TLS_ENDPOINT_REQUIRED');
 const cert=new X509Certificate(profile.cert),ca=new X509Certificate(profile.ca),publicKey=createPublicKey(profile.key).export({type:'spki',format:'der'});
 if(!cert.publicKey.export({type:'spki',format:'der'}).equals(publicKey)||!cert.checkIssued(ca)||!cert.verify(ca.publicKey)||!ca.ca||cert.ca||!cert.subject.split('\n').includes('CN=Ruy-device-'+profile.deviceId)||!cert.keyUsage?.includes('1.3.6.1.5.5.7.3.2')||Date.parse(cert.validTo)<=Date.now()||Date.parse(cert.validFrom)>Date.now())throw Error('DEVICE_CERTIFICATE_REFUSED');
 return profile;
}
export async function createEnrollment(root){
 let pending;try{pending=await unseal(root,'pending-device.dpapi');}catch(error){if(error.code!=='ENOENT')throw error;pending=makeDeviceRequest();await seal(root,'pending-device.dpapi',pending);}return {deviceId:pending.deviceId,csr:pending.csr};
}
export async function importEnrollment(root,file){
 // The administrator supplies cert/CA/token; the private key never leaves this device.
 const info=await fs.stat(file);if(!info.isFile()||info.size>32768)throw Error('ENROLLMENT_FILE_REFUSED');
 const bundle=JSON.parse(await fs.readFile(file,'utf8')),pending=await unseal(root,'pending-device.dpapi');
 if(Object.keys(bundle).some(k=>!['purpose','contract','endpoint','deviceId','cert','ca','token'].includes(k))||bundle.deviceId!==pending.deviceId)throw Error('ENROLLMENT_IDENTITY_REFUSED');
 const profile=validateSharedProfile({...bundle,key:pending.key});await seal(root,'device-profile.dpapi',profile);return {deviceId:profile.deviceId};
}
export async function loadSharedProfile(root){return validateSharedProfile(await unseal(root,'device-profile.dpapi'));}
