import fs from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {publicApiOrigin,discoveryKey} from '../../server/central/public-discovery.mjs';
// Offline preparation only. No Cloudflare writes, service registration, secrets
// generation, DNS updates, or changes to installed applications.
export async function prepareInternet({hostname,directory,provider='cloudflare',publicKey,deploymentId}){
 if(!hostname||!hostname.includes('.')||isIP(hostname)||!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/i.test(hostname))throw Error('APPROVED_REAL_DOMAIN_REQUIRED');
 if(!directory)throw Error('NEW_OUTPUT_DIRECTORY_REQUIRED');
 if(!['cloudflare','ngrok'].includes(provider))throw Error('APPROVED_PROVIDER_REQUIRED');
 publicApiOrigin('https://'+hostname);
 if(publicKey||deploymentId){discoveryKey(publicKey);if(!/^[a-f0-9-]{36}$/.test(deploymentId||''))throw Error('DEPLOYMENT_ID_REQUIRED');}
 await fs.mkdir(directory);
 const metadata={purpose:'PUBLIC_HTTPS_SERVICE_ORIGIN_ONLY',endpoint:null,discoveryUrl:'https://'+hostname+'/.well-known/sistema-ruy.json',...(publicKey?{discoveryPublicKey:publicKey,deploymentId}:{})};
 await fs.writeFile(path.join(directory,'central-endpoint.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
 if(provider==='cloudflare'){
  const tunnel=(await fs.readFile(new URL('./cloudflare-tunnel.template.yml',import.meta.url),'utf8')).replaceAll('<APPROVED_API_FQDN>',hostname);
  await fs.writeFile(path.join(directory,'cloudflare-tunnel.yml'),tunnel,{flag:'wx'});
 }else{
  const policy={on_http_request:[{expressions:["req.url.scheme != 'https' || !(req.url.path == '/.well-known/sistema-ruy.json' || req.url.path.startsWith('/api/local/d1/'))"],actions:[{type:'custom-response',config:{status_code:404,content:'{"error":"Not found"}',headers:{'content-type':'application/json'}}}]},{actions:[{type:'remove-headers',config:{headers:['x-ruy-proxy-client-ip','x-ruy-proxy-proto','cf-connecting-ip','x-forwarded-for','x-forwarded-proto']}},{type:'add-headers',config:{headers:{'x-ruy-proxy-client-ip':'${conn.client_ip}','x-ruy-proxy-proto':'https'}}}]}]};
  await fs.writeFile(path.join(directory,'ngrok-policy.json'),JSON.stringify(policy,null,2),{flag:'wx'});
  await fs.writeFile(path.join(directory,'ngrok-launch.disabled.json'),JSON.stringify({enabled:false,serverOnly:true,executable:'<SERVER_ONLY_SIGNED_NGROK_EXE>',arguments:['http','https://127.0.0.1:18716','--url','https://'+hostname,'--upstream-tls-verify','--upstream-tls-verify-cas','<SERVER_PUBLIC_CA_PEM>','--traffic-policy-file',path.join(directory,'ngrok-policy.json'),'--inspect=false'],secretEnvironmentVariable:'NGROK_AUTHTOKEN',originCertificateMustInclude:'IP:127.0.0.1',clientCertificateRequired:false,windowsTrustChanges:false,postgresForwarded:false,providerActivationAuthorized:false,keepBootstrapOnlineAfterDomainMigration:true},null,2),{flag:'wx'});
 }
 if(publicKey)await fs.writeFile(path.join(directory,'discovery-plan.unsigned.json'),JSON.stringify({purpose:'PREPARATION_ONLY_DO_NOT_SERVE',contract:'RUY-PUBLIC-API/2',deploymentId,apiOrigin:'https://'+hostname,generation:null,signature:null,requiresExistingServerSigningKey:true},null,2),{flag:'wx'});
 else await fs.writeFile(path.join(directory,'public-discovery.json'),JSON.stringify({contract:'RUY-PUBLIC-API/1',apiOrigin:'https://'+hostname},null,2),{flag:'wx'});
 return {prepared:true,hostname,provider,signedDiscovery:!!publicKey,credentialsIncluded:false,activated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareInternet({hostname:process.argv[2],directory:process.argv[3]})));
