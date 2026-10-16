import {BrowserWindow,ipcMain} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {webPreferences} from './policy.mjs';
export async function recoveryPrompt(parent,here,mode,job){
 const window=new BrowserWindow({parent,modal:true,width:620,height:640,autoHideMenuBar:true,webPreferences:{...webPreferences,preload:path.join(here,'recovery-preload.cjs')}});
 const url=pathToFileURL(path.join(here,'recovery.html'));url.searchParams.set('mode',mode);
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_w,_p,done)=>done(false));window.webContents.session.setPermissionCheckHandler(()=>false);
 let busy=false,completed=false,resolve,reject;
 const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
 window.once('closed',()=>{if(!completed)reject(Error('Recuperação cancelada.'));});
 ipcMain.handle('ruy-recovery-submit',async(event,phrase)=>{
  if(busy||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==url.href)return {ok:false,error:'Operação indisponível.'};
  busy=true;
  try{
   const result=await job(phrase);completed=true;
   setTimeout(()=>{if(!window.isDestroyed())window.close();resolve(result);},150);return {ok:true};
  }catch{return {ok:false,error:'Frase, arquivo ou destino inválido. Nenhum banco ativo foi substituído; verifique os arquivos selecionados.'};}
  finally{busy=false;}
 });
 try{await window.loadURL(url.href);return await ready;}finally{ipcMain.removeHandler('ruy-recovery-submit');}
}
