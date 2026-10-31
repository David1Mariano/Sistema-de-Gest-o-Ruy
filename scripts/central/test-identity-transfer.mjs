// Two fresh synthetic databases and loopback HTTPS only. No real identities.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {identityFingerprint,transferIdentity} from '../../server/central/identity-transfer.mjs';
process.env.RUY_D1_INSTALLATION='final-dev-20261021';process.env.RUY_D1_ALLOW_TESTS='1';process.env.RUY_D1_TEST_API_PORT='18133';process.env.RUY_SHARED_LAB='1';
const {config}=await import('../../server/d1-lab/environment.mjs'),{pg}=await import('../../server/d1-lab/core.mjs');
const {identityPassword,createIdentity}=await import('../../server/d1-lab/identity.mjs');
const {initializeCentralSchema}=await import('../../server/central/schema.mjs');
const {loadProfile}=await import('../../server/central/profile.mjs');
const {createUserTransport,sendUserTLS}=await import('../../server/sync-lab/user-transport.mjs');
const receipt=JSON.parse(await fs.readFile('artifacts/homologacao-lan-ativa-79402bbf27e83425/server.json','utf8'));
const frozen=name=>import(pathToFileURL(path.join(receipt.prepDirectory,name)));
const {userSessions}=await frozen('server/sync-lab/user-sessions.mjs'),{createSharedApi}=await frozen('server/sync-lab/shared-server.mjs');
const owner=await config(true);assert.equal(owner.host,'127.0.0.1');assert.equal(owner.port,55483);
const control=new pg.Client(owner);await control.connect();const databases=[],pools=[],apis=[],transports=[],checks=[];
const workspaceId=randomUUID(),userId=randomUUID(),password='FICTICIO ç 保全 '+randomBytes(20).toString('hex');
const out=path.resolve('artifacts/login-original-20261028');await fs.mkdir(out,{recursive:true});
const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log('PASS '+name);};
try{
 for(let i=0;i<2;i++){
  const database='ruy_d1_rc_'+randomBytes(8).toString('hex');await control.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await control.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');databases.push(database);
  const pool=new pg.Pool({...owner,database});pools.push(pool);await initializeCentralSchema(pool,{lab:true});
 }
 const source=pools[0],destination=pools[1],hash=await identityPassword(password);
 await source.query("INSERT INTO lab_users VALUES($1,$2,$3,'admin',true)",[userId,'identity-'+userId+'@example.invalid',hash]);
 await source.query("INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by) VALUES($1,'FICTICIO Identidade preservada',now(),now(),$1)",[userId]);
 await source.query("INSERT INTO shared_memberships VALUES($1,$2,'admin',true)",[userId,workspaceId]);
 const snapshot=(await source.query('SELECT to_jsonb(u) "user",to_jsonb(a) identity FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=$1',[userId])).rows[0];
 const {secrets}=await loadProfile(receipt.profile);
 for(const pool of pools){
  const identity=createIdentity({pool,sender:async()=>{throw Error('SYNTHETIC_MAIL_DISABLED');},pepper:randomBytes(32)});
  const api=createSharedApi({pool,identity,authentication:userSessions(pool,identity),writable:async()=>false});await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));apis.push(api);
  const tls=createUserTransport({apiPort:api.address().port,key:secrets.tlsKey,cert:secrets.tlsCert});await tls.listen(0);transports.push(tls);
 }
 const call=async(n,route,{body,token}={})=>{const r=await sendUserTLS({url:'https://127.0.0.1:'+transports[n].server.address().port+'/api/local/d1'+route,ca:secrets.tlsCa,userSession:token,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});return {status:r.status,body:JSON.parse(r.body)};};
 const login=n=>call(n,'/session/login',{body:{email:snapshot.user.login,password,clientId:randomUUID()}});
 const options={syntheticTest:true,workspaceId};
 await check('original synthetic password works in source, absent identity is refused in destination',async()=>{assert.equal((await login(0)).status,200);assert.equal((await login(1)).status,401);});
 await check('real-looking identity and missing approval cannot enter the synthetic import',async()=>{
  const realLooking={...snapshot,user:{...snapshot.user,login:'blocked@empresa.example'}};
  await assert.rejects(transferIdentity(destination,realLooking,options),{code:'REAL_IDENTITY_REFUSED_IN_SYNTHETIC_TEST'});
  await assert.rejects(transferIdentity(destination,snapshot,{workspaceId}),{code:'EXPLICIT_ACCOUNT_TRANSFER_AUTHORIZATION_REQUIRED'});
 });
 await check('explicit approval still requires reconfirmation of the current original source',async()=>{
  const authorization={contract:'RUY_ACCOUNT_ONLY_AUTHORIZATION/1',accountTransferApproved:true,allowRealIdentityInPublicHomologation:true,businessDataMigrationApproved:false,passwordResetApproved:false,accountId:userId,identityFingerprint:identityFingerprint(snapshot),workspaceId,publicOrigin:'https://ficticio.example.invalid',approvedBy:'FICTICIO',expiresAt:new Date(Date.now()+60000).toISOString()};
  await assert.rejects(transferIdentity(destination,snapshot,{workspaceId,publicOrigin:authorization.publicOrigin,authorization,sourceCurrentVerified:false}),{code:'CURRENT_SOURCE_IDENTITY_MUST_BE_RECONFIRMED'});
  await assert.rejects(transferIdentity(destination,snapshot,{workspaceId,publicOrigin:authorization.publicOrigin,authorization,sourceCurrentVerified:true}),{code:'EXACT_AUTHORIZED_TARGET_REQUIRED'});
 });
 await check('transactional import preserves UUID, password hash, approval metadata and admin role exactly',async()=>{
  assert.equal((await transferIdentity(destination,snapshot,options)).imported,true);
  const copied=(await destination.query('SELECT to_jsonb(u) "user",to_jsonb(a) identity FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=$1',[userId])).rows[0];assert.deepEqual(copied,snapshot);
  const accepted=await login(1);assert.equal(accepted.status,200);assert.equal(accepted.body.userId,userId);assert.equal(accepted.body.role,'admin');assert.equal(accepted.body.workspaceId,workspaceId);
  assert.equal((await call(1,'/state',{token:accepted.body.token})).status,200);assert.equal((await login(0)).status,200);
 });
 await check('concurrent resend is idempotent without duplicate accounts or duplicate import audit',async()=>{
  const copies=await Promise.all([transferIdentity(destination,snapshot,options),transferIdentity(destination,snapshot,options)]);assert.ok(copies.every(r=>r.replay));assert.equal((await destination.query('SELECT count(*)::int n FROM lab_users WHERE id=$1 OR login=$2',[userId,snapshot.user.login])).rows[0].n,1);assert.equal((await destination.query("SELECT count(*)::int n FROM lab_audit WHERE actor=$1 AND action='original_identity_imported_without_password_change'",[userId])).rows[0].n,1);
 });
 await check('conflicting email, UUID, hash and workspace cannot overwrite an existing identity',async()=>{
  for(const altered of [{...snapshot,user:{...snapshot.user,id:randomUUID()},identity:{...snapshot.identity,user_id:null}},{...snapshot,user:{...snapshot.user,password_hash:await identityPassword('FICTICIO outra senha '+randomBytes(12).toString('hex'))}}]){
   if(!altered.identity.user_id){altered.identity={...altered.identity,user_id:altered.user.id,approved_by:altered.user.id};}
   await assert.rejects(transferIdentity(destination,altered,options),{code:'EXISTING_IDENTITY_CONFLICT_PRESERVED'});
  }
  await assert.rejects(transferIdentity(destination,snapshot,{...options,workspaceId:randomUUID()}),{code:'EXISTING_IDENTITY_CONFLICT_PRESERVED'});assert.equal((await login(1)).status,200);
 });
 await check('failure in the second table rolls back the user insert completely',async()=>{
  const id=randomUUID(),other={user:{...snapshot.user,id,login:id+'@example.invalid'},identity:{...snapshot.identity,user_id:id,approved_by:id}};
  await destination.query("CREATE FUNCTION ficticio_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FICTICIO FAILURE'; END $$; CREATE TRIGGER ficticio_import_failure BEFORE INSERT ON identity_accounts FOR EACH ROW EXECUTE FUNCTION ficticio_import_failure()");
  try{await assert.rejects(transferIdentity(destination,other,options),{code:'IDENTITY_TRANSFER_ABORTED_WITHOUT_OVERWRITE'});assert.equal((await destination.query('SELECT count(*)::int n FROM lab_users WHERE id=$1',[id])).rows[0].n,0);}finally{await destination.query('DROP TRIGGER ficticio_import_failure ON identity_accounts; DROP FUNCTION ficticio_import_failure()');}
 });
 await check('disabled source identity remains disabled and cannot authenticate',async()=>{
  const id=randomUUID(),other={user:{...snapshot.user,id,login:id+'@example.invalid',active:false,role:'viewer'},identity:{...snapshot.identity,user_id:id,approved_by:id}};await transferIdentity(destination,other,options);
  assert.equal((await call(1,'/session/login',{body:{email:other.user.login,password}})).status,401);
 });
 await check('rollback by revoking only the destination membership leaves original login unchanged',async()=>{
  const central=await login(1);assert.equal(central.status,200);await destination.query('UPDATE shared_memberships SET active=false WHERE user_id=$1',[userId]);assert.equal((await call(1,'/state',{token:central.body.token})).status,401);assert.equal((await login(0)).status,200);assert.equal((await source.query('SELECT password_hash FROM lab_users WHERE id=$1',[userId])).rows[0].password_hash,hash);
 });
 const result={at:new Date().toISOString(),passed:true,checks,syntheticDatabases:databases,isolatedLoopbackHttps:true,frozenPrep4AuthenticationUsed:true,sourceAndDestinationUseDifferentIdentityPeppers:true,originalPasswordRetained:true,exactPasswordHashRetained:true,noPasswordReset:true,noDuplicateAccounts:true,transactionRollbackVerified:true,destinationOnlyRevocationVerified:true,realIdentitiesTransferred:false,publicHomologationDatabaseChanged:false,operationalDatabaseChanged:false,installerRebuilt:false};await fs.writeFile(path.join(out,'synthetic-transfer-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 for(const t of transports){t.server.closeAllConnections();if(t.server.listening)await new Promise(resolve=>t.server.close(resolve));}
 for(const a of apis){a.closeAllConnections();if(a.listening)await new Promise(resolve=>a.close(resolve));}
 for(const pool of pools)await pool.end();await control.end();
}
