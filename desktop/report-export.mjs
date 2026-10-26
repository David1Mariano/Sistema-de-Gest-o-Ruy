import path from 'node:path';
import fs from 'node:fs/promises';
import {reportHTML} from './report-html.mjs';
const userError=message=>Object.assign(new Error(message),{safeReportError:true});
export async function safeReportDestination(file,protectedRoots){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.pdf'||/[<>:"|?*]/.test(path.basename(file))||[...path.basename(file)].some(c=>c.charCodeAt(0)<32)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(path.basename(file)))throw userError('Escolha um nome válido com extensão .pdf.');
 const parent=await fs.realpath(path.dirname(file)),destination=path.join(parent,path.basename(file));
 for(const root of protectedRoots.filter(Boolean)){
  let resolved;try{resolved=await fs.realpath(root);}catch{resolved=path.resolve(root);}
  const relative=path.relative(resolved.toLowerCase(),destination.toLowerCase());
  if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw userError('Escolha uma pasta de documentos fora dos diretórios internos do sistema.');
 }
 return destination;
}
export function installReportExport({ipcMain,BrowserWindow,dialog,app,window,origin,protectedRoots=[]}){
 let busy=false;
 ipcMain.handle('ruy:report:save',async(event,input)=>{
  if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||new URL(event.senderFrame.url).origin!==origin)return {error:'Origem não autorizada.'};
  if(busy)return {error:'Aguarde a exportação em andamento.'};busy=true;let printWindow;
  try{
   if(!input||!['categories','employees'].includes(input.kind)||JSON.stringify(input).length>4e6)throw userError('Relatório inválido.');
   const filters=input.filters||{};
   const url=origin+'/api/d1/reports/'+input.kind+'?'+new URLSearchParams(filters);
   const authorize=async()=>{
    const response=await event.sender.session.fetch(url,{credentials:'include',cache:'no-store'});
    if(!response.ok)throw userError(response.status===401?'Entre novamente para exportar.':response.status===403?'Você não tem permissão para exportar este relatório.':'Não foi possível consultar os dados do relatório.');
    return response.json();
   };
   const report=await authorize();
   if(JSON.stringify(report.rows)!==JSON.stringify(input.expectedRows))throw userError('A listagem foi atualizada. Atualize a tela e tente exportar novamente.');
   const date=new Date().toLocaleDateString('pt-BR').replaceAll('/','-');
   const selected=await dialog.showSaveDialog(window,{title:'Salvar relatório PDF',defaultPath:path.join(app.getPath('documents'),`Ruy_${input.kind==='categories'?'Gastos_por_Categoria':'Colaboradores'}_${date}.pdf`),filters:[{name:'Documento PDF',extensions:['pdf']}],properties:['showOverwriteConfirmation']});
   if(selected.canceled||!selected.filePath)return {cancelled:true};
   const target=await safeReportDestination(selected.filePath,[app.getPath('userData'),app.getAppPath(),process.env.LOCALAPPDATA,process.env.APPDATA,process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.SystemRoot,...protectedRoots]);
   const fresh=await authorize();
   if(JSON.stringify(fresh.rows)!==JSON.stringify(report.rows))throw userError('Dados alterados durante a exportação. Atualize a tela e tente novamente.');
   printWindow=new BrowserWindow({show:false,webPreferences:{partition:'ruy-report-'+Date.now(),sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
   printWindow.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','file://*/*']},(_details,callback)=>callback({cancel:true}));
   printWindow.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
   printWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(reportHTML(report)));
   const bytes=await printWindow.webContents.printToPDF({pageSize:'A4',landscape:report.kind==='employees',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;text-align:center;color:#555">Sistema Ruy — Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',margins:{top:0.63,bottom:0.71,left:0.47,right:0.47}});
   if(bytes.subarray(0,5).toString()!=='%PDF-')throw userError('Não foi possível gerar um PDF válido.');
   if(JSON.stringify((await authorize()).rows)!==JSON.stringify(report.rows))throw userError('Dados alterados durante a exportação. Atualize a tela e tente novamente.');
   // Exclusive create protects existing files/symlinks, including concurrent changes.
   const handle=await fs.open(target,'wx',0o600);
   try{await handle.writeFile(bytes);await handle.sync();}catch(error){await handle.close();await fs.unlink(target).catch(()=>{});throw error;}
   await handle.close();return {saved:true,name:path.basename(target)};
  }catch(error){return {error:error.code==='EEXIST'?'O arquivo já existe. Escolha outro nome para preservar o original.':error.code==='EACCES'?'Sem permissão de gravação na pasta escolhida.':error.code?'Não foi possível salvar o PDF. Escolha outra pasta.':error.safeReportError?error.message:'Não foi possível gerar ou salvar o PDF. Tente novamente.'};}
  finally{if(printWindow&&!printWindow.isDestroyed())printWindow.destroy();busy=false;}
 });
}
