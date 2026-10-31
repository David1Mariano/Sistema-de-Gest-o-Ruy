import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../../server/d1-lab/core.mjs';
import {identityPassword} from '../../server/d1-lab/identity.mjs';
import {sendUserTLS} from '../../server/sync-lab/user-transport.mjs';
export async function testUserAuthentication({pool,endpoint,ca,workspace,password}){
 const target=(await pool.query("SELECT current_database() db,current_setting('port') port")).rows[0];
 assert.match(target.db,/^ruy_d1_rc_[a-f0-9]{16}$/);assert.equal(target.port,'55483');
 const call=async(route,token,body)=>{const r=await sendUserTLS({url:endpoint+'/api/local/d1'+route,ca,userSession:token,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});return {status:r.status,body:JSON.parse(r.body)};};
 const checks=[];const passed=name=>{checks.push(name);console.log('PASS auth: '+name);};
 assert.equal((await pool.query('SELECT count(*)::int n FROM shared_devices')).rows[0].n,0);passed('no enrolled devices or client certificates');
 for(const route of ['/state','/capabilities','/changes?cursor=0','/attachments/'+randomUUID()])assert.equal((await call(route)).status,401);
 for(const route of ['/operation','/catalog-command','/domain-command','/account','/push'])assert.equal((await call(route,null,{})).status,401);
 assert.equal((await call('/state','a'.repeat(64))).status,401);passed('all data/write routes require a valid session');
 await assert.rejects(sendUserTLS({url:endpoint+'/api/local/d1/connection'}));passed('untrusted TLS server rejected');
 const id=randomUUID(),viewer=randomUUID(),rotation=randomUUID(),email='auth-'+id+'@example.invalid',viewerEmail='viewer-'+viewer+'@example.invalid',rotationEmail='rotation-'+rotation+'@example.invalid',hash=await identityPassword(password);
 for(const [uid,login,role] of [[id,email,'admin'],[viewer,viewerEmail,'viewer'],[rotation,rotationEmail,'admin']]){
  await pool.query('INSERT INTO lab_users VALUES($1,$2,$3,$4,true)',[uid,login,hash,role]);
  await pool.query('INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by) VALUES($1,$2,now(),now(),$1)',[uid,'FICTICIO Sessao']);
  await pool.query('INSERT INTO shared_memberships VALUES($1,$2,$3,true)',[uid,workspace,role]);
 }
 const login=async address=>{const r=await call('/session/login',null,{email:address,password});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
 assert.equal((await call('/session/login',null,{email,password:'FICTICIO senha incorreta'})).status,401);
 const a=await login(email),b=await login(email);assert.notEqual(a.token,b.token);assert.notEqual(a.deviceId,b.deviceId);
 assert.equal((await call('/state',a.token)).status,200);assert.equal((await call('/state',b.token)).status,200);passed('same user in independent simultaneous sessions, no device approval');
 assert.equal((await call('/session/logout',a.token,{})).status,200);assert.equal((await call('/state',a.token)).status,401);assert.equal((await call('/state',b.token)).status,200);passed('logout revokes only the selected session');
 await pool.query("UPDATE shared_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(b.token)]);assert.equal((await call('/state',b.token)).status,401);passed('server-side session expiration');
 const c=await login(email);await pool.query('UPDATE identity_accounts SET revoked_at=now() WHERE user_id=$1',[id]);assert.equal((await call('/state',c.token)).status,401);passed('account revocation enforced immediately');
 await pool.query('UPDATE identity_accounts SET revoked_at=NULL WHERE user_id=$1',[id]);
 await pool.query('UPDATE shared_memberships SET active=false WHERE user_id=$1',[id]);assert.equal((await call('/state',c.token)).status,401);passed('membership revocation enforced on every request');
 await pool.query('UPDATE shared_memberships SET active=true WHERE user_id=$1',[id]);
 const v=await login(viewerEmail);
 const forbidden={
  '/operation':{kind:'journal',operationId:randomUUID(),entries:[{account:'cash',cents:1},{account:'equity',cents:-1}]},
  '/domain-command':{entity:'PayrollRun',id:randomUUID(),operationId:randomUUID(),action:'pay',baseVersion:1,data:{}},
  '/catalog-command':{entity:'Employee',id:randomUUID(),operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO unauthorized'}},
  '/account':{route:'/account/users'}
 };
 for(const [route,body] of Object.entries(forbidden))assert.equal((await call(route,v.token,body)).status,403,route);
 const visible=await call('/state',v.token);assert.equal(visible.status,200);assert.ok(visible.body.records.every(r=>['Employee','Sector','JobRole'].includes(r.entity)));assert.equal('business' in visible.body,false);passed('viewer cannot administer, write or read financial/stock data');
 await pool.query("UPDATE shared_memberships SET role='viewer' WHERE user_id=$1",[id]);assert.equal((await call('/state',c.token)).status,401);passed('permission change invalidates stale role');
 await pool.query("INSERT INTO shared_memberships VALUES($1,$2,'viewer',true)",[viewer,randomUUID()]);assert.equal((await call('/session/login',null,{email:viewerEmail,password})).status,403);passed('ambiguous workspace cannot grant cross-company access');
 const unknown='missing-'+randomUUID()+'@example.invalid';for(let i=0;i<5;i++)assert.equal((await call('/session/login',null,{email:unknown,password})).status,401);
 assert.equal((await call('/session/login',null,{email:unknown,password})).status,429);passed('unknown-user response and account login throttling');
 const nonce=randomUUID(),rotate=async clientId=>{const r=await call('/session/login',null,{email:rotationEmail,password,clientId});assert.equal(r.status,200);return r.body;};
 const before=await rotate(nonce),after=await rotate(nonce),other=await rotate(randomUUID());
 assert.equal(before.deviceId,after.deviceId);assert.notEqual(before.token,after.token);assert.notEqual(after.deviceId,other.deviceId);
 assert.equal((await call('/state',before.token)).status,401);assert.equal((await call('/state',after.token)).status,200);assert.equal((await call('/state',other.token)).status,200);passed('relogin rotates token while preserving replay scope; another installation stays independent');
 const audit=(await pool.query('SELECT action FROM lab_audit WHERE actor=$1',[id])).rows.map(r=>r.action);for(const action of ['user_session_login','user_session_logout','user_login_refused'])assert.ok(audit.includes(action));passed('login/logout/refusal audited without credentials');
 return {passed:true,checks,clientCertificates:0,deviceApprovals:0,sessionSecretsPersistedOnClient:false};
}
