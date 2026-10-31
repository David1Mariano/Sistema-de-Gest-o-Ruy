import pg from 'pg';
import {X509Certificate,createPrivateKey,createPublicKey,createHash} from 'node:crypto';
import {loadProfile} from './profile.mjs';
import {schemaBundle} from './schema.mjs';
import {createCentralHistory} from './history.mjs';
import {createIdentity} from '../d1-lab/identity.mjs';
import {createSharedApi} from '../sync-lab/shared-server.mjs';
import {createLabTransport} from '../sync-lab/mtls-transport.mjs';
import {createUserTransport} from '../sync-lab/user-transport.mjs';
import {userSessions} from '../sync-lab/user-sessions.mjs';
import {backupCentral} from './backup.mjs';
import {signedDiscovery} from './public-discovery.mjs';
const listen=(s,port)=>new Promise((r,j)=>{s.once('error',j);s.listen(port,'127.0.0.1',r);});
const close=s=>new Promise(resolve=>{if(!s?.listening)return resolve();const t=setTimeout(()=>s.closeAllConnections(),10000);s.close(()=>{clearTimeout(t);resolve();});s.closeIdleConnections();});
export async function startCentral(directory){
 const loaded=await loadProfile(directory),{profile:p,secrets:s}=loaded;
 const options={max:8,connectionTimeoutMillis:3000,statement_timeout:10000,lock_timeout:3000,application_name:'ruy_controlled_central'};
 const pool=new pg.Pool({...p.database,...options,password:s.databasePassword});
 const historical=new pg.Pool({...p.history.database,...options,password:s.historyPassword,options:'-c default_transaction_read_only=on'});
 pool.on('error',()=>{});historical.on('error',()=>{});let api,transport,closing=false,backupTimer,backupFlight,lastBackup=0,backupOk=false;
 try{
  const target=(await pool.query("SELECT current_database() db,current_setting('port') port,current_user role")).rows[0];
  if(target.db!==p.database.database||target.port!==String(p.database.port)||target.role!==p.database.user)throw Error('DATABASE_IDENTITY_MISMATCH');
  const role=(await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(Object.values(role).some(Boolean)||(await pool.query("SELECT has_schema_privilege(current_user,'public','CREATE') bad")).rows[0].bad)throw Error('OWNER_PRIVILEGES_REFUSED');
  const expected=(await schemaBundle()).sha256;
  async function health(){
   if(closing)return false;
   const marker=(await pool.query('SELECT * FROM central_deployment WHERE singleton')).rows[0];
   return Boolean(marker&&marker.purpose===(p.mode==='lab'?'RUY_CENTRAL_LAB':'RUY_CENTRAL_CONTROLLED')&&marker.schema_sha256===expected&&marker.active&&!marker.maintenance);
  }
  if(!await health())throw Error('CENTRAL_NOT_ACTIVATED_OR_SCHEMA_MISMATCH');
  if(p.mode!=='lab'&&((await pool.query("SELECT 1 FROM central_reconciliation WHERE state<>'approved' OR approved_by IS NULL OR approved_at IS NULL LIMIT 1")).rowCount||(await pool.query('SELECT count(DISTINCT category)::int n FROM central_reconciliation')).rows[0].n!==4))throw Error('RECONCILIATION_SIGN_OFF_REQUIRED');
  const history=await createCentralHistory({pool:historical,central:pool,profile:p});
  const certificate=new X509Certificate(s.tlsCert),now=Date.now();
  if(!certificate.checkPrivateKey(createPrivateKey(s.tlsKey))||!(p.tls.serverName?certificate.checkHost(p.tls.serverName):certificate.checkIP(p.tls.host))||Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)throw Error('SERVER_CERTIFICATE_INVALID');
  const userMode=p.authentication==='user-session';
  const ca=p.mode==='lab'||userMode?null:new X509Certificate(s.tlsCa);
  if(ca&&(!ca.ca||certificate.ca||!certificate.checkIssued(ca)||!certificate.verify(ca.publicKey)||!certificate.keyUsage?.includes('1.3.6.1.5.5.7.3.1')||Date.parse(ca.validFrom)>now||Date.parse(ca.validTo)<=now))throw Error('PRODUCTION_CA_SERVER_EKU_REQUIRED');
  for(const d of userMode?[]:s.devices){
   if(!/^[a-f0-9]{64}$/.test(d.token))throw Error('DEVICE_CREDENTIAL_INVALID');
   const row=(await pool.query('SELECT device_id FROM shared_devices WHERE credential_hash=$1 AND active',[createHash('sha256').update(d.token).digest('hex')])).rows[0];if(!row)throw Error('DEVICE_NOT_ENROLLED');
   if(ca){const client=new X509Certificate(d.cert);if(d.deviceId!==row.device_id||client.ca||!client.subject.split('\n').includes('CN=Ruy-device-'+d.deviceId)||client.fingerprint256!==d.fingerprint||!client.checkIssued(ca)||!client.verify(ca.publicKey)||!client.keyUsage?.includes('1.3.6.1.5.5.7.3.2')||Date.parse(client.validFrom)>now||Date.parse(client.validTo)<=now)throw Error('PRODUCTION_DEVICE_CERTIFICATE_REQUIRED');}
  }
  // This bootstrap never auto-registers a user or sends mail. Existing approved
  // individual identities are required; email provisioning remains explicit.
  const identity=createIdentity({pool,pepper:Buffer.from(s.identityPepper,'hex'),sender:async()=>{throw Error('CENTRAL_MAIL_NOT_PROVISIONED');}});
  if(p.discovery&&(!s.discoveryPrivateKey||createPublicKey(s.discoveryPrivateKey).export({format:'der',type:'spki'}).toString('base64')!==p.discovery.publicKey))throw Error('DISCOVERY_SIGNING_KEY_REQUIRED');
  const serviceDiscovery=p.discovery?()=>signedDiscovery({...p.discovery,privateKey:s.discoveryPrivateKey}):undefined;
  const backup=()=>{if(backupFlight)return backupFlight;backupFlight=backupCentral(directory,{pool,historical,loaded}).then(r=>{backupOk=true;lastBackup=Date.now();return r;}).catch(e=>{backupOk=false;throw e;}).finally(()=>{backupFlight=null;});return backupFlight;};
  await backup();backupTimer=setInterval(()=>void backup().catch(()=>{}),15*60*1000);
  const writable=async()=>backupOk&&Date.now()-lastBackup<30*60*1000&&await health();
  api=createSharedApi({pool,identity,context:{operational:true,lab:p.mode==='lab',target:p.database},history,writable,authentication:userMode?userSessions(pool,identity):null});
  await listen(api,p.api.port);
  transport=userMode?createUserTransport({key:s.tlsKey,cert:s.tlsCert,host:p.tls.host,apiPort:api.address().port,allowPrivateNetwork:p.mode!=='lab',cloudflareTunnel:p.exposure==='cloudflare-tunnel',ngrokTunnel:p.exposure==='ngrok-tunnel',publicHostname:p.publicHostname,serviceDiscovery}):createLabTransport({key:s.tlsKey,cert:s.tlsCert,ca:s.tlsCa,devices:s.devices,upstream:'http://127.0.0.1:'+api.address().port,host:p.tls.host,allowPrivateNetwork:p.mode!=='lab',sharedSessionMode:true,centralProfile:{apiPort:api.address().port,host:p.tls.host}});
  await transport.listen(p.tls.port);
  return {apiPort:api.address().port,tlsPort:transport.server.address().port,configSha256:loaded.configSha256,health:writable,backup,
   async stop(){if(closing)return;closing=true;clearInterval(backupTimer);await close(transport.server);await close(api);await backupFlight?.catch(()=>{});await Promise.all([pool.end(),historical.end()]);}};
 }catch(error){closing=true;clearInterval(backupTimer);await close(transport?.server);await close(api);await Promise.all([pool.end(),historical.end()]);throw error;}
}
