// Real isolated PostgreSQL + HTTP; mailbox transport explicitly simulated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {initializeLab,ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {installation,config,home,powershell} from '../../server/d1-lab/environment.mjs';
import {pg,digest} from '../../server/d1-lab/core.mjs';
import {createIdentity,identityPassword,identityVerify} from '../../server/d1-lab/identity.mjs';
import {gmailSender} from '../../server/d1-lab/gmail-mail.mjs';
import {resendSender} from '../../server/d1-lab/identity-mail.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_IDENTITY_ACCEPTANCE,'1');
try{await fs.access(home);}catch{await initializeLab();}
await ensureLocalDatabase();
const baseOwner=await config(true),trialDatabase='ruy_d1_rc_'+randomBytes(8).toString('hex');
const control=new pg.Client(baseOwner);await control.connect();await control.query('CREATE DATABASE '+trialDatabase+' OWNER ruy_d1_owner');await control.end();
const owner=new pg.Pool({...baseOwner,database:trialDatabase});
await owner.query('BEGIN');for(const name of ['schema','entities','catalog','sync','operations','domain','attachments','business','delivery','identity'])await owner.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
await owner.query('INSERT INTO lab_device(id) VALUES($1)',[randomUUID()]);await owner.query('GRANT USAGE ON SCHEMA public TO ruy_d1_app;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ruy_d1_app;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ruy_d1_app;REVOKE INSERT,DELETE ON identity_bootstrap FROM ruy_d1_app;REVOKE UPDATE,DELETE ON lab_audit FROM ruy_d1_app');await owner.query('COMMIT');
const pool=new pg.Pool({...await config(),database:trialDatabase});
const mailbox=new Map(),results=[];let server;
const password=randomBytes(24).toString('hex'),nextPassword=randomBytes(24).toString('hex'),suffix=randomUUID();
const admin='admin-'+suffix+'@example.invalid',member='member-'+suffix+'@example.invalid';
let uiRoot;
const sealFile=async(file,value)=>fs.writeFile(file,powershell('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify(value)),{flag:'wx'});
const sender=async message=>{mailbox.set(message.to+'|'+message.purpose,message.code);if(uiRoot&&message.to.startsWith('ui-'))await sealFile(path.join(uiRoot,'mail.dpapi'),message);};
const identity=createIdentity({pool,sender,pepper:randomBytes(32)});
const check=async(name,fn)=>{await fn();results.push({name,passed:true});console.log('PASS '+name);};
const call=async(route,body,cookie,csrf)=>{const r=await fetch(origin+'/api/d1'+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
let a,m;
try{
 const device=(await pool.query('SELECT id FROM lab_device')).rows[0].id;server=createServer(pool,device,{identity});await new Promise(r=>server.listen(installation.apiPort,'127.0.0.1',r));
 await check('scrypt-v2 unique salts and rejection',async()=>{const h=await identityPassword(password);assert.ok(h.startsWith('scrypt-v2:'));assert.notEqual(h,await identityPassword(password));assert.equal(await identityVerify(password,h),true);assert.equal(await identityVerify('wrong',h),false);});
 await check('registration ignores injected admin approval',async()=>{const r=await call('/account/register',{email:admin,name:'Administrador sintético',password,role:'admin',active:true});assert.equal(r.status,200);assert.equal('code' in r.data,false);const row=(await owner.query('SELECT role,active FROM lab_users WHERE login=$1',[admin])).rows[0];assert.deepEqual(row,{role:'viewer',active:false});});
 await check('pending login and protected data denied',async()=>{assert.equal((await call('/login',{login:admin,password})).status,401);assert.equal((await call('/entities/Employee')).status,401);});
 await check('incorrect code persists attempt counter',async()=>{const good=mailbox.get(admin+'|verify'),bad=good==='000000'?'111111':'000000';assert.equal((await call('/account/verify',{email:admin,code:bad})).status,400);assert.equal((await owner.query("SELECT attempts FROM identity_codes k JOIN lab_users u ON u.id=k.user_id WHERE login=$1 AND purpose='verify'",[admin])).rows[0].attempts,1);});
 await check('verification consumes code without auto approval',async()=>{const code=mailbox.get(admin+'|verify');assert.equal((await call('/account/verify',{email:admin,code})).status,200);assert.equal((await call('/account/verify',{email:admin,code})).status,400);assert.equal((await call('/login',{login:admin,password})).status,401);});
 const token=randomBytes(32).toString('hex');
 // The bootstrap token is generated locally by provisioning, never returned by HTTP.
 await owner.query("INSERT INTO identity_bootstrap(token_hash,expires_at) VALUES($1,now()+interval '10 minutes') ON CONFLICT(singleton) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,consumed_at=NULL",[digest(token)]);
 await check('controlled administrator bootstrap consumed once',async()=>{assert.equal((await call('/account/bootstrap',{email:admin,token:'0'.repeat(64)})).status,403);assert.equal((await call('/account/bootstrap',{email:admin,token})).status,200);assert.equal((await call('/account/bootstrap',{email:admin,token})).status,403);});
 await check('individual login HttpOnly session and CSRF',async()=>{a=await call('/login',{login:admin,password});assert.equal(a.status,200);assert.equal(a.data.user.role,'admin');assert.ok(a.cookie);assert.equal((await call('/account/users',undefined,a.cookie)).status,200);assert.equal((await call('/account/authorize',{userId:a.data.user.id,role:'admin',active:true},a.cookie)).status,403);});
 await check('resend cooldown enforced by server',async()=>{assert.equal((await call('/account/register',{email:member,name:'Leitor sintético',password})).status,200);assert.equal((await call('/account/resend',{email:member})).status,429);});
 await check('administrator cannot approve unverified account',async()=>{const id=(await owner.query('SELECT id FROM lab_users WHERE login=$1',[member])).rows[0].id;assert.equal((await call('/account/authorize',{userId:id,role:'viewer',active:true},a.cookie,a.data.csrf)).status,409);});
 await check('verified member approved explicitly and stays viewer',async()=>{assert.equal((await call('/account/verify',{email:member,code:mailbox.get(member+'|verify')})).status,200);const id=(await owner.query('SELECT id FROM lab_users WHERE login=$1',[member])).rows[0].id;assert.equal((await call('/account/authorize',{userId:id,role:'viewer',active:true},a.cookie,a.data.csrf)).status,200);m=await call('/login',{login:member,password});assert.equal(m.status,200);assert.equal(m.data.user.role,'viewer');});
 await check('viewer cannot list users or self elevate',async()=>{assert.equal((await call('/account/users',undefined,m.cookie)).status,403);assert.equal((await call('/account/authorize',{userId:m.data.user.id,role:'admin',active:true},m.cookie,m.data.csrf)).status,403);});
 await check('password reset consumes code and revokes sessions',async()=>{assert.equal((await call('/account/reset-request',{email:member})).status,200);const code=mailbox.get(member+'|reset');assert.equal((await call('/account/reset',{email:member,code,password:nextPassword})).status,200);assert.equal((await call('/me',undefined,m.cookie)).status,401);assert.equal((await call('/login',{login:member,password})).status,401);assert.equal((await call('/account/reset',{email:member,code,password:nextPassword})).status,400);m=await call('/login',{login:member,password:nextPassword});assert.equal(m.status,200);});
 await check('password change validates old password and revokes sessions',async()=>{assert.equal((await call('/account/change-password',{currentPassword:'incorrect',password},m.cookie,m.data.csrf)).status,401);assert.equal((await call('/account/change-password',{currentPassword:nextPassword,password},m.cookie,m.data.csrf)).status,200);assert.equal((await call('/me',undefined,m.cookie)).status,401);m=await call('/login',{login:member,password});assert.equal(m.status,200);});
 await check('revocation immediate including existing session',async()=>{assert.equal((await call('/account/authorize',{userId:m.data.user.id,role:'viewer',active:false},a.cookie,a.data.csrf)).status,200);assert.equal((await call('/me',undefined,m.cookie)).status,401);assert.equal((await call('/login',{login:member,password})).status,401);});
 await check('mail failure has no code fallback',async()=>{const failed=createIdentity({pool,pepper:randomBytes(32),sender:async()=>{throw Error('simulated');}});await owner.query("UPDATE identity_codes SET sent_at=now()-interval '2 minutes' WHERE user_id=$1",[a.data.user.id]);await assert.rejects(()=>failed.route(new URL(origin+'/api/d1/account/resend'),{email:admin},'synthetic-failure'),e=>e.status===503);});
 await check('official mail adapter rejects redirect and sanitizes failure',async()=>{let called=false;const send=resendSender({apiKey:'synthetic-not-a-credential',from:'sender@example.invalid'},async(url,options)=>{called=true;assert.equal(url,'https://api.resend.com/emails');assert.equal(options.redirect,'error');assert.ok(options.headers['Idempotency-Key']);return {ok:false};});await assert.rejects(()=>send({to:admin,code:'123456',purpose:'verify',id:randomUUID()}),/MAIL_DELIVERY_NOT_CONFIRMED/);assert.equal(called,true);});
 await check('Gmail OAuth send-only adapter uses official endpoints and no fallback',async()=>{const calls=[];const send=gmailSender({from:'synthetic@gmail.com',clientId:'synthetic-client-id',clientSecret:'synthetic-client-secret',refreshToken:'synthetic-refresh-token'},async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');if(url.includes('/token'))return {ok:true,json:async()=>({access_token:'synthetic-access-token',expires_in:3600})};assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString('utf8');assert.ok(raw.includes('To: '+admin));return {ok:true};});await send({to:admin,code:'123456',purpose:'verify',id:randomUUID()});assert.equal(calls.length,2);await assert.rejects(()=>send({to:'bad\r\nInjected: bad',code:'123456',purpose:'verify',id:randomUUID()}),/REFUSED/);});
 await check('account authorization changes audited without secrets',async()=>{const actions=(await pool.query('SELECT action FROM lab_audit WHERE actor=$1',[a.data.user.id])).rows.map(r=>r.action);assert.ok(actions.some(v=>v.startsWith('account_authorization:')));assert.ok(actions.includes('initial_admin_provisioned_once'));assert.ok(!JSON.stringify(actions).includes(password));});
 await check('HTTP restart preserves session and grants',async()=>{await new Promise(r=>server.close(r));server=createServer(pool,device,{identity});await new Promise(r=>server.listen(installation.apiPort,'127.0.0.1',r));assert.equal((await call('/me',undefined,a.cookie)).status,200);});
 await check('logout invalidates the server session',async()=>{assert.equal((await call('/logout',{},a.cookie,a.data.csrf)).status,200);assert.equal((await call('/me',undefined,a.cookie)).status,401);});
 if(process.env.RUY_IDENTITY_ELECTRON_EXE)await check('development Electron registration verification login Dashboard and access UI',async()=>{
  uiRoot=path.join(home,'ui-test-'+randomUUID());await fs.mkdir(uiRoot);await sealFile(path.join(uiRoot,'context.dpapi'),{purpose:'SYNTHETIC_IDENTITY_UI_TEST',admin,password,member:'ui-'+randomUUID()+'@example.invalid'});
  const env={...process.env,RUY_IDENTITY_UI_ROOT:uiRoot};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const p=spawn(process.env.RUY_IDENTITY_ELECTRON_EXE,['desktop/identity-ui-smoke.mjs'],{cwd:process.cwd(),windowsHide:true,env,stdio:'ignore'});p.once('error',reject);p.once('exit',resolve);});
  const proof=JSON.parse(await fs.readFile(path.join(uiRoot,'result.json'),'utf8'));assert.equal(proof.passed,true,'IDENTITY_UI_ACCEPTANCE_PROOF_REQUIRED');
 });
 await fs.writeFile(path.join(home,'identity-test-'+Date.now()+'.json'),JSON.stringify({checks:results,mailTransport:'SIMULATED',realEmailDelivery:'PENDING',realPostgreSQL:true,installedR4Touched:false},null,2),{flag:'wx'});
 console.log(JSON.stringify({passed:results.length,failed:0,realEmailDelivery:'PENDING',mailTransport:'SIMULATED'}));
}catch(e){console.error(JSON.stringify({passed:results.length,failed:1,errorCode:e.code||e.status||'ASSERTION_FAILED',stage:results.at(-1)?.name||'initialization'}));process.exitCode=1;}
finally{if(server?.listening)await new Promise(r=>server.close(r));await pool.end();await owner.end();}
