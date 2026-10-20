import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {X509Certificate,randomUUID} from 'node:crypto';
import {home,installation,seal,unseal} from './environment.mjs';
// Never touches Windows certificate stores. Private keys persist only in DPAPI.
export async function installationCertificates(){
 if(!installation)return;
 try{return await unseal('installation-tls.dpapi');}catch(error){if(error.code!=='ENOENT')throw error;}
 const directory=path.join(home,'certificate-staging-'+randomUUID());
 await fs.mkdir(directory);
 const run=promisify(execFile),values={installationId:installation.id};
 try{
  for(const name of ['server','client']){
   const key=path.join(directory,name+'.key'),cert=path.join(directory,name+'.crt');
   await run('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','30','-subj','/CN='+installation.id+'-'+name,'-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true});
   values[name]={key:await fs.readFile(key,'utf8'),cert:await fs.readFile(cert,'utf8')};
   values[name].fingerprint=new X509Certificate(values[name].cert).fingerprint256;
  }
  await seal('installation-tls.dpapi',values);
  return values;
 }finally{
  // Only files created by this invocation, inside a fresh private directory.
  for(const name of ['server.key','server.crt','client.key','client.crt'])await fs.unlink(path.join(directory,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await fs.rmdir(directory);
 }
}
