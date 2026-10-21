// Authorized isolated Pichau candidate. No secrets or business payloads in output.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';import pg from 'pg';
import {installation,home,unseal,seal,config,powershell,cluster,pgCommand,validateHome} from '../../server/d1-lab/environment.mjs';
import {initializeLab} from '../../server/d1-lab/bootstrap.mjs';
import {createOperationalHistory} from '../../server/d1-lab/operational-history.mjs';
import {historicalEntities} from '../../server/d1-lab/history-readonly.mjs';
if(!['windows-candidate-20261021','windows-layout-20261021'].includes(installation?.id)||process.env.RUY_PREPARE_WINDOWS_CANDIDATE!=='1')throw Error('EXPLICIT_NEW_CANDIDATE_REQUIRED');
try{await fs.lstat(home);throw Error('EXISTING_CANDIDATE_PRESERVED');}catch(e){if(e.code!=='ENOENT')throw e;}
const root=process.argv[2];if(!root||!path.isAbsolute(root))throw Error('VERIFIED_IMPORT_ROOT_REQUIRED');
const open=async f=>JSON.parse(powershell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}',await fs.readFile(f,'utf8')));
const sourceOwner=await open(path.join(root,'owner.dpapi'));assert.equal(sourceOwner.host,'127.0.0.1');assert.equal(sourceOwner.port,55463);assert.match(sourceOwner.database,/^ruy_operational_trial_[a-f0-9]{12}$/);
const report=JSON.parse(await fs.readFile(path.join(root,'report.json'),'utf8'));assert.equal(report.imported,1186);assert.equal(report.sourceUnchanged,true);
const sourceBackup=await fs.readFile(path.join(root,'operational-backup.aesgcm'));assert.equal(createHash('sha256').update(sourceBackup).digest('hex'),report.backupSha256);
const previousHome=path.join(path.dirname(home),'installation-final-dev-20261021'),mail=await open(path.join(previousHome,'brevo-confirmed.dpapi'));assert.equal(mail.deliveryConfirmed,true);assert.equal(mail.senderVerified,true);
const dirs=await fs.readdir(previousHome,{withFileTypes:true});let proof;
for(const entry of dirs.filter(e=>e.isDirectory()&&e.name.startsWith('brevo-proof-'))){try{const result=JSON.parse(await fs.readFile(path.join(previousHome,entry.name,'result.json'),'utf8'));if(result.passed&&result.codeConfirmedOnServer&&result.codeReuseRefused)proof={result,context:await open(path.join(previousHome,entry.name,'context.dpapi'))};}catch{/* Failed proofs are preserved and never treated as success. */}}
if(!proof)throw Error('REAL_EMAIL_VERIFICATION_PROOF_REQUIRED');
const oldApp=await open(path.join(previousHome,'app.dpapi'));assert.equal(oldApp.host,'127.0.0.1');assert.equal(oldApp.port,55483);assert.match(proof.result.database,/^ruy_d1_rc_[a-f0-9]{16}$/);
const oldDb=new pg.Client({...oldApp,database:proof.result.database});await oldDb.connect();let verified;try{verified=(await oldDb.query('SELECT u.id,u.login,a.verified_at FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.login=$1 AND a.verified_at IS NOT NULL',[mail.recipient])).rows[0];}finally{await oldDb.end();}if(!verified)throw Error('VERIFIED_OWNER_IDENTITY_REQUIRED');
// Only after validating all source evidence, create a completely new own cluster.
await initializeLab();const owner=new pg.Client(await config(true));await owner.connect();const token=randomBytes(32).toString('hex');
try{
 await owner.query('BEGIN');await owner.query("INSERT INTO lab_users(id,login,password_hash,role,active) VALUES($1,$2,'disabled:no-login','viewer',false)",[verified.id,verified.login]);
 await owner.query("INSERT INTO identity_accounts(user_id,full_name,verified_at) VALUES($1,'Responsável Sistema Ruy',$2)",[verified.id,verified.verified_at]);
 await owner.query("INSERT INTO identity_bootstrap(token_hash,expires_at) VALUES($1,now()+interval '24 hours')",[createHash('sha256').update(token).digest('hex')]);await owner.query('COMMIT');
}catch(e){await owner.query('ROLLBACK');throw e;}finally{await owner.end();}
await seal('first-admin.dpapi',{purpose:'RUY_EXPLICIT_FIRST_ADMIN',installationId:installation.id,userId:verified.id,email:verified.login,token});
await seal('brevo-confirmed.dpapi',{...mail,installationId:installation.id});await seal('identity-service.dpapi',{purpose:'RUY_INDIVIDUAL_IDENTITY_DEV',installationId:installation.id,pepper:randomBytes(32).toString('base64'),mail:{provider:'brevo-dpapi'}});
const sourceRoot=path.join(path.dirname(path.dirname(root)),'ensaio-postgresql','ensaio-2026-10-20T21-33-52-094Z-e9e1ff00'),admin=await open(path.join(sourceRoot,'admin.dpapi'));assert.equal(admin.host,'127.0.0.1');assert.equal(admin.port,55463);
const readerRole='ruy_import_'+randomBytes(8).toString('hex')+'_reader',readConfig={...sourceOwner,user:readerRole,password:randomBytes(32).toString('hex')},control=new pg.Client(admin);await control.connect();try{await control.query(`CREATE ROLE ${readerRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${readConfig.password}'`);await control.query(`ALTER ROLE ${readerRole} SET default_transaction_read_only=on`);await control.query(`GRANT CONNECT ON DATABASE ${sourceOwner.database} TO ${readerRole}`);}finally{await control.end();}
const sourceDb=new pg.Client(sourceOwner);await sourceDb.connect();try{await sourceDb.query(`GRANT USAGE ON SCHEMA history TO ${readerRole};GRANT SELECT ON ALL TABLES IN SCHEMA history TO ${readerRole};GRANT SELECT ON historical_import_receipts TO ${readerRole}`);}finally{await sourceDb.end();}
const grants=[{userId:verified.id,entities:historicalEntities,attachments:true}],reader=new pg.Pool(readConfig);try{await createOperationalHistory({pool:reader,grants}).verify();}finally{await reader.end();}
await seal('recovered-source.dpapi',{purpose:'RUY_ISOLATED_RECOVERED_CANDIDATE',installationId:installation.id,config:readConfig,grants});
await fs.mkdir(path.join(home,'history-backups'));await fs.writeFile(path.join(home,'history-backups','original-operational.aesgcm'),sourceBackup,{flag:'wx'});await seal('history-backup-key.dpapi',{purpose:'RUY_RECOVERED_CANDIDATE_BACKUP',...await open(path.join(root,'backup-key.dpapi'))});
await fs.writeFile(path.join(home,'candidate-preparation.json'),JSON.stringify({purpose:'RUY_ISOLATED_WINDOWS_CANDIDATE',records:1186,linked:54,quarantine:5,sourceBackupSha256:report.backupSha256,administratorAutomaticallyCreated:false,ownerEmailVerified:true,explicitAdminConsentPending:true,operationalActivation:false,syntheticBusinessRecords:0},null,2),{flag:'wx'});
const marker=await validateHome();pgCommand(marker.bin,'pg_ctl',['-D',cluster,'-m','smart','-w','-t','60','stop']);
console.log(JSON.stringify({prepared:true,installationId:installation.id,apiPort:installation.apiPort,authDatabasePort:installation.dbPort,historicalSourcePort:55463,records:1186,linked:54,quarantine:5,adminConsentPending:true,emailSent:false,ownedDatabaseStoppedNormally:true}));
