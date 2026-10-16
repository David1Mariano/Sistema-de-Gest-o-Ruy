import {BrowserWindow,ipcMain,dialog} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {webPreferences} from './policy.mjs';

export async function prepareFirstRun(root,here){
 const {initializeLab,validateAccount}=await import(pathToFileURL(path.join(root,'server/d1-lab/bootstrap.mjs')));
 let bin='C:/Program Files/PostgreSQL/17/bin',busy=false,completed=false;
 const setup=new BrowserWindow({title:'Sistema Ruy — preparar laboratório',width:680,height:800,autoHideMenuBar:true,webPreferences:{...webPreferences,preload:path.join(here,'setup-preload.cjs')}});
 const url=pathToFileURL(path.join(here,'setup.html')).href;
 const authorized=event=>event.sender===setup.webContents&&event.senderFrame===setup.webContents.mainFrame&&event.senderFrame.url===url;
 setup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 setup.webContents.on('will-navigate',event=>event.preventDefault());
 setup.webContents.session.setPermissionRequestHandler((_w,_p,done)=>done(false));
 setup.webContents.session.setPermissionCheckHandler(()=>false);
 let done;
 const ready=new Promise((resolve,reject)=>{done=resolve;setup.once('closed',()=>{if(!completed)reject(Error('Preparação cancelada; dados existentes preservados.'));});});
 ipcMain.handle('ruy-setup-pg',async event=>{
  if(!authorized(event)||busy)return null;
  const selected=await dialog.showOpenDialog(setup,{title:'Pasta bin do PostgreSQL 17',properties:['openDirectory']});
  if(!selected.canceled)bin=selected.filePaths[0];return bin;
 });
 ipcMain.handle('ruy-setup-create',async(event,account)=>{
  if(!authorized(event)||busy)return {ok:false,error:'Preparação indisponível.'};
  try{validateAccount(account);}catch(error){return {ok:false,error:error.message};}
  busy=true;
  try{await initializeLab({bin,account});completed=true;setTimeout(()=>{setup.close();done();},150);return {ok:true};}
  catch{return {ok:false,error:'Preparação falhou. Verifique PostgreSQL 17, portas 55436/18087 e o diretório privado. Uma preparação parcial foi preservada; não apague nem repita init sem diagnóstico.'};}
  finally{busy=false;}
 });
 await setup.loadURL(url);
 try{await ready;}finally{ipcMain.removeHandler('ruy-setup-pg');ipcMain.removeHandler('ruy-setup-create');}
}
