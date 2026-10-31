import {app,BrowserWindow,dialog,session,screen,ipcMain} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {centralEndpoint,clientCorrelation} from './central-endpoint.mjs';
import {revealWindow} from './window-visibility.mjs';
import {installReportExport} from './report-export.mjs';
import {isAuthorizedAttachmentDownload} from './download-policy.mjs';
import logger from './startup-log.cjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=app.isPackaged?app.getAppPath():path.resolve(here,'..');
app.setName('Sistema Ruy');app.setPath('userData',path.join(app.getPath('appData'),'SistemaGestaoRuy-shared-client'));app.setAppUserModelId('br.ruy.gestao.windows.operacional');
const testRoot=process.env.RUY_SHARED_CLIENT_TEST_ROOT;
if(testRoot){
 const base=path.join(process.env.LOCALAPPDATA,'GestaoRuy','installation-final-dev-20261021');
 if(process.env.RUY_SHARED_LAB!=='1'||path.dirname(testRoot)!==base||!/^shared-electron-test-[a-f0-9]{16}$/.test(path.basename(testRoot))||(await fs.realpath(testRoot)).toLowerCase()!==path.resolve(testRoot).toLowerCase())throw Error('TEST_PROFILE_REFUSED');
 app.setPath('userData',path.join(testRoot,'electron-profile'));
}
let window,facade,exitReady=false,closing=false;
const log=(event,error)=>logger.startupLog(app.getPath('userData'),'RUY-SHARED-CLIENT-'+app.getVersion(),event,'shared-client',error);
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{if(window)revealWindow(window,screen.getAllDisplays());});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(exitReady)return;event.preventDefault();if(closing)return;closing=true;void(async()=>{await facade?.close();exitReady=true;app.quit();})().catch(error=>{log('shutdown-blocked',error);closing=false;dialog.showErrorBox('Sistema Ruy','Não foi possível confirmar o encerramento. Nenhum processo externo será interrompido.');});});
 async function start(){
 await app.whenReady();log('startup-start');
 try{
  const data=testRoot||path.join(process.env.LOCALAPPDATA,'GestaoRuy','shared-client');
  {
   const {sendUserTLS}=await import(pathToFileURL(path.join(root,'server/sync-lab/user-transport.mjs')));
   const {createSharedClient}=await import(pathToFileURL(path.join(root,'server/d1-lab/shared-client.mjs')));
   const {createSharedFacade}=await import(pathToFileURL(path.join(root,'server/d1-lab/shared-facade.mjs')));
   let sessionOrigin=null;
   const client=createSharedClient({userSessionMode:true,clientId:await clientCorrelation(data),request:async(route,body,userSession,method)=>{
    let service;try{service=await centralEndpoint({testRoot,discoveryStateFile:path.join(data,'discovery-state.json'),discoveryRequest:url=>sendUserTLS({url,discoveryOnly:true})});}catch(error){throw Object.assign(Error(error.code==='CENTRAL_ADDRESS_PENDING'?error.message:'Não foi possível localizar a central com segurança. Tente novamente.'),{status:503});}
    if(userSession&&sessionOrigin!==service.endpoint)throw Object.assign(Error('O endereço da central foi atualizado. A operação não foi enviada; reconecte antes de continuar.'),{status:409,code:'CENTRAL_ENDPOINT_CHANGED'});
    if(route==='/session/login')sessionOrigin=service.endpoint;
    let response;try{response=await sendUserTLS({url:service.endpoint+'/api/local/d1'+route,clientRelease:app.getVersion(),ca:service.ca,userSession,method:method||(body?'POST':'GET'),body:body?JSON.stringify(body):undefined});}catch{throw Object.assign(Error('Não foi possível conectar à central por HTTPS. Verifique a conexão e tente novamente.'),{status:503});}
    if(response.status!==200){let message=response.status===403?'Sua conta não tem permissão para esta operação. A sessão permanece ativa.':'Não foi possível confirmar a operação na central.',code;try{const value=JSON.parse(response.body);if([400,403,409,413,422,503].includes(response.status)&&typeof value.error==='string'&&value.error.length<500)message=value.error;if(/^[A-Z_]{3,64}$/.test(value.code||''))code=value.code;}catch{/* Keep the sanitized fallback. */}throw Object.assign(Error(response.status===401?'E-mail ou senha inválidos, ou sessão expirada.':response.status===429?'Muitas tentativas. Aguarde antes de tentar novamente.':message),{status:response.status,code});}return JSON.parse(response.body);
   }});
   facade=createSharedFacade({client});await facade.listen();client.start();const origin='http://127.0.0.1:'+facade.server.address().port;
   const browser=session.defaultSession;
   browser.setPermissionRequestHandler((_c,_p,cb)=>cb(false));browser.setPermissionCheckHandler(()=>false);
   browser.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,cb)=>{let allowed=false;try{allowed=new URL(details.url).origin===origin;}catch{/* Malformed navigation is refused. */}cb({cancel:!allowed});});
   browser.on('will-download',(event,item,contents)=>{if(!window||contents!==window.webContents||!item.getURLChain().every(value=>isAuthorizedAttachmentDownload(value,origin)))event.preventDefault();});
   window=new BrowserWindow({title:'Sistema Ruy - Compartilhado',width:1366,height:900,minWidth:900,minHeight:640,show:false,icon:path.join(here,'assets/ruy.ico'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,preload:path.join(here,'report-preload.cjs'),session:browser}});
   installReportExport({ipcMain,BrowserWindow,dialog,app,window,origin,protectedRoots:[root,data]});
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   for(const event of ['will-navigate','will-redirect'])window.webContents.on(event,(e,url)=>{if(new URL(url).origin!==origin)e.preventDefault();});
   window.webContents.on('will-attach-webview',e=>e.preventDefault());
   window.on('close',event=>{if(!exitReady){event.preventDefault();app.quit();}});
   await window.loadURL(origin+'/');revealWindow(window,screen.getAllDisplays());log('window-visible');
   if(testRoot&&process.argv.includes('--consultation-client-smoke')){const {consultationClientSmoke}=await import('./consultation-acceptance.mjs');await consultationClientSmoke({window,profileRoot:data,app});app.quit();}
   if(testRoot&&process.argv.includes('--shared-client-smoke')){const {sharedClientSmoke}=await import('./shared-acceptance.mjs');await sharedClientSmoke({window,origin,profileRoot:data,app,screen});app.quit();}
  }
 }catch(error){log('startup-failed',error);if(testRoot)await fs.writeFile(path.join(testRoot,'acceptance-result.json'),JSON.stringify({passed:false,code:error.code||'SHARED_ACCEPTANCE_FAILED',message:error.message}));if(testRoot&&window){await fs.writeFile(path.join(testRoot,'failure-dom.txt'),await window.webContents.executeJavaScript('document.body.innerText').catch(()=>''));await window.webContents.capturePage().then(pic=>fs.writeFile(path.join(testRoot,'failure-window.png'),pic.toPNG())).catch(()=>{});}if(!testRoot)dialog.showErrorBox('Sistema Ruy — conexão bloqueada','Não foi possível iniciar a conexão central. Nenhum banco local ou instalação anterior foi alterado. Consulte o registro sanitizado.');app.quit();}
 }
 void start().catch(error=>{log('startup-failed',error);app.exit(1);});
}

