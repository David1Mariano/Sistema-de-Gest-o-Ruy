// Temporary connector only: existing approved synthetic API, CurrentUser DPAPI,
// no service registration, no DNS mutation, no client discovery publication.
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {json,dataRoot,project} from '../homologacao/common.mjs';
import {verifyHomologationTunnelConfig} from '../../server/central/cloudflare-origin-policy.mjs';

if(process.env.COMPUTERNAME!=='ADM-RUY')throw Error('ADM_RUY_REQUIRED');
const uuid='b5dcbb4c-83b9-43f0-af9e-927e86bcfc0d';
const root=path.join(dataRoot,'cloudflare-homologacao-b5dcbb4c');
const tokenFile=path.join(root,'tunnel-token.dpapi');
const executable=path.join(root,'agent/cloudflared/cloudflared.exe');
const caFile=path.join(dataRoot,'central-lab-79402bbf27e83425/test-ca.pem');
const statusFile=path.join(root,'connector-status.json');
const stopFile=path.join(root,'connector.stop');
const authorization=await json(path.join(root,'origin-authorization.json'));
if(authorization.originRestartApproved!==true||authorization.businessDataSyntheticOnly!==true||authorization.allowRealBusinessDataPublication!==false||authorization.clientEndpointChangeApproved!==false||Date.parse(authorization.expiresAt)<=Date.now())throw Error('CURRENT_TEMPORARY_HOMOLOGATION_AUTHORIZATION_REQUIRED');
if((await fs.realpath(root)).toLowerCase()!==path.resolve(root).toLowerCase())throw Error('REDIRECTED_CREDENTIAL_ROOT_REFUSED');
const verified=await json(path.join(root,'agent-verified.json'));
if(createHash('sha256').update(await fs.readFile(executable)).digest('hex')!==verified.sha256||verified.signature!=='Valid')throw Error('VERIFIED_OFFICIAL_AGENT_REQUIRED');
let state={at:new Date().toISOString(),tunnelUuid:uuid,temporary:true,expiresAt:authorization.expiresAt,phase:'waiting-local-credential',managementMode:'unconfirmed',remoteConfigurationValidated:false,effectiveConfigurationValidated:false,healthy:false,realBusinessDataPublished:false,clientEndpointsChanged:false,serviceInstalled:false};
const save=async extra=>{state={...state,...extra,at:new Date().toISOString()};await fs.writeFile(statusFile,JSON.stringify(state,null,2));};
const exists=file=>fs.stat(file).then(()=>true,()=>false);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
await save({});
const waitUntil=Math.min(Date.now()+15*60*1000,Date.parse(authorization.expiresAt));
while(!await exists(tokenFile)){
 if(await exists(stopFile)||Date.now()>=waitUntil){await save({phase:'credential-not-provisioned'});process.exit(2);}
 await wait(1000);
}
const provisioning=await json(path.join(root,'provisioning.json'));
if(provisioning.contract!=='RUY_CLOUDFLARE_LOCAL_PROVISIONING/1'||provisioning.tunnelUuid!==uuid||provisioning.managementModeConfirmedByOperator!=='cloudflare'||provisioning.routeConfirmedByOperator!==true)throw Error('OPERATOR_REMOTE_ROUTE_CONFIRMATION_REQUIRED');
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"],{input:await fs.readFile(tokenFile,'utf8'),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8192});
if(result.status!==0||result.error)throw Error('CURRENT_USER_DPAPI_REQUIRED');
const token=result.stdout;
let credential;try{credential=JSON.parse(Buffer.from(token,'base64url').toString('utf8'));}catch{throw Error('INVALID_TUNNEL_CREDENTIAL');}
if(credential.t!==uuid||!credential.s)throw Error('EXACT_TUNNEL_CREDENTIAL_REQUIRED');
const ca=await fs.readFile(caFile);
await new Promise((resolve,reject)=>{
 const req=https.request({host:'127.0.0.1',port:18716,servername:'ADM-RUY',ca,rejectUnauthorized:true,path:'/api/local/d1/connection',timeout:5000,headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1','CF-Connecting-IP':'127.0.0.1','X-Forwarded-Proto':'https'}},res=>{res.resume();res.on('end',()=>res.statusCode===200?resolve():reject(Error('HOMOLOGATION_ORIGIN_NOT_READY')));});req.on('error',()=>reject(Error('HOMOLOGATION_ORIGIN_TLS_FAILED')));req.on('timeout',()=>req.destroy());req.end();
});
const env={...process.env};for(const key of Object.keys(env))if(/^TUNNEL_|^CLOUDFLARE_/.test(key))delete env[key];env.TUNNEL_TOKEN=token;
// The dashboard token authenticates the same tunnel. Supply the reviewed local
// ingress as its initial configuration when no remote route has been published.
// Remote updates remain enabled and are checked against the same origin policy.
const template=await fs.readFile(path.join(project,'artifacts/dominio-oficial-20261029/homologacao/cloudflare-tunnel.yml'),'utf8');
const runtimeConfig=path.join(root,'homologation-ingress.yml');
await fs.writeFile(runtimeConfig,template.replace(/^credentials-file:.*\r?\n/m,''));
const validation=spawnSync(executable,['tunnel','--config',runtimeConfig,'ingress','validate'],{windowsHide:true,encoding:'utf8',timeout:10000});
if(validation.status!==0||validation.error)throw Error('REVIEWED_LOCAL_INGRESS_INVALID');
const child=spawn(executable,['tunnel','--config',runtimeConfig,'--no-autoupdate','--loglevel','info','--output','json','--metrics','127.0.0.1:20241','--grace-period','10s','--management-diagnostics=false','run'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
await save({phase:'connecting',pid:child.pid,managementMode:'cloudflare-operator-confirmed',credentialProtected:true,originTlsValidated:true});
let closed=false,stopping=false,connections=0,logQueue=Promise.resolve();
const stop=async(reason)=>{if(stopping||closed)return;stopping=true;await save({phase:reason,healthy:false});child.kill('SIGTERM');};
const consume=stream=>{
 let pending='';stream.setEncoding('utf8');stream.on('data',chunk=>{
  pending+=chunk;if(pending.length>512*1024){void stop('agent-log-limit');return;}
  const lines=pending.split('\n');pending=lines.pop();
  for(const raw of lines){logQueue=logQueue.then(async()=>{
   if(closed||stopping)return;
   let entry;try{entry=JSON.parse(raw);}catch{return;}
   // Never persist raw settings, configuration, URLs or opaque agent errors.
   // Record event categories only, so no token or remote credential can leak.
   const event=entry.config?'configuration-received':/Registered tunnel connection/.test(entry.message||'')?'connection-registered':entry.level==='error'?'agent-error':entry.level==='warn'?'agent-warning':'agent-info';
   await fs.appendFile(path.join(root,'connector.sanitized.log'),JSON.stringify({at:new Date().toISOString(),event})+'\n');
   if(entry.config){
    try{verifyHomologationTunnelConfig(typeof entry.config==='string'?JSON.parse(entry.config):entry.config,caFile);await save({remoteConfigurationValidated:true,effectiveConfigurationValidated:true,effectiveConfigurationSource:'cloudflare',managementMode:'cloudflare',phase:'configured'});}
    catch(e){await save({configurationFailure:e.message});await stop('unsafe-or-missing-remote-origin-configuration');return;}
   }
   if(/Registered tunnel connection/.test(entry.message||'')){connections++;await save({connectionsObserved:connections});}
  }).catch(()=>void stop('connector-processing-failed'));}
 });
};
consume(child.stdout);consume(child.stderr);
const poll=setInterval(async()=>{
 if(stopping||closed)return;
 if(Date.now()>=Date.parse(authorization.expiresAt)||await exists(stopFile)){await stop('temporary-activation-ended');return;}
 if(connections){
  try{
   const configResponse=await fetch('http://127.0.0.1:20241/config',{signal:AbortSignal.timeout(2000)});
   if(!configResponse.ok)throw Error('EFFECTIVE_CONFIG_UNAVAILABLE');
   const current=await configResponse.json();
   try{verifyHomologationTunnelConfig(current.config,caFile);}catch(e){await save({configurationFailure:e.message});await stop('unsafe-effective-origin-configuration');return;}
   const r=await fetch('http://127.0.0.1:20241/ready',{signal:AbortSignal.timeout(2000)});
   await save({effectiveConfigurationValidated:true,effectiveConfigurationVersion:current.version,effectiveConfigurationSource:current.version>=0?'cloudflare':'local-pinned-ingress',remoteConfigurationValidated:current.version>=0,healthy:r.status===200,phase:r.status===200?'healthy':'connecting'});
  }catch{await save({healthy:false});}
 }
},3000);
const configurationDeadline=setTimeout(()=>{if(!state.effectiveConfigurationValidated)void stop('effective-configuration-not-validated');},45000);
child.on('error',()=>{closed=true;clearInterval(poll);clearTimeout(configurationDeadline);void save({phase:'agent-process-error',healthy:false});});
child.on('exit',code=>{closed=true;clearInterval(poll);clearTimeout(configurationDeadline);void logQueue.finally(()=>save({phase:stopping?state.phase:'agent-exited',exitCode:code,healthy:false}));});
process.on('SIGINT',()=>void stop('operator-stop'));process.on('SIGTERM',()=>void stop('operator-stop'));
