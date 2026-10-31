import path from 'node:path';

// Applies only to this approved synthetic origin. Never accepts another service,
// private-network routing, an unverified CA, or disabled certificate validation.
export function verifyHomologationTunnelConfig(config, caFile) {
 return verify(config,caFile,'https://127.0.0.1:18716','ADM-RUY');
}
export function verifyConsultationTunnelConfig(config, caFile) {
 return verify(config,caFile,'https://127.0.0.1:18726','api.ruycaldodecana.com.br');
}
function verify(config,caFile,origin,serverName){
 if(!config||typeof config!=='object'||config['warp-routing']?.enabled===true)throw Error('PRIVATE_NETWORK_ROUTING_REFUSED');
 if(!Array.isArray(config.ingress)||config.ingress.length<2)throw Error('EXPLICIT_DENY_FALLBACK_REQUIRED');
 let origins=0;
 for(let i=0;i<config.ingress.length;i++){
  const rule=config.ingress[i];
  if(rule.service==='http_status:404'){
   if(i===config.ingress.length-1&&!rule.hostname&&!rule.path)continue;
   throw Error('UNEXPECTED_DENY_RULE');
  }
  if(i===config.ingress.length-1||rule.hostname!=='api.ruycaldodecana.com.br'||rule.service!==origin)throw Error('ONLY_APPROVED_ORIGIN_ALLOWED');
  const tls={...config.originRequest,...rule.originRequest};
  if(tls.noTLSVerify===true||tls.originServerName!==serverName||!tls.caPool||path.resolve(tls.caPool).toLowerCase()!==path.resolve(caFile).toLowerCase()||tls.matchSNItoHost===true)throw Error('VERIFIED_ORIGIN_TLS_REQUIRED');
  // With no path filter, the synthetic gateway still enforces queryOnly and
  // rejects every administrative/mutation route before reaching the backend.
  origins++;
 }
 if(!origins)throw Error('HOMOLOGATION_ROUTE_MISSING');
 return {origins,origin,originServerName:serverName,originTlsVerified:true,privateNetworkRouting:false};
}
