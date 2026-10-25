import {BrowserWindow,ipcMain} from 'electron';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {webPreferences} from './policy.mjs';
export async function prepareIndividualAdmin(pool,here,root){
 const {installation,unseal}=await import(pathToFileURL(path.join(root,'server/d1-lab/environment.mjs')));
 const {createIdentity,identityPassword}=await import(pathToFileURL(path.join(root,'server/d1-lab/identity.mjs')));
 if(!['windows-candidate-20261021','windows-layout-20261021','windows-operational'].includes(installation?.id))throw Error('INDIVIDUAL_ADMIN_INSTALLATION_REFUSED');
 const hasAdmin=async()=>Boolean((await pool.query("SELECT 1 FROM lab_users u JOIN identity_accounts a ON a.user_id=u.id WHERE u.active AND u.role='admin' AND a.approved_at IS NOT NULL AND a.verified_at IS NOT NULL AND a.revoked_at IS NULL")).rowCount);
 if(await hasAdmin())return;
 const c=await unseal('first-admin.dpapi'),service=await unseal('identity-service.dpapi');
 if(c.purpose!=='RUY_EXPLICIT_FIRST_ADMIN'||c.installationId!==installation.id||service.installationId!==installation.id)throw Error('EXPLICIT_ADMIN_CONFIGURATION_REQUIRED');
 const identity=createIdentity({pool,pepper:Buffer.from(service.pepper,'base64'),sender:async()=>{throw Error('NO_EMAIL_FROM_ADMIN_SETUP');}});
 const setup=new BrowserWindow({title:'Sistema Ruy — autorização administrativa',width:720,height:800,show:true,webPreferences:{...webPreferences,preload:path.join(here,'individual-admin-preload.cjs')}});
 const url=pathToFileURL(path.join(here,'individual-admin.html')).href;let completed=false,busy=false,finish;
 const ready=new Promise((resolve,reject)=>{finish=resolve;setup.once('closed',()=>{if(!completed)reject(Error('ADMIN_AUTHORIZATION_CANCELLED'));});});
 const authorize=event=>event.sender===setup.webContents&&event.senderFrame===setup.webContents.mainFrame&&event.senderFrame.url===url;
 setup.webContents.setWindowOpenHandler(()=>({action:'deny'}));setup.webContents.on('will-navigate',event=>event.preventDefault());setup.webContents.session.setPermissionRequestHandler((_w,_p,done)=>done(false));
 ipcMain.handle('ruy-admin-details',event=>{if(!authorize(event))throw Error('Unauthorized frame');return {email:c.email};});
 ipcMain.handle('ruy-admin-provision',async(event,body)=>{
  if(!authorize(event)||busy||body?.consent!==true)return {ok:false,error:'Autorização explícita obrigatória.'};busy=true;
  try{
   if(await hasAdmin())throw Error('ADMIN_ALREADY_EXISTS');
   const hash=await identityPassword(body.password);
   const changed=await pool.query("UPDATE lab_users u SET password_hash=$2 FROM identity_accounts a WHERE u.id=a.user_id AND u.id=$1 AND u.login=$3 AND NOT u.active AND a.verified_at IS NOT NULL AND a.approved_at IS NULL AND a.revoked_at IS NULL RETURNING u.id",[c.userId,hash,c.email]);
   if(changed.rowCount!==1)throw Error('VERIFIED_PENDING_ACCOUNT_REQUIRED');
   await identity.bootstrap({email:c.email,token:c.token});completed=true;setTimeout(()=>{setup.close();finish();},150);return {ok:true};
  }catch{return {ok:false,error:'Autorização não concluída. Confira a senha individual e a validade do provisionamento; nenhum segredo foi registrado.'};}finally{busy=false;}
 });
 try{await setup.loadURL(url);await ready;}finally{ipcMain.removeHandler('ruy-admin-details');ipcMain.removeHandler('ruy-admin-provision');}
}
