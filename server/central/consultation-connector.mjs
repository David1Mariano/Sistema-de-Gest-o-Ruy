import fs from 'node:fs/promises';import path from 'node:path';import https from 'node:https';import {spawn,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {consultationConnectorAlive} from './connector-liveness.mjs';
import {dataRoot,json,regularDirectory,openProtectedText} from '../../scripts/homologacao/common.mjs';

// Owned by the existing consultation worker: its supervisor/SCM restarts both
// API and connector together. This module never installs services or edits DNS.
export async function startConsultationConnector({profile,root}){
 if(profile.enabled!==true||profile.httpsActivationApproved!==true||!profile.activationAuthorizationReference||profile.tunnel?.enabled!==true||profile.tunnel.publicationApproved!==true||profile.realDataReadOnlyPublicationApproved!==true)throw Error('REAL_DATA_READ_ONLY_PUBLICATION_AUTHORIZATION_REQUIRED');
 if(profile.exposure!=='cloudflare-tunnel'||profile.publicHostname!=='api.ruycaldodecana.com.br'||profile.tlsPort!==18726||profile.serverName!=='api.ruycaldodecana.com.br')throw Error('CONSULTATION_HTTPS_SCOPE_REQUIRED');
 const credentialsRoot=path.join(dataRoot,'cloudflare-homologacao-b5dcbb4c'),uuid='b5dcbb4c-83b9-43f0-af9e-927e86bcfc0d';await regularDirectory(credentialsRoot);
 const agent=path.join(credentialsRoot,'agent/cloudflared/cloudflared.exe'),verified=await json(path.join(credentialsRoot,'agent-verified.json'));
 if(verified.signature!=='Valid'||createHash('sha256').update(await fs.readFile(agent)).digest('hex')!==verified.sha256)throw Error('PINNED_OFFICIAL_CONNECTOR_REQUIRED');
 const caFile=path.join(root,'origin-ca.pem'),ca=await fs.readFile(caFile);if(ca.includes(Buffer.from('PRIVATE KEY')))throw Error('PUBLIC_CA_ONLY');
 const configFile=path.join(root,'cloudflare-consultation.yml');
 const checked=spawnSync(agent,['tunnel','--config',configFile,'ingress','validate'],{windowsHide:true,encoding:'utf8',timeout:10000});if(checked.status!==0||checked.error)throw Error('CONSULTATION_INGRESS_INVALID');
 // Verify the initial local ingress through cloudflared's own renderer before
 // connecting. Only the prepared YAML is permitted in this private profile.
 const yaml=await fs.readFile(configFile,'utf8');
 if(!/^[a-f0-9]{64}$/.test(profile.tunnel.configSha256||'')||createHash('sha256').update(yaml).digest('hex')!==profile.tunnel.configSha256)throw Error('REVIEWED_CONSULTATION_CONFIG_HASH_REQUIRED');
 if(!yaml.includes("tunnel: '"+uuid+"'")||!yaml.includes('service: https://127.0.0.1:18726')||yaml.includes('noTLSVerify: true')||/credentials-file:|token:/i.test(yaml))throw Error('TOKEN_ONLY_REVIEWED_CONFIG_REQUIRED');
 await new Promise((resolve,reject)=>{const req=https.request({host:'127.0.0.1',port:18726,servername:profile.serverName,ca,rejectUnauthorized:true,path:'/api/local/d1/connection',headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1','CF-Connecting-IP':'127.0.0.1','X-Forwarded-Proto':'https'},timeout:5000},res=>{res.resume();res.on('end',()=>res.statusCode===200?resolve():reject(Error('CONSULTATION_API_NOT_READY')));});req.on('error',()=>reject(Error('CONSULTATION_ORIGIN_TLS_FAILED')));req.on('timeout',()=>req.destroy());req.end();});
 const tokenFile=path.join(credentialsRoot,'tunnel-token.dpapi');if((await fs.lstat(tokenFile)).isSymbolicLink())throw Error('PROTECTED_TOKEN_REQUIRED');
 const token=await openProtectedText(tokenFile);
 let credential;try{credential=JSON.parse(Buffer.from(token,'base64url').toString('utf8'));}catch{throw Error('INVALID_TUNNEL_CREDENTIAL');}if(credential.t!==uuid||!credential.s)throw Error('EXACT_TUNNEL_CREDENTIAL_REQUIRED');
 const env={...process.env};for(const key of Object.keys(env))if(/^TUNNEL_|^CLOUDFLARE_|^PG|^NODE_OPTIONS$/.test(key))delete env[key];env.TUNNEL_TOKEN=token;
 const child=spawn(agent,['tunnel','--config',configFile,'--no-autoupdate','--output','json','--loglevel','info','--metrics','127.0.0.1:20241','--management-diagnostics=false','run'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
 let exited=false,stopped=false;child.once('error',()=>{exited=true;});child.once('exit',()=>{exited=true;});
 async function stop(){if(stopped)return;stopped=true;if(exited)return;await new Promise(resolve=>{const timer=setTimeout(resolve,10000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
 async function health(){
  if(stopped||exited)return false;
  try{return await consultationConnectorAlive({alive:!stopped&&!exited,caFile});}catch(error){if(error.securityFailure)await stop();return false;}
 }
 try{for(let attempt=0;attempt<12;attempt++){if(await health())return {health,stop};if(exited||stopped)break;await new Promise(resolve=>setTimeout(resolve,500));}throw Error('CONSULTATION_TUNNEL_NOT_HEALTHY');}catch(e){await stop();throw e;}
}
