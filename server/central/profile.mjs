import fs from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {publicApiOrigin,discoveryKey} from './public-discovery.mjs';
import {dataRoot,openDpapi} from '../../scripts/homologacao/common.mjs';
export const sha=v=>createHash('sha256').update(v).digest('hex');
export function validateProfile(p){
 if(p?.contract!=='RUY-CENTRAL/1'||!['lab','controlled'].includes(p.mode)||p.enabled!==true)throw Error('CENTRAL_DISABLED');
 if(p.authentication!==undefined&&!['user-session','device-mtls'].includes(p.authentication))throw Error('AUTHENTICATION_MODE_REFUSED');
 if(p.exposure!==undefined&&!['cloudflare-tunnel','ngrok-tunnel'].includes(p.exposure))throw Error('EXPOSURE_MODE_REFUSED');
 const tunnel=['cloudflare-tunnel','ngrok-tunnel'].includes(p.exposure);
 if(tunnel&&(p.authentication!=='user-session'||p.tls.host!=='127.0.0.1'||!p.publicHostname||new URL(publicApiOrigin('https://'+p.publicHostname)).hostname!==p.publicHostname))throw Error('TUNNEL_LOOPBACK_SESSION_REQUIRED');
 if(p.discovery){discoveryKey(p.discovery.publicKey);publicApiOrigin(p.discovery.apiOrigin);if(!tunnel||!Number.isSafeInteger(p.discovery.generation)||p.discovery.generation<1||!/^[a-f0-9-]{36}$/.test(p.discovery.deploymentId||''))throw Error('SIGNED_DISCOVERY_CONFIGURATION_REQUIRED');}
 if(p.tls?.serverName&&!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(p.tls.serverName))throw Error('TLS_SERVER_NAME_REFUSED');
 if(p.api?.host!=='127.0.0.1'||p.database?.host!=='127.0.0.1'||!/^ruy_central_[a-f0-9]{16}$/.test(p.database.user))throw Error('CENTRAL_TARGET_REFUSED');
 const lab=p.mode==='lab';
 if(lab){if(p.syntheticOnly!==true||p.database.port!==55483||!/^ruy_d1_rc_[a-f0-9]{16}$/.test(p.database.database)||p.api.port!==0||p.tls.host!=='127.0.0.1'||p.tls.port!==0)throw Error('SYNTHETIC_TARGET_REQUIRED');}
 else{
  if(p.database.port!==55516||p.database.database!=='ruy_central_rc1_staging'||p.api.port!==18216||p.tls.port!==18716||p.activationApproved!==true)throw Error('CONTROLLED_ACTIVATION_REQUIRED');
  if(!tunnel&&(isIP(p.tls.host)!==4||!(/^(10\.|192\.168\.)/.test(p.tls.host)||/^172\.(1[6-9]|2\d|3[01])\./.test(p.tls.host))))throw Error('PRIVATE_TLS_ADDRESS_REQUIRED');
  if(!/^[a-f0-9]{64}$/.test(p.authorizationSha256||''))throw Error('SIGNED_OFF_AUTHORIZATION_REQUIRED');
 }
 if(!p.history||!Array.isArray(p.history.grants)||!/^[a-f0-9]{64}$/.test(p.history.datasetSha256)||!Number.isSafeInteger(p.history.records)||!Number.isSafeInteger(p.history.attachments))throw Error('RECONCILED_HISTORY_REQUIRED');
 const h=p.history.database;
 if(h?.host!=='127.0.0.1'||h.port!==p.database.port||!/^ruy_central_history_[a-f0-9]{16}$/.test(h.database)||!/^ruy_history_[a-f0-9]{16}_reader$/.test(h.user))throw Error('CENTRAL_HISTORY_TARGET_REFUSED');
 return Object.freeze(p);
}
export async function loadProfile(directory){
 const base=dataRoot,root=path.resolve(directory);
 if(path.dirname(root).toLowerCase()!==base.toLowerCase()||!/^central-(?:lab-[a-f0-9]{16}|pichau-rc1-staging)$/.test(path.basename(root)))throw Error('ISOLATED_CENTRAL_PROFILE_REQUIRED');
 if((await fs.realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('PROFILE_REDIRECTION_REFUSED');
 const raw=await fs.readFile(path.join(root,'central.json'));const p=validateProfile(JSON.parse(raw));
 if((p.mode==='lab')!==path.basename(root).startsWith('central-lab-'))throw Error('PROFILE_MODE_MISMATCH');
 if(p.mode!=='lab'){
  const authorization=await fs.readFile(path.join(root,'activation-authorization.json'));
  const a=JSON.parse(authorization);
  if(sha(authorization)!==p.authorizationSha256||a.productionActivationApproved!==true||a.server!=='PICHAU'||a.profile!=='central-pichau-rc1-staging'||!a.approvedBy||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now()||a.database!==p.database.database||a.historySha256!==p.history.datasetSha256||a.tlsAddress!==p.tls.host)throw Error('ACTIVATION_AUTHORIZATION_REQUIRED');
 }
 const stat=await fs.lstat(path.join(root,'secrets.dpapi'));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('PROTECTED_SECRETS_REQUIRED');
 const secrets=await openDpapi(path.join(root,'secrets.dpapi'));if(!secrets.databasePassword||!secrets.historyPassword||p.authentication!=='user-session'&&(!Array.isArray(secrets.devices)||!secrets.tlsCa)||!secrets.tlsKey||!secrets.tlsCert||! /^[a-f0-9]{64}$/.test(secrets.identityPepper))throw Error('CENTRAL_SECRETS_INCOMPLETE');
 return {profile:p,secrets,root,configSha256:sha(raw)};
}
