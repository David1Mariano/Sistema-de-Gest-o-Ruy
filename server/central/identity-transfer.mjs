// Owner-only identity import. Never called by the public API or its runtime role.
// No password generation, reset, session import, business-data import or upsert.
import {createHash} from 'node:crypto';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fail=code=>{throw Object.assign(Error(code),{code});};
const userKeys=['id','login','password_hash','role','active'];
const identityKeys=['user_id','full_name','verified_at','approved_at','approved_by','revoked_at','created_at'];
export function identitySnapshot(input){
 if(!input?.user||!input.identity)fail('SOURCE_IDENTITY_REQUIRED');
 const user=Object.fromEntries(userKeys.map(k=>[k,input.user[k]])),identity=Object.fromEntries(identityKeys.map(k=>[k,input.identity[k]]));
 if(!uuid(user.id)||identity.user_id!==user.id||typeof user.login!=='string'||user.login!==user.login.trim().toLowerCase()||user.login.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.login)||typeof user.active!=='boolean')fail('SOURCE_IDENTITY_INVALID');
 // Preserve unsupported roles by refusing, never by silently changing privileges.
 if(!['admin','viewer'].includes(user.role))fail('SOURCE_ROLE_NOT_SUPPORTED_BY_CURRENT_SESSION_CONTRACT');
 if(!/^(?:scrypt|scrypt-v2):[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.password_hash||''))fail('SOURCE_PASSWORD_HASH_UNSUPPORTED');
 if(typeof identity.full_name!=='string'||!identity.full_name.trim()||identity.full_name.length>1000||identity.approved_by!==null&&!uuid(identity.approved_by))fail('SOURCE_IDENTITY_METADATA_INVALID');
 for(const key of ['verified_at','approved_at','revoked_at','created_at'])if(identity[key]!==null&&(typeof identity[key]!=='string'||!Number.isFinite(Date.parse(identity[key]))))fail('SOURCE_IDENTITY_TIMESTAMP_INVALID');
 if(!identity.created_at)fail('SOURCE_IDENTITY_TIMESTAMP_INVALID');
 return {user,identity};
}
export function identityFingerprint(input){const s=identitySnapshot(input);return createHash('sha256').update(JSON.stringify(s)).digest('hex');}
function authorize(snapshot,{authorization:a,workspaceId,publicOrigin,sourceCurrentVerified,syntheticTest=false}={}){
 if(!uuid(workspaceId))fail('EXPLICIT_WORKSPACE_REQUIRED');
 const fake=snapshot.user.login.endsWith('.invalid')&&snapshot.identity.full_name.startsWith('FICTICIO ');
 if(syntheticTest){if(!fake)fail('REAL_IDENTITY_REFUSED_IN_SYNTHETIC_TEST');return;}
 if(!a||a.contract!=='RUY_ACCOUNT_ONLY_AUTHORIZATION/1'||a.accountTransferApproved!==true||a.allowRealIdentityInPublicHomologation!==true||a.businessDataMigrationApproved!==false||a.passwordResetApproved!==false||a.accountId!==snapshot.user.id||a.identityFingerprint!==identityFingerprint(snapshot)||a.workspaceId!==workspaceId||a.publicOrigin!==publicOrigin||!a.approvedBy||typeof a.approvedBy!=='string'||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())fail('EXPLICIT_ACCOUNT_TRANSFER_AUTHORIZATION_REQUIRED');
 if(sourceCurrentVerified!==true)fail('CURRENT_SOURCE_IDENTITY_MUST_BE_RECONFIRMED');
}
export async function transferIdentity(pool,input,options){
 const snapshot=identitySnapshot(input);authorize(snapshot,options);const {user:u,identity:a}=snapshot;
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const target=(await c.query("SELECT current_database() db,current_setting('port') port,(SELECT purpose FROM central_deployment WHERE singleton) purpose")).rows[0];
  // This narrow preparation supports only the existing synthetic namespace.
  // Production activation/migration requires its separate controlled workflow.
  if(target.port!=='55483'||!/^ruy_d1_rc_[a-f0-9]{16}$/.test(target.db)||target.purpose!=='RUY_CENTRAL_LAB')fail('ACCOUNT_ONLY_HOMOLOGATION_TARGET_REQUIRED');
  if(!options.syntheticTest&&(options.authorization.targetDatabase!==target.db||options.authorization.targetPort!==55483))fail('EXACT_AUTHORIZED_TARGET_REQUIRED');
  await c.query('LOCK TABLE lab_users,identity_accounts,shared_memberships IN SHARE ROW EXCLUSIVE MODE');
  const matches=(await c.query('SELECT id FROM lab_users WHERE id=$1 OR lower(login)=$2',[u.id,u.login])).rows;
  let replay=false;
  if(matches.length){
   if(matches.length!==1||matches[0].id!==u.id)fail('EXISTING_IDENTITY_CONFLICT_PRESERVED');
   const same=(await c.query(`SELECT 1 FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id
    WHERE u.id=$1 AND u.login=$2 AND u.password_hash=$3 AND u.role=$4 AND u.active=$5
    AND a.full_name=$6 AND a.verified_at IS NOT DISTINCT FROM $7::timestamptz
    AND a.approved_at IS NOT DISTINCT FROM $8::timestamptz AND a.approved_by IS NOT DISTINCT FROM $9::uuid
    AND a.revoked_at IS NOT DISTINCT FROM $10::timestamptz AND a.created_at=$11::timestamptz`,[u.id,u.login,u.password_hash,u.role,u.active,a.full_name,a.verified_at,a.approved_at,a.approved_by,a.revoked_at,a.created_at])).rowCount;
   const memberships=(await c.query('SELECT workspace_id,role,active FROM shared_memberships WHERE user_id=$1',[u.id])).rows;
   if(!same||memberships.length!==1||memberships[0].workspace_id!==options.workspaceId||memberships[0].role!==u.role||memberships[0].active!==u.active)fail('EXISTING_IDENTITY_CONFLICT_PRESERVED');
   replay=true;
  }else{
   if(a.approved_by&&a.approved_by!==u.id&&!(await c.query('SELECT 1 FROM lab_users WHERE id=$1',[a.approved_by])).rowCount)fail('ORIGINAL_APPROVER_IDENTITY_REQUIRED');
   await c.query('INSERT INTO lab_users(id,login,password_hash,role,active) VALUES($1,$2,$3,$4,$5)',[u.id,u.login,u.password_hash,u.role,u.active]);
   await c.query('INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by,revoked_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[u.id,a.full_name,a.verified_at,a.approved_at,a.approved_by,a.revoked_at,a.created_at]);
   await c.query('INSERT INTO shared_memberships(user_id,workspace_id,role,active) VALUES($1,$2,$3,$4)',[u.id,options.workspaceId,u.role,u.active]);
   await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'original_identity_imported_without_password_change')",[u.id]);
  }
  await c.query('COMMIT');return {imported:!replay,replay,identityPreserved:true,passwordHashPreserved:true,rolePreserved:true,businessDataMigrated:false,sessionsImported:false};
 }catch(error){await c.query('ROLLBACK');if(error.code&&/^[A-Z_]+$/.test(error.code))throw error;throw Object.assign(Error('IDENTITY_TRANSFER_ABORTED_WITHOUT_OVERWRITE'),{code:'IDENTITY_TRANSFER_ABORTED_WITHOUT_OVERWRITE'});}finally{c.release();}
}
