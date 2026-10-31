import fs from 'node:fs/promises';import path from 'node:path';import https from 'node:https';import {spawn,spawnSync} from 'node:child_process';
import {dataRoot,openProtectedText} from '../../scripts/homologacao/common.mjs';import {verifyDiscovery} from './public-discovery.mjs';import {createHash} from 'node:crypto';

// Existing Microsoft Store ngrok, retained solely for rc.3 bootstrap discovery.
// No real-data API path is permitted by its traffic policy or local transport.
export async function startDiscoveryOnlyConnector({profile,root}){
 if(profile.enabled!==true||profile.realDataReadOnlyPublicationApproved!==true||profile.legacyDiscovery?.enabled!==true||profile.legacyDiscovery.publicationApproved!==true||profile.legacyDiscovery.ngrokEnabled!==true)throw Error('LEGACY_METADATA_ONLY_PUBLICATION_AUTHORIZATION_REQUIRED');
 const url='https://quill-brunt-splinter.ngrok-free.dev';
 let executable;
 if(profile.legacyDiscovery.storeAgent){const a=profile.legacyDiscovery.storeAgent;executable=path.resolve(a.path);const storePrefix=path.join(process.env.ProgramFiles,'WindowsApps','ngrok.ngrok_').toLowerCase();if(a.distribution!=='MicrosoftStore'||!executable.toLowerCase().startsWith(storePrefix)||path.basename(executable)!=='ngrok.exe'||createHash('sha256').update(await fs.readFile(executable)).digest('hex')!==a.sha256)throw Error('PINNED_STORE_DISTRIBUTION_REQUIRED');}
 else{const installed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-AppxPackage -Name ngrok.ngrok | Select-Object Name,SignatureKind,Status,InstallLocation | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true,timeout:10000});let pkg;try{pkg=JSON.parse(installed.stdout);}catch{throw Error('EXISTING_MICROSOFT_STORE_NGROK_REQUIRED');}if(pkg.Name!=='ngrok.ngrok'||pkg.SignatureKind!==3||pkg.Status!==0)throw Error('EXISTING_MICROSOFT_STORE_NGROK_REQUIRED');executable=path.join(pkg.InstallLocation,'ngrok.exe');}
 const encrypted=path.join(dataRoot,'ngrok-homologacao/ngrok-token.dpapi');if((await fs.lstat(encrypted)).isSymbolicLink())throw Error('PROTECTED_NGROK_TOKEN_REQUIRED');
 const token=(await openProtectedText(encrypted)).trim();if(!/^[A-Za-z0-9_-]{20,512}$/.test(token))throw Error('SERVICE_IDENTITY_NGROK_DPAPI_REQUIRED');
 const config=path.join(root,'ngrok-bootstrap.yml'),policy=path.join(root,'ngrok-bootstrap-policy.json');
 await fs.writeFile(config,'version: 3\nagent:\n  web_addr: false\n  console_ui: false\n  remote_management: false\n  log: false\n');
 await fs.writeFile(policy,JSON.stringify({on_http_request:[{expressions:["req.url.scheme != 'https' || req.url.path != '/.well-known/sistema-ruy.json'"],actions:[{type:'custom-response',config:{status_code:404,content:'Not found'}}]},{actions:[{type:'remove-headers',config:{headers:['x-ruy-proxy-client-ip','x-ruy-proxy-proto','cf-connecting-ip','x-forwarded-for','x-forwarded-proto']}},{type:'add-headers',config:{headers:{'x-ruy-proxy-client-ip':'${conn.client_ip}','x-ruy-proxy-proto':'https'}}}]}]},null,2));
 const env={...process.env};for(const key of Object.keys(env))if(/^NGROK_|^TUNNEL_|^CLOUDFLARE_|^PG|^NODE_OPTIONS$/.test(key))delete env[key];env.NGROK_AUTHTOKEN=token;
 const child=spawn(executable,['http','https://127.0.0.1:18716','--url',url,'--upstream-tls-verify','--upstream-tls-verify-cas',path.join(root,'origin-ca.pem'),'--traffic-policy-file',policy,'--inspect=false','--config',config,'--log','stdout','--log-format','json'],{env,cwd:root,windowsHide:true,stdio:['ignore','pipe','ignore']});
 let exited=false,accepted=false,pending='',stopped=false;child.once('error',()=>{exited=true;});child.once('exit',()=>{exited=true;});
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{pending+=chunk;if(pending.length>65536){child.kill();return;}const lines=pending.split('\n');pending=lines.pop();for(const line of lines)try{const event=JSON.parse(line);if(event.msg==='started tunnel'&&event.url===url)accepted=true;}catch{/* Never persist raw provider output. */}});
 async function stop(){if(stopped)return;stopped=true;if(exited)return;await new Promise(resolve=>{const t=setTimeout(resolve,10000);child.once('exit',()=>{clearTimeout(t);resolve();});child.kill();});}
 try{
  for(let i=0;i<30&&!accepted&&!exited;i++)await new Promise(resolve=>setTimeout(resolve,500));if(!accepted||exited)throw Error('LEGACY_METADATA_CONNECTOR_NOT_READY');
  const document=await new Promise((resolve,reject)=>{const req=https.request(url+'/.well-known/sistema-ruy.json',{rejectUnauthorized:true,headers:{'ngrok-skip-browser-warning':'1'},timeout:5000},res=>{let bytes='';res.on('data',b=>{bytes+=b;if(bytes.length>8192)res.destroy(Error('METADATA_LIMIT'));});res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw Error('METADATA_RESPONSE');resolve(JSON.parse(bytes));}catch{reject(Error('LEGACY_METADATA_RESPONSE_INVALID'));}});});req.on('error',reject);req.on('timeout',()=>req.destroy());req.end();});
  const verified=verifyDiscovery(document,{publicKey:profile.discovery.publicKey,deploymentId:profile.discovery.deploymentId,minimumGeneration:profile.discovery.generation});if(verified.endpoint!=='https://api.ruycaldodecana.com.br')throw Error('OFFICIAL_SIGNED_DISCOVERY_REQUIRED');
  return {health:async()=>!exited&&!stopped&&accepted,stop};
 }catch(e){await stop();throw e;}
}
