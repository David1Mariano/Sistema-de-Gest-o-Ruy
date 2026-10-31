// Temporary server-only ngrok agent. No service installation or operational data.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {X509Certificate,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {publicApiOrigin,verifyDiscovery} from '../../server/central/public-discovery.mjs';
import {sendUserTLS} from '../../server/sync-lab/user-transport.mjs';
const repo=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=async f=>JSON.parse((await fs.readFile(f,'utf8')).replace(/^\uFEFF/,''));
async function centralState(file){
 // The preserved LAN controller may publish a small status file in-place.
 // Retry a concurrent write; never confuse it with authorized shutdown.
 for(let attempt=0;attempt<3;attempt++)try{return await read(file);}catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
}
const receiptFile=path.resolve(process.argv[2]||''),output=path.resolve(process.argv[3]||'');
assert.ok(receiptFile.startsWith(path.join(repo,'artifacts','homologacao-lan-ativa-'))&&path.basename(receiptFile)==='server.json');
assert.ok(output.startsWith(path.join(repo,'artifacts','ngrok-homologacao-')));
const receipt=await read(receiptFile),config=await read(path.join(receipt.profile,'ngrok-public.json'));
assert.equal(process.env.COMPUTERNAME,'ADM-RUY');assert.equal(receipt.purpose,'RUY_TEMPORARY_SYNTHETIC_LAN');
assert.equal(path.dirname(receipt.profile).toLowerCase(),path.join(process.env.LOCALAPPDATA,'GestaoRuy').toLowerCase());
assert.match(path.basename(receipt.profile),/^central-lab-[a-f0-9]{16}$/);assert.match(receipt.database,/^ruy_d1_rc_[a-f0-9]{16}$/);
assert.equal(config.contract,'RUY_NGROK_SYNTHETIC/1');assert.equal(config.syntheticOnly,true);assert.equal(config.database,receipt.database);
assert.equal(config.expiresAt,receipt.expiresAt);assert.ok(Date.parse(receipt.expiresAt)>Date.now());
assert.equal(publicApiOrigin(config.tunnelOrigin),config.tunnelOrigin);
assert.match(new URL(config.tunnelOrigin).hostname,/^[a-z0-9-]+\.ngrok-free\.(?:app|dev)$/);
const shell=(code,input)=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input,windowsHide:true,timeout:30000,maxBuffer:65536});
const pkg=shell("Get-AppxPackage -Name ngrok.ngrok | Select-Object Name,SignatureKind,Status,InstallLocation | ConvertTo-Json -Compress");
if(pkg.status!==0)throw Error('STORE_PACKAGE_REQUIRED');
const installed=JSON.parse(pkg.stdout.toString());assert.equal(installed.Name,'ngrok.ngrok');assert.equal(installed.SignatureKind,3);assert.equal(installed.Status,0);
const executable=path.join(installed.InstallLocation,'ngrok.exe');
await fs.access(executable);
const ca=await fs.readFile(path.join(receipt.profile,'test-ca.pem'),'utf8');
// Local origin must validate its chain AND the exact IP SAN used by the agent.
const local=await sendUserTLS({url:'https://127.0.0.1:18716/api/local/d1/connection',ca});
assert.equal(local.status,403); // The public origin refuses missing sanitized proxy headers.
const cert=new X509Certificate(await fs.readFile(path.join(receipt.profile,'test-server.pem')));
assert.ok(cert.checkIP('127.0.0.1'));assert.ok(cert.checkHost('ADM-RUY'));assert.ok(Date.parse(cert.validTo)>Date.now());
const secretFile=path.join(process.env.LOCALAPPDATA,'GestaoRuy/ngrok-homologacao/ngrok-token.dpapi');
const stat=await fs.lstat(secretFile);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<65536);
const credential=shell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}',await fs.readFile(secretFile,'utf8'));
if(credential.status!==0)throw Error('CURRENT_USER_NGROK_CREDENTIAL_REQUIRED');
let token=credential.stdout.toString('utf8').trim();
if(!/^[A-Za-z0-9_-]{20,512}$/.test(token)||/YOUR_AUTHTOKEN|EXAMPLE_AUTHTOKEN/i.test(token)){
 credential.stdout.fill(0);token='';
 await fs.writeFile(path.join(path.dirname(secretFile),'invalid-token.json'),JSON.stringify({contract:'RUY_INVALID_NGROK_CREDENTIAL/1',ciphertextSha256:createHash('sha256').update(await fs.readFile(secretFile)).digest('hex'),reason:'VALUE_IS_NOT_A_REAL_AUTHTOKEN',at:new Date().toISOString()}));
 await fs.writeFile(path.join(output,'status.json'),JSON.stringify({at:new Date().toISOString(),running:false,publicEndpointStarted:false,credentialValid:false,code:'REAL_NGROK_AUTHTOKEN_REQUIRED',secretLogged:false}));
 throw Error('REAL_NGROK_AUTHTOKEN_REQUIRED');
}
const agentConfig=path.join(output,'agent.yml'),policy=path.join(output,'ngrok-policy.json');
const env={...process.env,NGROK_AUTHTOKEN:token};
const child=spawn(executable,['http','https://127.0.0.1:18716','--url',config.tunnelOrigin,'--upstream-tls-verify','--upstream-tls-verify-cas',path.join(receipt.profile,'test-ca.pem'),'--traffic-policy-file',policy,'--inspect=false','--config',agentConfig,'--log','stdout','--log-format','json'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
delete env.NGROK_AUTHTOKEN;token='';credential.stdout.fill(0);
let accepted=false,exited=false,stopping=false,lastError,stdout='',stderr='',timer;
const record=async extra=>{
 let authorizedIdentity=false;try{const a=await read(path.join(receipt.profile,'authorized-real-identity.json'));assert.equal(a.contract,'RUY_AUTHORIZED_IDENTITY_EXCEPTION/1');assert.equal(a.identityOnly,true);authorizedIdentity=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.writeFile(path.join(output,'status.json'),JSON.stringify({at:new Date().toISOString(),runnerPid:process.pid,agentPid:child.pid,temporary:true,syntheticOnly:true,businessDataSyntheticOnly:true,containsAuthorizedRealIdentity:authorizedIdentity,apiOrigin:config.tunnelOrigin,expiresAt:receipt.expiresAt,domainAuthorizedByAuthenticatedAgent:accepted,upstream:'https://127.0.0.1:18716',tlsVerification:true,originCertificateSansVerified:['ADM-RUY','127.0.0.1'],storeDistribution:true,serviceInstalled:false,postgresExposed:false,realBusinessDataPublished:false,realDataPublished:authorizedIdentity,...extra},null,2));
};
function parse(chunk,kind){
 let value=kind==='stdout'?stdout:stderr;value+=chunk.toString('utf8');
 const lines=value.split('\n');value=lines.pop();if(value.length>16384)value='';
 if(kind==='stdout')stdout=value;else stderr=value;
 for(const line of lines){
  const code=line.match(/ERR_NGROK_\d+/)?.[0];if(code)lastError=code;
  try{const row=JSON.parse(line);if(row.msg==='started tunnel'&&row.url===config.tunnelOrigin)accepted=true;}catch{/* Never print or persist raw provider output or credentials. */}
 }
}
child.stdout.on('data',b=>parse(b,'stdout'));child.stderr.on('data',b=>parse(b,'stderr'));
child.once('error',()=>{lastError='NGROK_AGENT_LAUNCH_FAILED';});child.once('exit',()=>{exited=true;});
async function stop(reason){if(stopping)return;stopping=true;clearInterval(timer);if(!exited)child.kill();await record({running:false,reason,...(lastError?{providerErrorCode:lastError}:{})});}
process.on('SIGINT',()=>void stop('USER_STOP'));process.on('SIGTERM',()=>void stop('USER_STOP'));
try{
 await record({running:false,starting:true});
 for(let n=0;n<120&&!accepted;n++){if(exited)throw Error(lastError||'NGROK_ACCOUNT_OR_POLICY_REFUSED');await new Promise(resolve=>setTimeout(resolve,500));}
 if(!accepted)throw Error(lastError||'NGROK_CONNECT_TIMEOUT');
 const connection=await sendUserTLS({url:config.tunnelOrigin+'/api/local/d1/connection'});
 assert.equal(connection.status,200);assert.equal(JSON.parse(connection.body).available,true);
 const denied=await sendUserTLS({url:config.tunnelOrigin+'/api/local/d1/state'});assert.equal(denied.status,401);
 const discovery=await sendUserTLS({url:config.tunnelOrigin+'/.well-known/sistema-ruy.json'});assert.equal(discovery.status,200);
 verifyDiscovery(JSON.parse(discovery.body),{publicKey:config.publicKey,deploymentId:config.deploymentId});
 await record({running:true,publicHttpsVerified:true,connectionStatus:200,anonymousStateStatus:401,signedDiscoveryVerified:true});
 console.log(JSON.stringify({connected:true,origin:config.tunnelOrigin,connection:200,anonymousState:401,domainAuthorizedByAuthenticatedAgent:true}));
 let checking=false;
 timer=setInterval(async()=>{if(checking||stopping)return;checking=true;try{
  if(exited)return await stop(lastError||'AGENT_EXITED');
  if(Date.now()>=Date.parse(receipt.expiresAt))return await stop('HOMOLOGATION_EXPIRED');
  const central=await centralState(path.join(path.dirname(receiptFile),'status.json'));
  if(central.temporary!==true||central.syntheticOnly!==true)return await stop('SYNTHETIC_CENTRAL_GUARD_FAILED');
  process.kill(central.controllerPid,0);
  if(!central.running&&!central.recovering)return await stop('SYNTHETIC_CENTRAL_STOPPED');
  try{await fs.access(path.join(receipt.profile,'STOP-NGROK'));return await stop('USER_STOP');}catch(e){if(e.code!=='ENOENT')throw e;}
 }catch{await stop('TEMPORARY_GUARD_FAILED');}finally{checking=false;}},2000);
}catch(error){await stop(lastError||'PUBLIC_CONNECTION_NOT_VALIDATED');console.error(JSON.stringify({connected:false,code:lastError||error.code||'PUBLIC_CONNECTION_NOT_VALIDATED'}));process.exitCode=2;}
