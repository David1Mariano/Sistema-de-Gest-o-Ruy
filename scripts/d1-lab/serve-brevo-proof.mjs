// Authorized single-recipient REAL delivery proof, not operational activation.
// No code, key, password or recipient is printed. Confirmation is in the local UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {installation,config,unseal,seal,home,powershell,validateHome} from '../../server/d1-lab/environment.mjs';
import {ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
import {createIdentity} from '../../server/d1-lab/identity.mjs';
import {brevoSender} from '../../server/d1-lab/brevo-mail.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
if(installation?.id!=='final-dev-20261021'||process.env.RUY_BREVO_REAL_PROOF!=='1')throw Error('EXPLICIT_SINGLE_RECIPIENT_PROOF_REQUIRED');
await validateHome();const settings=await unseal('brevo-candidate.dpapi');
if(settings.purpose!=='RUY_BREVO_IDENTITY_DEV'||settings.installationId!==installation.id)throw Error('BREVO_CANDIDATE_REFUSED');
await ensureLocalDatabase();const suffix=randomBytes(8).toString('hex'),database='ruy_d1_rc_'+suffix,root=path.join(home,'brevo-proof-'+suffix);await fs.mkdir(root);
const ownerConfig=await config(true),ctl=new pg.Client(ownerConfig);await ctl.connect();try{await ctl.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await ctl.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');await ctl.query('GRANT CONNECT ON DATABASE '+database+' TO ruy_d1_app');}finally{await ctl.end();}
const owner=new pg.Client({...ownerConfig,database});await owner.connect();try{
 await owner.query('BEGIN');for(const name of ['schema','identity'])await owner.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
 await owner.query('GRANT USAGE ON SCHEMA public TO ruy_d1_app;GRANT SELECT,INSERT,UPDATE,DELETE ON lab_users,lab_sessions,lab_attempts TO ruy_d1_app;GRANT SELECT,INSERT ON lab_audit TO ruy_d1_app;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ruy_d1_app');await owner.query('COMMIT');
}finally{await owner.end();}
const pool=new pg.Pool({...await config(),database}),pepper=randomBytes(32),password=randomBytes(32).toString('hex');
await fs.writeFile(path.join(root,'context.dpapi'),powershell('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify({purpose:'RUY_BREVO_REAL_PROOF',database,pepper:pepper.toString('base64'),password,recipient:settings.recipient})),{flag:'wx'});
let accepted=false,providerStatus=null,transportCode=null,timer,closed=false,sendAttempts=0,proofCode=null,checking=false;const provider=brevoSender(settings);const send=async message=>{
 if(message.to!==settings.recipient||message.purpose!=='verify')throw Error('BREVO_PROOF_RECIPIENT_REFUSED');
 if(sendAttempts!==0)throw Error('BREVO_SINGLE_SEND_LIMIT');
 sendAttempts++;proofCode=message.code;
 const result=await provider(message);providerStatus=201;return result;
};
const proofSender=async message=>{try{const result=await send(message);accepted=result.accepted===true;return result;}catch(e){providerStatus=e.providerStatus||null;throw e;}};proofSender.accepts=email=>email===settings.recipient;
const identity=createIdentity({pool,pepper,sender:proofSender});
const server=createServer(pool,'email-proof-'+randomUUID(),{identity});
async function finish(result){if(closed)return;closed=true;clearInterval(timer);if(!result.passed)process.exitCode=1;await fs.writeFile(path.join(root,'result.json'),JSON.stringify({purpose:'RUY_BREVO_REAL_PROOF',...result,database,providerAccepted:accepted,providerStatus,transportCode,installedApplicationsTouched:false},null,2),{flag:'wx'});await new Promise(resolve=>server.close(resolve));await pool.end();console.log(JSON.stringify(result));}
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18133,'127.0.0.1',resolve);});
const response=await fetch(origin+'/api/d1/account/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Homologação de e-mail autorizada',email:settings.recipient,password})});
if(response.status!==200||!accepted){await finish({passed:false,submissionStatus:response.status,realDeliveryConfirmed:false,reason:'PROVIDER_ACCEPTANCE_NOT_CONFIRMED'});}
else{
 console.log(JSON.stringify({providerAccepted:true,realDeliveryConfirmed:false,confirmationUrl:origin+'/',action:'Use Confirmar e-mail in the local page. Do not send the code in chat.'}));const started=Date.now();
 timer=setInterval(async()=>{if(closed||checking)return;checking=true;try{
  const row=(await pool.query('SELECT verified_at,approved_at FROM identity_accounts a JOIN lab_users u ON u.id=a.user_id WHERE u.login=$1',[settings.recipient])).rows[0];
  if(row?.verified_at){
   let replayStatus=null;
   try{await identity.route(new URL(origin+'/api/d1/account/verify'),{email:settings.recipient,code:proofCode},'proof-replay');}catch(e){replayStatus=e.status;}
   proofCode=null;
   if(replayStatus!==400)throw Error('CODE_REUSE_NOT_REFUSED');
   try{await seal('brevo-confirmed.dpapi',{...settings,deliveryConfirmed:true,confirmedAt:new Date().toISOString()});}catch(e){if(e.code!=='EEXIST')throw e;}
   await finish({passed:true,realDeliveryConfirmed:true,codeConfirmedOnServer:true,codeReuseRefused:true,replayStatus,sendAttempts,accountApproved:Boolean(row.approved_at),proofRestrictedToAuthorizedRecipient:true});
  }else if(Date.now()-started>10*60*1000)await finish({passed:false,realDeliveryConfirmed:false,reason:'CODE_CONFIRMATION_WINDOW_EXPIRED'});
 }catch{await finish({passed:false,realDeliveryConfirmed:false,reason:'LOCAL_PROOF_CHECK_FAILED'});}finally{checking=false;}},1000);
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>finish({passed:false,realDeliveryConfirmed:false,reason:'NORMAL_OPERATOR_SHUTDOWN'}));
