// Default: read-only diagnosis and an unapproved, private account-only request.
// --apply=<private approval file> is for a later explicitly authorized action.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {json,openDpapi,sha} from '../homologacao/common.mjs';
import {identitySnapshot,identityFingerprint,transferIdentity} from '../../server/central/identity-transfer.mjs';
process.env.RUY_D1_INSTALLATION='final-dev-20261021';process.env.RUY_D1_ALLOW_TESTS='1';process.env.RUY_D1_TEST_API_PORT='18133';process.env.RUY_SHARED_LAB='1';
const {config}=await import('../../server/d1-lab/environment.mjs'),{pg}=await import('../../server/d1-lab/core.mjs');
const {decryptArchive}=await import('../../server/d1-lab/backup.mjs');
const fail=code=>{throw Object.assign(Error(code),{code});};
async function main(){
 const base=path.join(process.env.LOCALAPPDATA,'GestaoRuy'),sourceRoot=path.join(base,'installation-windows-operational');
 const audit=await json('artifacts/central-preparacao-20261027/final-source-location.json');
 const backup=(await json(path.join(audit.auditRoot,'backups.json'))).summary.operationalLatest;
 if(backup.profile.toLowerCase()!==sourceRoot.toLowerCase()||backup.verified!==true)fail('AUTHENTICATED_WINDOWS_SOURCE_REQUIRED');
 const bytes=await fs.readFile(backup.file);if(sha(bytes)!==backup.sha256)fail('SOURCE_BACKUP_CHANGED');
 const key=Buffer.from((await openDpapi(path.join(sourceRoot,'backup-key.dpapi'))).key,'hex');let snapshot,backupAt;
 try{
  const archive=decryptArchive(bytes,key);backupAt=archive.createdAt;
  const users=archive.recoveryState.lab_users.filter(u=>u.active);if(users.length!==1)fail('EXPLICIT_SINGLE_ACCOUNT_SELECTION_REQUIRED');
  snapshot=identitySnapshot({user:users[0],identity:archive.recoveryState.identity_accounts.find(a=>a.user_id===users[0].id)});
 }finally{key.fill(0);bytes.fill(0);}
 // Never start the source cluster. Recheck through its existing restricted login.
 let sourceCurrentVerified=false;
 const c=await openDpapi(path.join(sourceRoot,'app.dpapi'));
 if(c.host!=='127.0.0.1'||c.port!==55496||c.database!=='ruy_d1_disposable'||c.user!=='ruy_d1_app')fail('WINDOWS_SOURCE_CONNECTION_REFUSED');
 const source=new pg.Client({...c,connectionTimeoutMillis:2000,statement_timeout:3000,application_name:'ruy_account_transfer_readonly'});
 try{
  await source.connect();await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await source.query("SET LOCAL TIME ZONE 'UTC'");
  const actual=(await source.query("SELECT current_database() db,current_setting('port') port,current_setting('transaction_read_only') ro")).rows[0];
  if(actual.db!==c.database||actual.port!=='55496'||actual.ro!=='on')fail('READ_ONLY_SOURCE_IDENTITY_MISMATCH');
  const row=(await source.query('SELECT to_jsonb(u) "user",to_jsonb(a) identity FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=$1',[snapshot.user.id])).rows;
  if(row.length!==1)fail('CURRENT_ORIGINAL_ACCOUNT_NOT_FOUND');snapshot=identitySnapshot(row[0]);sourceCurrentVerified=true;
  await source.query('COMMIT');
 }catch(error){if(!['ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH'].includes(error.code)&&!/timeout/i.test(error.message))throw error;}finally{await source.end();}
 const receipt=await json('artifacts/homologacao-lan-ativa-79402bbf27e83425/server.json'),publicConfig=await json(path.join(receipt.profile,'ngrok-public.json'));
 if(receipt.purpose!=='RUY_TEMPORARY_SYNTHETIC_LAN'||!/^ruy_d1_rc_[a-f0-9]{16}$/.test(receipt.database)||Date.parse(receipt.expiresAt)<=Date.now())fail('EXISTING_TEMPORARY_TARGET_REQUIRED');
 const owner=await config(true);if(owner.host!=='127.0.0.1'||owner.port!==55483)fail('EXISTING_SYNTHETIC_CLUSTER_REQUIRED');
 const target=new pg.Pool({...owner,database:receipt.database});
 try{
  const applyFile=process.argv.find(v=>v.startsWith('--apply='))?.slice(8);
  if(applyFile){
   const file=path.resolve(applyFile),root=path.dirname(file);
   if(path.dirname(root).toLowerCase()!==base.toLowerCase()||!/^account-transfer-[a-f0-9]{16}$/.test(path.basename(root))||(await fs.realpath(root)).toLowerCase()!==root.toLowerCase())fail('PRIVATE_OWNER_APPROVAL_REQUIRED');
   const a=await json(file);if(a.sourceBackupSha256!==backup.sha256||Date.parse(a.expiresAt)>Date.parse(receipt.expiresAt))fail('APPROVAL_SOURCE_OR_LIFETIME_MISMATCH');
   const result=await transferIdentity(target,snapshot,{authorization:a,sourceCurrentVerified,workspaceId:receipt.workspace,publicOrigin:publicConfig.apiOrigin});
   await fs.writeFile(path.join(root,'applied.json'),JSON.stringify({at:new Date().toISOString(),...result,sourceModified:false,passwordReset:false,publicOrigin:publicConfig.apiOrigin},null,2),{flag:'wx'});return result;
  }
  const matches=(await target.query('SELECT count(*)::int n FROM lab_users WHERE id=$1 OR lower(login)=$2',[snapshot.user.id,snapshot.user.login])).rows[0].n;
  const root=path.join(base,'account-transfer-'+randomBytes(8).toString('hex'));await fs.mkdir(root);
  const sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{windowsHide:true,encoding:'utf8'}).trim();
  const acl=spawnSync('icacls.exe',[root,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F'],{windowsHide:true});if(acl.status!==0)fail('PRIVATE_PREPARATION_PERMISSIONS_FAILED');
  const request={contract:'RUY_ACCOUNT_ONLY_AUTHORIZATION/1',accountTransferApproved:false,allowRealIdentityInPublicHomologation:false,businessDataMigrationApproved:false,passwordResetApproved:false,accountId:snapshot.user.id,identityFingerprint:identityFingerprint(snapshot),workspaceId:receipt.workspace,targetDatabase:receipt.database,targetPort:55483,publicOrigin:publicConfig.apiOrigin,sourceBackupSha256:backup.sha256,approvedBy:null,expiresAt:new Date(Math.min(Date.now()+2*3600000,Date.parse(receipt.expiresAt))).toISOString()};
  await fs.writeFile(path.join(root,'authorization.pending.json'),JSON.stringify(request,null,2),{flag:'wx'});
  const summary={at:new Date().toISOString(),dryRun:true,source:'Original Windows installation-windows-operational',sourceActive:snapshot.user.active,sourceRole:snapshot.user.role,sourceApproved:!!snapshot.identity.approved_at,sourceVerified:!!snapshot.identity.verified_at,sourceRevoked:!!snapshot.identity.revoked_at,sourceEvidence:sourceCurrentVerified?'Current PostgreSQL read-only transaction':'Authenticated backup '+backupAt,sourceCurrentVerified,passwordHashFormat:snapshot.user.password_hash.split(':')[0],sameHashCanBePreserved:true,targetMatchingAccounts:matches,publicOrigin:publicConfig.apiOrigin,preparedPrivateDirectory:root,realAccountTransferred:false,businessDataMigrated:false,passwordChanged:false,sourceClusterStarted:false,requiresExplicitPublicHomologationIdentityApproval:true,applyBlockedBy:sourceCurrentVerified?'OWNER_AUTHORIZATION_REQUIRED':'OWNER_AUTHORIZATION_AND_CURRENT_SOURCE_READ_ONLY_RECHECK_REQUIRED',rollback:'Disable only the imported destination membership and revoke its sessions; preserve the original Windows account and all audit records.'};
  await fs.writeFile('artifacts/login-original-20261028/preparacao.json',JSON.stringify(summary,null,2));return summary;
 }finally{await target.end();}
}
try{console.log(JSON.stringify(await main()));}catch(error){console.error(JSON.stringify({passed:false,code:/^[A-Z_]+$/.test(error.code||'')?error.code:'ACCOUNT_TRANSFER_PREPARATION_FAILED',secretValuesLogged:false}));process.exitCode=2;}
