import {verifyConsultationTunnelConfig} from './cloudflare-origin-policy.mjs';
// WAN readiness is independent of process/configuration liveness. cloudflared
// reconnects itself; an Internet outage must not restart PostgreSQL/API sessions.
export async function consultationConnectorAlive({alive,caFile,fetchImpl=fetch}){
 if(!alive)return false;
 const response=await fetchImpl('http://127.0.0.1:20241/config',{signal:AbortSignal.timeout(2000)});
 if(!response.ok)return false;
 try{verifyConsultationTunnelConfig((await response.json()).config,caFile);}catch{throw Object.assign(Error('TUNNEL_SECURITY_CONFIGURATION_REFUSED'),{securityFailure:true});}
 return true;
}
