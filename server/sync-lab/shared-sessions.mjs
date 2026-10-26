import {randomBytes} from 'node:crypto';
import {digest,fail,transaction} from '../d1-lab/core.mjs';
export function sharedSessions(pool,identity){
 if(!identity?.allowed||!identity?.verifyPassword||!identity?.throttle)throw Error('Existing central identity service required');
 async function device(token,c=pool,lock=false){
  if(!/^[a-f0-9]{64}$/.test(token||''))throw fail(403,'Device authorization required.');
  const d=(await c.query('SELECT * FROM shared_devices WHERE credential_hash=$1 AND active'+(lock?' FOR SHARE':''),[digest(token)])).rows[0];
  if(!d)throw fail(403,'Device authorization required.');return d;
 }
 async function login(deviceToken,body){
  const d=await device(deviceToken);await identity.throttle('shared-login|'+d.device_id,5);
  const login=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(!login||login.length>254||typeof body.password!=='string'||body.password.length>256)throw fail(400,'Invalid login.');
  const user=(await pool.query('SELECT * FROM lab_users WHERE login=$1',[login])).rows[0];
  // The existing bounded KDF also runs for unknown identities.
  const dummy=await pool.query('SELECT password_hash FROM lab_users ORDER BY id LIMIT 1');
  if(!await identity.verifyPassword(body.password,user?.password_hash||dummy.rows[0]?.password_hash)||!user?.active||!await identity.allowed(user.id))throw fail(401,'Account not authorized.');
  return transaction(pool,async c=>{
   await device(deviceToken,c,true);
   const member=(await c.query('SELECT m.role,u.role user_role FROM shared_memberships m JOIN lab_users u ON u.id=m.user_id JOIN identity_accounts a ON a.user_id=u.id WHERE m.user_id=$1 AND m.workspace_id=$2 AND m.active AND u.active AND a.verified_at IS NOT NULL AND a.approved_at IS NOT NULL AND a.revoked_at IS NULL FOR SHARE OF m,u,a',[user.id,d.workspace_id])).rows[0];
   if(!member||member.role==='admin'&&member.user_role!=='admin')throw fail(403,'Workspace not authorized.');
   const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*3600000).toISOString();
   await c.query('INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(device_id,actor_id) DO UPDATE SET token_hash=excluded.token_hash,workspace_id=excluded.workspace_id,role=excluded.role,active=true',[digest(token),d.device_id,user.id,d.workspace_id,member.role]);
   await c.query('INSERT INTO shared_sessions VALUES($1,$2) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at',[digest(token),expiresAt]);
   await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'shared_login')",[user.id]);
   return {token,expiresAt,userId:user.id,deviceId:d.device_id,workspaceId:d.workspace_id,role:member.role};
  });
 }
 async function authorize(deviceToken,sessionToken,c=pool,lock=false){
  const d=await device(deviceToken,c,lock);
  if(!/^[a-f0-9]{64}$/.test(sessionToken||''))throw fail(401,'Individual session required.');
  const p=(await c.query(`SELECT p.* FROM d1_principals p JOIN shared_sessions s USING(token_hash)
   JOIN shared_memberships m ON m.user_id=p.actor_id AND m.workspace_id=p.workspace_id
   JOIN lab_users u ON u.id=p.actor_id JOIN identity_accounts a ON a.user_id=u.id
   WHERE p.token_hash=$1 AND p.device_id=$2 AND p.workspace_id=$3 AND p.active AND s.expires_at>now()
   AND m.active AND m.role=p.role AND u.active AND (p.role<>'admin' OR u.role='admin')
   AND a.verified_at IS NOT NULL AND a.approved_at IS NOT NULL AND a.revoked_at IS NULL`+(lock?' FOR SHARE OF p,s,m,u,a':''),[digest(sessionToken),d.device_id,d.workspace_id])).rows[0];
  if(!p)throw fail(401,'Individual session expired or revoked.');return p;
 }
 async function logout(deviceToken,sessionToken){return transaction(pool,async c=>{const p=await authorize(deviceToken,sessionToken,c,true);await c.query('DELETE FROM shared_sessions WHERE token_hash=$1',[p.token_hash]);await c.query('UPDATE d1_principals SET active=false WHERE token_hash=$1',[p.token_hash]);await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'shared_logout')",[p.actor_id]);return {loggedOut:true};});}
 return {device,login,authorize,logout};
}
