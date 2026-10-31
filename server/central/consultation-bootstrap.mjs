import fs from 'node:fs/promises';
import path from 'node:path';
import {X509Certificate,createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {createReadStream} from 'node:fs';
import pg from 'pg';
import {loadProfile} from './profile.mjs';
import {createIdentity} from '../d1-lab/identity.mjs';
import {userSessions} from '../sync-lab/user-sessions.mjs';
import {createUserTransport} from '../sync-lab/user-transport.mjs';
import {createConsultationSource,createConsultationApi} from './consultation.mjs';
import {signedDiscovery,publicApiOrigin,discoveryKey} from './public-discovery.mjs';
import {openDpapi,json,regularDirectory,dataRoot} from '../../scripts/homologacao/common.mjs';
import {createDiscoveryOnlyTransport} from './discovery-only-transport.mjs';
import {startConsultationConnector} from './consultation-connector.mjs';
import {startDiscoveryOnlyConnector} from './discovery-only-connector.mjs';
import {startOperationalExtension} from './operational-extension.mjs';

// Prepared activation entry. Profiles are created disabled. No provisioning,
// migration, discovery update or certificate generation takes place at startup.
export async function startConsultation(directory){
 const root=path.resolve(directory);if(path.dirname(root).toLowerCase()!==path.join(dataRoot,'audits').toLowerCase()||!/^api-consulta-[a-f0-9]{16}$/.test(path.basename(root)))throw Error('PRIVATE_CONSULTATION_PROFILE_REQUIRED');await regularDirectory(root);
 const p=await json(path.join(root,'consultation.json'));
 if(p.contract!=='RUY-CONSULTATION/1'||p.enabled!==true||p.httpsActivationApproved!==true||!p.activationAuthorizationReference)throw Error('CONSULTATION_NOT_AUTHORIZED_OR_DISABLED');
 if(p.exposure==='cloudflare-tunnel'&&p.realDataReadOnlyPublicationApproved!==true)throw Error('REAL_DATA_READ_ONLY_PUBLICATION_AUTHORIZATION_REQUIRED');
 if(p.exposure==='cloudflare-tunnel'&&!p.operationalReleaseApproved){
  const file=path.resolve(p.activationAuthorizationReference);if(path.dirname(file).toLowerCase()!==root.toLowerCase()||(await fs.lstat(file)).isSymbolicLink())throw Error('LOCAL_READ_ONLY_AUTHORIZATION_REQUIRED');const a=await json(file);
  if(a.contract!=='RUY_READ_ONLY_RELEASE_AUTHORIZATION/1'||a.profile!==root||a.publicOrigin!=='https://api.ruycaldodecana.com.br'||a.readOnlyPublicationApproved!==true||a.operationalWritesAllowed!==false||a.originalDatabasesMayBeModified!==false||a.allowedRecords!==1186||a.allowedLinkedAttachments!==54||a.quarantineMustRemainBlocked!==5||a.accountMigrationAllowed!==false)throw Error('EXACT_READ_ONLY_RELEASE_AUTHORIZATION_REQUIRED');
 }
 if(!Number.isInteger(p.tlsPort)||p.tlsPort<1024||p.tlsPort>65535||!p.serverName)throw Error('APPROVED_HTTPS_TARGET_REQUIRED');
 const secrets=await openDpapi(path.join(root,'reader.dpapi')),tls=await openDpapi(path.join(root,'tls.dpapi'));
 if(secrets.host!=='127.0.0.1'||secrets.port!==55483||!/^ruy_consult_[a-f0-9]{16}_reader$/.test(secrets.user)||p.databases.some(n=>!/^ruy_private_import_(work|history)_[a-f0-9]{16}$/.test(n)))throw Error('PRIVATE_READERS_REQUIRED');
 const certificate=new X509Certificate(tls.cert);if(!certificate.checkPrivateKey(createPrivateKey(tls.key))||!certificate.checkHost(p.serverName)&&!certificate.checkIP(p.serverName)||Date.parse(certificate.validFrom)>Date.now()||Date.parse(certificate.validTo)<=Date.now())throw Error('VALID_TRUSTED_HTTPS_CERTIFICATE_REQUIRED');
 const pools=p.databases.map(database=>new pg.Pool({...secrets,database,options:'-c default_transaction_read_only=on -c statement_timeout=10000',max:4,connectionTimeoutMillis:3000}));
 let security,api,transport,legacyDiscovery,connector,legacyConnector,operational;
 try{
  // The existing identity store remains the single authority. Session expiry,
  // revocation, throttling and authentication audit use its existing tables.
  // No account, password, membership or permission is copied to the data stores.
  const existing=await loadProfile(p.authenticationProfile);if(existing.profile.authentication!=='user-session')throw Error('EXISTING_USER_SESSION_AUTHORITY_REQUIRED');
  if(p.operationalReleaseApproved){const authorization=await json(path.join(root,'production-authorization.json'));if(authorization.contract!=='RUY-PRODUCTION-AUTHORIZATION/1'||authorization.originalDatabaseWritesAllowed!==false||authorization.operationalCommandsApproved!==true||authorization.profile!==root)throw Error('EXPLICIT_OPERATIONAL_AUTHORIZATION_REQUIRED');operational=await startOperationalExtension({root,p,historyPool:pools[1],identityPepper:existing.secrets.identityPepper});api=operational.api;}
  else {
  security=new pg.Pool({...existing.profile.database,password:existing.secrets.databasePassword,max:4,connectionTimeoutMillis:3000});
  const identity=createIdentity({pool:security,pepper:Buffer.from(existing.secrets.identityPepper,'hex'),sender:async()=>{throw Error('CONSULTATION_ACCOUNT_CREATION_DISABLED');}});
  const authentication=userSessions(security,identity);
  const source=await createConsultationSource({workingPool:pools[0],historyPool:pools[1],workspaceId:p.workspaceId,grants:p.grants});
  api=createConsultationApi({source,authentication,audit:event=>void fs.appendFile(path.join(root,'consultation-audit.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n').catch(()=>{})});
  }
  await new Promise((resolve,reject)=>{api.once('error',reject);api.listen(0,'127.0.0.1',resolve);});
  let serviceDiscovery,distribution;
  if(p.exposure==='cloudflare-tunnel'){
   const origin=publicApiOrigin('https://'+p.publicHostname);discoveryKey(p.discovery?.publicKey);
   let signer=existing.secrets.discoveryPrivateKey,metadata=existing.profile.discovery;
   if(!signer){metadata=await json(path.join(p.authenticationProfile,'ngrok-public.json'));signer=(await openDpapi(path.join(p.authenticationProfile,'ngrok-signing.dpapi'))).key;}
   if(p.discovery.apiOrigin!==origin||p.discovery.deploymentId!==metadata?.deploymentId||!signer||createPublicKey(signer).export({format:'der',type:'spki'}).toString('base64')!==p.discovery.publicKey)throw Error('EXISTING_PINNED_DISCOVERY_IDENTITY_REQUIRED');
   serviceDiscovery=()=>signedDiscovery({...p.discovery,privateKey:signer});
   if(p.distribution?.enabled){const directory=path.join(root,'distribution');await regularDirectory(directory);
    const verified=async entry=>{const version=entry.version||'0.10.0-rc.5';if(!['0.10.0-rc.5','0.10.0-rc.6','0.10.0-rc.7','0.10.0-rc.8','0.10.0-rc.9','0.10.0-rc.10','0.10.0-rc.11'].includes(version))throw Error('REVIEWED_INSTALLER_VERSION_REQUIRED');const file=path.join(directory,'Sistema-Ruy-'+version+'-Setup.exe'),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('REVIEWED_INSTALLER_REQUIRED');const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);if(hash.digest('hex')!==entry.sha256||stat.size!==entry.bytes)throw Error('INSTALLER_INTEGRITY_FAILED');const metadata={contract:'RUY-WINDOWS-RELEASE/1',version,name:path.basename(file),bytes:stat.size,sha256:entry.sha256,url:origin+'/downloads/'+path.basename(file)};return {file,manifest:{...metadata,signature:sign(null,Buffer.from(JSON.stringify(metadata)),signer).toString('base64')}};};
    distribution={...await verified(p.distribution),archives:await Promise.all((p.distribution.previous||[]).map(verified))};
   }
  }else if(p.exposure!==undefined&&p.exposure!=='private-direct')throw Error('CONSULTATION_EXPOSURE_REFUSED');
  transport=createUserTransport({key:tls.key,cert:tls.cert,host:'127.0.0.1',apiPort:api.address().port,cloudflareTunnel:p.exposure==='cloudflare-tunnel',publicHostname:p.publicHostname,serviceDiscovery,queryOnly:!operational,distribution});await transport.listen(p.tlsPort);
  if(p.legacyDiscovery?.enabled===true){
   if(p.exposure!=='cloudflare-tunnel'||!serviceDiscovery||p.legacyDiscovery.publicationApproved!==true||p.legacyDiscovery.tlsPort!==18716||p.tlsPort!==18726||!certificate.checkIP('127.0.0.1'))throw Error('APPROVED_METADATA_ONLY_TRANSITION_AND_LOOPBACK_SAN_REQUIRED');
   legacyDiscovery=createDiscoveryOnlyTransport({key:tls.key,cert:tls.cert,document:serviceDiscovery,publicKey:p.discovery.publicKey,deploymentId:p.discovery.deploymentId,minimumGeneration:p.discovery.generation});await legacyDiscovery.listen(p.legacyDiscovery.tlsPort);
  }
  if(p.tunnel?.enabled===true)connector=await startConsultationConnector({profile:p,root});
  if(p.legacyDiscovery?.ngrokEnabled===true)legacyConnector=await startDiscoveryOnlyConnector({profile:p,root});
  const close=server=>new Promise(resolve=>{if(!server?.listening)return resolve();const timer=setTimeout(()=>server.closeAllConnections(),10000);server.close(()=>{clearTimeout(timer);resolve();});server.closeIdleConnections();});
  return {apiPort:api.address().port,tlsPort:p.tlsPort,consultationOnly:!operational,health:async()=>{await Promise.all(pools.map(pool=>pool.query('SELECT 1')));return (!operational||await operational.health())&&transport.server.listening&&(!legacyDiscovery||legacyDiscovery.server.listening)&&(!connector||await connector.health())&&(!legacyConnector||await legacyConnector.health());},async stop(){await legacyConnector?.stop();await connector?.stop();await close(legacyDiscovery?.server);await close(transport.server);await close(api);await operational?.stop();await Promise.all([...pools.map(pool=>pool.end()),security?.end()]);}};
 }catch(e){await legacyConnector?.stop();await connector?.stop();legacyDiscovery?.server.close();transport?.server.close();api?.close();await operational?.stop();await Promise.all([...pools.map(pool=>pool.end()),security?.end()]);throw e;}
}
