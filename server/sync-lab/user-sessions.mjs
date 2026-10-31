import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {digest,fail,transaction,uuid} from '../d1-lab/core.mjs';

// Device_id remains an audit correlation UUID in the existing D1 contract.
// It is derived by the server after login, never enrolled or approved.
// A non-secret installation nonce keeps operation replays stable after relogin;
// it grants no authority and is always scoped by user and workspace.
export function userSessions(pool,identity){
 async function login(_unused,body,{address='unknown'}={}){
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  await identity.throttle('user-login-ip|'+address,40);
  await identity.throttle('user-login-account|'+email,5);
  if(!email||email.length>254||typeof body.password!=='string'||Buffer.byteLength(body.password)>256||body.clientId!==undefined&&!uuid(body.clientId))throw fail(400,'Credenciais inválidas.');
  const user=(await pool.query('SELECT * FROM lab_users WHERE login=$1',[email])).rows[0];
  const dummy=(await pool.query("SELECT password_hash FROM lab_users WHERE password_hash LIKE 'scrypt-v2:%' ORDER BY id LIMIT 1")).rows[0];
  const valid=await identity.verifyPassword(body.password,user?.password_hash||dummy?.password_hash);
  if(!valid||!user?.active||!await identity.allowed(user.id)){
   await pool.query("INSERT INTO lab_audit(actor,action) VALUES($1,'user_login_refused')",[user?.id||null]);
   throw fail(401,'E-mail ou senha inválidos, ou conta sem acesso.');
  }
  return transaction(pool,async c=>{
   const members=(await c.query(`SELECT m.*,u.role user_role,u.password_hash,a.full_name FROM shared_memberships m
    JOIN lab_users u ON u.id=m.user_id JOIN identity_accounts a ON a.user_id=u.id
    WHERE m.user_id=$1 AND m.active AND u.active AND a.verified_at IS NOT NULL AND a.approved_at IS NOT NULL
    AND a.revoked_at IS NULL FOR SHARE OF m,u,a`,[user.id])).rows;
   // Ambiguous tenant selection must never silently grant access to a company.
   if(members.length!==1||members[0].password_hash!==user.password_hash||!['admin','viewer'].includes(members[0].role)||members[0].role==='admin'&&members[0].user_role!=='admin')throw fail(403,'Conta sem espaço de trabalho único autorizado.');
   const member=members[0],token=randomBytes(32).toString('hex'),nonce=body.clientId||randomUUID();
   const value=createHash('sha256').update('RUY-USER-CORRELATION/1|'+member.workspace_id+'|'+user.id+'|'+nonce).digest().subarray(0,16);value[6]=(value[6]&15)|64;value[8]=(value[8]&63)|128;
   const hex=value.toString('hex'),deviceId=[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-'),expiresAt=new Date(Date.now()+8*3600000).toISOString();
   await c.query('INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(device_id,actor_id) DO UPDATE SET token_hash=excluded.token_hash,workspace_id=excluded.workspace_id,role=excluded.role,active=true',[digest(token),deviceId,user.id,member.workspace_id,member.role]);
   await c.query('INSERT INTO shared_sessions(token_hash,expires_at) VALUES($1,$2) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at',[digest(token),expiresAt]);
   await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'user_session_login')",[user.id]);
   return {token,expiresAt,userId:user.id,deviceId,workspaceId:member.workspace_id,role:member.role,fullName:member.full_name,authentication:'user-session'};
  });
 }
 async function authorize(_unused,token,c=pool,lock=false){
  if(!/^[a-f0-9]{64}$/.test(token||''))throw fail(401,'Sessão individual obrigatória.');
  const p=(await c.query(`SELECT p.* FROM d1_principals p JOIN shared_sessions s USING(token_hash)
   JOIN shared_memberships m ON m.user_id=p.actor_id AND m.workspace_id=p.workspace_id
   JOIN lab_users u ON u.id=p.actor_id JOIN identity_accounts a ON a.user_id=u.id
   WHERE p.token_hash=$1 AND p.active AND s.expires_at>now() AND m.active AND m.role=p.role AND u.active
   AND (p.role<>'admin' OR u.role='admin') AND a.verified_at IS NOT NULL AND a.approved_at IS NOT NULL AND a.revoked_at IS NULL`+(lock?' FOR SHARE OF p,s,m,u,a':''),[digest(token)])).rows[0];
  if(!p)throw fail(401,'Sessão expirada ou revogada.');return p;
 }
 async function logout(_unused,token){return transaction(pool,async c=>{const p=await authorize(null,token,c,true);await c.query('DELETE FROM shared_sessions WHERE token_hash=$1',[p.token_hash]);await c.query('UPDATE d1_principals SET active=false WHERE token_hash=$1',[p.token_hash]);await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'user_session_logout')",[p.actor_id]);return {loggedOut:true};});}
 return {login,authorize,logout};
}
