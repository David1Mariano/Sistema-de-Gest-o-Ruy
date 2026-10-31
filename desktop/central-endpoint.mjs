import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
// Builder places desktop entries at the archive root; source files live one
// directory below the project root. Resolve the same verifier in both layouts.
const discoveryModule=await fs.access(new URL('./server/central/public-discovery.mjs',import.meta.url)).then(()=> './server/central/public-discovery.mjs',error=>{if(error.code==='ENOENT')return '../server/central/public-discovery.mjs';throw error;});
const {verifyDiscovery,discoveryKey}=await import(discoveryModule);
const exec=promisify(execFile);
let cachedPolicy,policyUntil=0;
let cachedDiscovery,discoveryUntil=0;
const discoveryFloors=new Map();
const discoveryFlights=new Map();
export async function clientCorrelation(root){
 await fs.mkdir(root,{recursive:true});const file=path.join(root,'client-correlation.json');
 try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(Object.keys(value).length!==1||!/^[a-f0-9-]{36}$/.test(value.id))throw Error('CLIENT_CORRELATION_INVALID');return value.id;}
 catch(error){if(error.code!=='ENOENT')throw error;const id=randomUUID();await fs.writeFile(file,JSON.stringify({id}),{flag:'wx'});return id;}
}
export async function readMachinePolicy(){
 if(Date.now()<policyUntil)return cachedPolicy;
 try{
  const {stdout}=await exec('reg.exe',['query','HKLM\\SOFTWARE\\Policies\\SistemaRuy','/v','ApiEndpoint','/reg:64'],{windowsHide:true,timeout:5000,encoding:'utf8'});
  const value=stdout.match(/^\s*ApiEndpoint\s+REG_SZ\s+(\S+)\s*$/m)?.[1];
  if(!value)throw Error('MACHINE_POLICY_FORMAT_REFUSED');
  cachedPolicy=validateEndpoint(value);
 }catch(error){if(error.code!==1)throw error;cachedPolicy=null;}
 policyUntil=Date.now()+30000;return cachedPolicy;
}
// Only public deployment metadata is shipped. DNS resolves this fixed HTTPS
// origin; no LAN scans, untrusted discovery responses or TLS bypasses.
export function validateEndpoint(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!u.hostname)throw Error('CENTRAL_HTTPS_ORIGIN_REQUIRED');
 return u.origin;
}
export async function centralEndpoint({testRoot,publicConfig=new URL('./central-endpoint.json',import.meta.url),policyReader=readMachinePolicy,discoveryRequest,discoveryStateFile,now=Date.now()}={}){
 if(testRoot){
  if(process.env.RUY_SHARED_LAB!=='1')throw Error('SYNTHETIC_ENDPOINT_REQUIRED');
  const config=JSON.parse(await fs.readFile(path.join(testRoot,'synthetic-endpoint.json'),'utf8'));
  if(config.purpose==='RUY_SYNTHETIC_PUBLIC_DISCOVERY/1'){
   if(Object.keys(config).length!==1)throw Error('PUBLIC_FIXTURE_METADATA_REFUSED');
   const publicConfig=path.join(testRoot,'public-endpoint.json');
   const metadata=JSON.parse(await fs.readFile(publicConfig,'utf8'));
   if(!metadata.discoveryPublicKey||!metadata.deploymentId)throw Error('SIGNED_PUBLIC_FIXTURE_REQUIRED');
   return centralEndpoint({publicConfig,policyReader:async()=>null,discoveryStateFile,discoveryRequest,now});
  }
  if(new URL(config.endpoint).hostname!=='127.0.0.1')throw Error('LOOPBACK_FIXTURE_REQUIRED');
  return {endpoint:validateEndpoint(config.endpoint),ca:config.ca};
 }
 let config;
 try{config=JSON.parse(await fs.readFile(publicConfig,'utf8'));}catch(error){if(error.code==='ENOENT'){const policy=await policyReader();if(policy)return {endpoint:validateEndpoint(policy)};}throw error;}
 if(Object.keys(config).some(k=>!['endpoint','discoveryUrl','purpose','discoveryPublicKey','deploymentId'].includes(k)))throw Error('PUBLIC_ENDPOINT_METADATA_REQUIRED');
 const signed=config.discoveryPublicKey!==undefined||config.deploymentId!==undefined;
 if(signed){discoveryKey(config.discoveryPublicKey);if(!/^[a-f0-9-]{36}$/.test(config.deploymentId||'')||!config.discoveryUrl||config.endpoint)throw Error('SIGNED_DISCOVERY_CONFIGURATION_REQUIRED');}
 // A definitive signed deployment is centrally managed by its pinned issuer.
 // Stale per-machine LAN policy must not require employee intervention or
 // redirect credentials away from that deployment. Preserve legacy precedence.
 if(!signed){const policy=await policyReader();if(policy)return {endpoint:validateEndpoint(policy)};}
 if(config.discoveryUrl){
  const discovery=new URL(config.discoveryUrl);
  if(discovery.protocol!=='https:'||discovery.username||discovery.password||discovery.hash||discovery.search||discovery.pathname!=='/.well-known/sistema-ruy.json')throw Error('TRUSTED_DISCOVERY_REQUIRED');
  const identity=discovery.href+'|'+(config.discoveryPublicKey||'same-origin')+'|'+(config.deploymentId||'')+'|'+(discoveryStateFile||'');
  if(cachedDiscovery?.source===identity&&now<discoveryUntil)return {endpoint:cachedDiscovery.endpoint};
  if(typeof discoveryRequest!=='function')throw Error('HTTPS_DISCOVERY_REQUIRED');
  if(discoveryFlights.has(identity))return discoveryFlights.get(identity);
  const resolve=async()=>{
  const response=await discoveryRequest(discovery.href);
  if(response.status!==200||Buffer.byteLength(response.body)>16384)throw Error('DISCOVERY_REFUSED');
  const document=JSON.parse(response.body);let endpoint,expires=now+60000;
  if(signed){
   let floor=discoveryFloors.get(identity)||{generation:0};
   if(discoveryStateFile)try{const state=JSON.parse(await fs.readFile(discoveryStateFile,'utf8'));if(state.contract!=='RUY-DISCOVERY-STATE/1'||state.deploymentId!==config.deploymentId||!Number.isSafeInteger(state.generation)||state.generation<1||typeof state.endpoint!=='string')throw Error('DISCOVERY_STATE_REFUSED');if(state.generation>=floor.generation)floor=state;}catch(error){if(error.code!=='ENOENT')throw error;}
   const verified=verifyDiscovery(document,{publicKey:config.discoveryPublicKey,deploymentId:config.deploymentId,minimumGeneration:floor.generation,now});endpoint=verified.endpoint;expires=Math.min(expires,verified.expiresAt);
   if(verified.generation===floor.generation&&endpoint!==floor.endpoint)throw Error('DISCOVERY_GENERATION_CONFLICT');
   const state={contract:'RUY-DISCOVERY-STATE/1',deploymentId:config.deploymentId,generation:verified.generation,endpoint};
   if(discoveryStateFile){await fs.mkdir(path.dirname(discoveryStateFile),{recursive:true});const temporary=discoveryStateFile+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,JSON.stringify(state),{flag:'wx'});await fs.rename(temporary,discoveryStateFile);}
   discoveryFloors.set(identity,state);
  }else{
   endpoint=validateEndpoint(document.apiOrigin);if(document.contract!=='RUY-PUBLIC-API/1'||new URL(endpoint).host!==discovery.host)throw Error('DISCOVERY_ORIGIN_REFUSED');
  }
  cachedDiscovery={source:identity,endpoint};discoveryUntil=expires;return {endpoint};
  };
  const flight=resolve();discoveryFlights.set(identity,flight);
  try{return await flight;}finally{if(discoveryFlights.get(identity)===flight)discoveryFlights.delete(identity);}
 }
 if(!config.endpoint)throw Object.assign(Error('O endereço HTTPS da central ainda precisa ser definido na distribuição. Contate o responsável pelo servidor.'),{code:'CENTRAL_ADDRESS_PENDING'});
 return {endpoint:validateEndpoint(config.endpoint)};
}
