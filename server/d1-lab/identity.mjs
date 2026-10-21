import {randomInt,randomUUID,randomBytes,createHmac,timingSafeEqual,scrypt} from 'node:crypto';
import {promisify} from 'node:util';
import {digest,fail,transaction,verifyPassword} from './core.mjs';
const derive=promisify(scrypt);
let runningKdf=0;
async function boundedDerive(value,salt){
 if(runningKdf>=2)throw fail(429,'Aguarde antes de tentar novamente.');
 runningKdf++;try{return await derive(value,salt,64,{N:131072,r:8,p:1,maxmem:192*1024*1024});}finally{runningKdf--;}
}
export async function identityPassword(value){
 if(typeof value!=='string'||value.length<15||Buffer.byteLength(value)>256)throw fail(400,'Use uma senha individual de 15 a 256 caracteres/bytes.');
 const salt=randomBytes(16).toString('hex');
 return 'scrypt-v2:'+salt+':'+(await boundedDerive(value,salt)).toString('hex');
}
export async function identityVerify(value,hash){
 if(!String(hash).startsWith('scrypt-v2:'))return verifyPassword(value,hash);
 if(typeof value!=='string'||Buffer.byteLength(value)>256)return false;
 const [,salt,key]=hash.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{128}$/.test(key))return false;
 return timingSafeEqual(await boundedDerive(value,salt),Buffer.from(key,'hex'));
}
const email=value=>{const v=String(value||'').trim().toLowerCase();if(v.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))throw fail(400,'Informe um e-mail válido.');return v;};
const accepted={ok:true,message:'Se a conta puder receber esta solicitação, um código será enviado. Nenhum código é exibido no aplicativo.'};
// A sender must be explicitly configured. There is no demo-code fallback.
export function createIdentity({pool,sender,pepper}){
 if(typeof sender!=='function'||!Buffer.isBuffer(pepper)||pepper.length<32)throw Error('IDENTITY_CONFIGURATION_REQUIRED');
 const codeHash=(id,purpose,code)=>createHmac('sha256',pepper).update(id+'|'+purpose+'|'+code).digest('hex');
 async function throttle(key,max=5){
  const r=await pool.query(`INSERT INTO lab_attempts(address,attempts,expires_at) VALUES($1,1,now()+interval '30 minutes') ON CONFLICT(address) DO UPDATE SET attempts=CASE WHEN lab_attempts.expires_at<now() THEN 1 ELSE lab_attempts.attempts+1 END,expires_at=CASE WHEN lab_attempts.expires_at<now() THEN now()+interval '30 minutes' ELSE lab_attempts.expires_at END RETURNING attempts`,['identity:'+digest(key)]);
  if(r.rows[0].attempts>max)throw fail(429,'Aguarde antes de tentar novamente.');
 }
 async function issue(login,purpose,address){
  await throttle('send-ip|'+address,20);await throttle('send|'+purpose+'|'+login);
  const row=(await pool.query('SELECT u.id FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.login=$1 AND a.revoked_at IS NULL',[login])).rows[0];
  if(!row)return accepted;
  const code=String(randomInt(1000000)).padStart(6,'0');
  const inserted=await transaction(pool,async c=>{
   await c.query('SELECT user_id FROM identity_accounts WHERE user_id=$1 FOR UPDATE',[row.id]);
   const prior=(await c.query('SELECT sent_at>now()-interval \'60 seconds\' AS recent FROM identity_codes WHERE user_id=$1 AND purpose=$2',[row.id,purpose])).rows[0];
   if(prior?.recent)throw fail(429,'Aguarde um minuto para reenviar.');
   await c.query(`INSERT INTO identity_codes(user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes') ON CONFLICT(user_id,purpose) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0,sent_at=now(),consumed_at=NULL`,[row.id,purpose,codeHash(row.id,purpose,code)]);return true;
  });
  if(inserted){try{await sender({to:login,code,purpose,id:randomUUID()});}catch{await pool.query('UPDATE identity_codes SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND code_hash=$3',[row.id,purpose,codeHash(row.id,purpose,code)]);throw fail(503,'O envio não foi confirmado. Aguarde e solicite outro código.');}}
  return accepted;
 }
 async function consume(login,purpose,code,apply){
  if(!/^\d{6}$/.test(String(code||'')))throw fail(400,'Código inválido.');
  const result=await transaction(pool,async c=>{
   const r=(await c.query(`SELECT u.id,k.* FROM lab_users u JOIN identity_codes k ON k.user_id=u.id JOIN identity_accounts a ON a.user_id=u.id WHERE u.login=$1 AND k.purpose=$2 AND a.revoked_at IS NULL FOR UPDATE OF k,a`,[login,purpose])).rows[0];
   if(!r||r.consumed_at||new Date(r.expires_at)<=new Date()||r.attempts>=5)return false;
   const match=timingSafeEqual(Buffer.from(r.code_hash,'hex'),Buffer.from(codeHash(r.id,purpose,String(code)),'hex'));
   await c.query('UPDATE identity_codes SET attempts=attempts+1,consumed_at=CASE WHEN $3 THEN now() ELSE consumed_at END WHERE user_id=$1 AND purpose=$2',[r.id,purpose,match]);
   if(!match)return false;
   await apply(c,r.id);return true;
  });
  if(!result)throw fail(400,'Código inválido, expirado ou já utilizado.');return {ok:true};
 }
 async function route(url,body,address,user){
  const path=url.pathname;
  if(path==='/api/d1/account/register'){
   const login=email(body.email),name=String(body.name||'').trim();if(name.length<2||name.length>120)throw fail(400,'Informe seu nome.');
   if(sender.accepts&&!sender.accepts(login))throw fail(503,'O serviço de e-mail atual não permite confirmar este destinatário.');
   await throttle('register-ip|'+address,10);
   const hash=await identityPassword(body.password);
   await transaction(pool,async c=>{
    const id=randomUUID();const added=await c.query("INSERT INTO lab_users(id,login,password_hash,role,active) VALUES($1,$2,$3,'viewer',false) ON CONFLICT(login) DO NOTHING RETURNING id",[id,login,hash]);
    if(added.rowCount){await c.query('INSERT INTO identity_accounts(user_id,full_name) VALUES($1,$2)',[id,name]);await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'account_registered_pending')",[id]);}
   });return issue(login,'verify',address);
  }
  if(path==='/api/d1/account/resend')return issue(email(body.email),'verify',address);
  if(path==='/api/d1/account/reset-request')return issue(email(body.email),'reset',address);
  if(path==='/api/d1/account/verify'){
   await throttle('verify-ip|'+address,30);
   return consume(email(body.email),'verify',body.code,async(c,id)=>{await c.query('UPDATE identity_accounts SET verified_at=COALESCE(verified_at,now()) WHERE user_id=$1',[id]);await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'email_verified_pending_approval')",[id]);});
  }
  if(path==='/api/d1/account/reset'){
   await throttle('reset-ip|'+address,20);const hash=await identityPassword(body.password);
   return consume(email(body.email),'reset',body.code,async(c,id)=>{await c.query('UPDATE lab_users SET password_hash=$2 WHERE id=$1',[id,hash]);await c.query('DELETE FROM lab_sessions WHERE user_id=$1',[id]);await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'password_reset_sessions_revoked')",[id]);});
  }
  if(!user)throw fail(401,'Sessão obrigatória.');
  if(path==='/api/d1/account/change-password'){
   await throttle('change|'+user.id);const row=(await pool.query('SELECT password_hash FROM lab_users WHERE id=$1',[user.id])).rows[0];if(!await identityVerify(body.currentPassword,row.password_hash))throw fail(401,'Credenciais inválidas.');const hash=await identityPassword(body.password);
   return transaction(pool,async c=>{const changed=await c.query('UPDATE lab_users SET password_hash=$2 WHERE id=$1 AND password_hash=$3 RETURNING id',[user.id,hash,row.password_hash]);if(!changed.rowCount)throw fail(409,'Senha alterada por outra solicitação; entre novamente.');await c.query('DELETE FROM lab_sessions WHERE user_id=$1',[user.id]);await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'password_changed_sessions_revoked')",[user.id]);return {ok:true};});
  }
  if(user.role!=='admin')throw fail(403,'Administração restrita.');
  if(path==='/api/d1/account/users')return {users:(await pool.query('SELECT u.id,u.login,u.role,u.active,a.full_name,a.verified_at,a.approved_at,a.revoked_at FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id ORDER BY a.created_at LIMIT 200')).rows};
  if(path==='/api/d1/account/authorize'){
   if(!['admin','writer','viewer'].includes(body.role)||typeof body.active!=='boolean'||body.userId===user.id)throw fail(400,'Concessão inválida.');
   return transaction(pool,async c=>{
    // Serializes changes to avoid concurrently revoking the last administrator.
    await c.query('SELECT pg_advisory_xact_lock(810231)');
    const target=(await c.query('SELECT u.role,a.verified_at FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u,a',[body.userId])).rows[0];if(!target||!target.verified_at)throw fail(409,'Conta deve confirmar o e-mail primeiro.');
    await c.query('UPDATE lab_users SET role=$2,active=$3 WHERE id=$1',[body.userId,body.role,body.active]);await c.query('UPDATE identity_accounts SET approved_at=now(),approved_by=$2,revoked_at=CASE WHEN $3 THEN NULL ELSE now() END WHERE user_id=$1',[body.userId,user.id,body.active]);await c.query('DELETE FROM lab_sessions WHERE user_id=$1',[body.userId]);
    await c.query('INSERT INTO lab_audit(actor,action) VALUES($1,$2)',[user.id,'account_authorization:'+body.userId+':'+body.role+':'+body.active]);return {ok:true};
   });
  }
  throw fail(404,'Operação de conta indisponível.');
 }
 async function bootstrap(body){
  const login=email(body.email);if(typeof body.token!=='string'||body.token.length!==64)throw fail(403,'Provisionamento recusado.');
  return transaction(pool,async c=>{
   const row=(await c.query('SELECT * FROM identity_bootstrap WHERE singleton FOR UPDATE')).rows[0];if(!row||row.consumed_at||new Date(row.expires_at)<=new Date()||!timingSafeEqual(Buffer.from(row.token_hash,'hex'),Buffer.from(digest(body.token),'hex')))throw fail(403,'Provisionamento recusado.');
   const target=(await c.query('SELECT u.id,a.verified_at FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.login=$1 FOR UPDATE OF u,a',[login])).rows[0];if(!target?.verified_at)throw fail(409,'Confirme o e-mail primeiro.');
   if((await c.query("SELECT 1 FROM identity_accounts a JOIN lab_users u ON u.id=a.user_id WHERE u.role='admin' AND u.active")).rowCount)throw fail(409,'Administrador já provisionado.');
   await c.query("UPDATE lab_users SET role='admin',active=true WHERE id=$1",[target.id]);await c.query('UPDATE identity_accounts SET approved_at=now(),approved_by=$1 WHERE user_id=$1',[target.id]);await c.query('UPDATE identity_bootstrap SET consumed_at=now() WHERE singleton');await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'initial_admin_provisioned_once')",[target.id]);return {ok:true};
  });
 }
 return {route,bootstrap,throttle,hashPassword:identityPassword,verifyPassword:identityVerify,
 async publicUser(id){return (await pool.query('SELECT u.id,u.role,u.login email,a.full_name FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.id=$1',[id])).rows[0];},
 async allowed(id){return Boolean((await pool.query('SELECT 1 FROM identity_accounts a JOIN lab_users u ON u.id=a.user_id WHERE a.user_id=$1 AND verified_at IS NOT NULL AND approved_at IS NOT NULL AND revoked_at IS NULL AND u.active',[id])).rowCount);}};
}
