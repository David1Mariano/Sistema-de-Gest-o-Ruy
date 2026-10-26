// Own application test, synthetic session only. No installed profile is used.
import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {home,installation,unseal} from '../server/d1-lab/environment.mjs';
import {installReportExport} from './report-export.mjs';
import {webPreferences} from './policy.mjs';
async function run(){
 assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_REPORT_ACCEPTANCE,'1');
 const name=process.env.RUY_REPORT_UI_CONTEXT;assert.match(name||'',/^report-ui-[a-f0-9]{16}\.dpapi$/);const c=await unseal(name);assert.equal(c.purpose,'SYNTHETIC_REPORT_UI');assert.ok(c.expires>Date.now());
 const root=path.join(home,name.slice(0,-6));await fs.mkdir(root,{recursive:true});app.setPath('userData',path.join(root,'profile'));
 let w;const write=data=>fs.writeFile(path.join(root,'result.json'),JSON.stringify(data));const deadline=setTimeout(()=>write({passed:false,stage:'deadline'}).finally(()=>{w?.close();app.quit();}),90000);
 try{
  await app.whenReady();w=new BrowserWindow({show:true,width:1366,height:900,webPreferences:{...webPreferences,preload:path.resolve('desktop/report-preload.cjs')}});
  const output=path.resolve('artifacts/pdf-ui-'+Date.now());await fs.mkdir(output,{recursive:true});let choices=0;
  installReportExport({ipcMain,BrowserWindow,app,window:w,origin:'http://127.0.0.1:18133',dialog:{showSaveDialog:async()=>{choices++;return choices===1?{canceled:true}:{filePath:path.join(output,choices===2?'employees.pdf':'categories.pdf')};}}});
  await w.webContents.session.cookies.set({url:'http://127.0.0.1:18133/api/d1',name:'ruy_d1_lab',value:c.cookie,path:'/api/d1',httpOnly:true,sameSite:'strict'});
  const js=code=>w.webContents.executeJavaScript(code),wait=async code=>{for(let n=0;n<200;n++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('REPORT_UI_TIMEOUT');};
  await w.loadURL('http://127.0.0.1:18133/funcionarios');await wait("Array.from(document.querySelectorAll('main button')).some(b=>b.textContent==='Exportar colaboradores em PDF'&&!b.disabled)");
  const employee="Array.from(document.querySelectorAll('main button')).find(b=>b.textContent==='Exportar colaboradores em PDF').click()";
  await js(employee);await wait("document.querySelector('main').textContent.includes('Exportação cancelada.')");await js(employee);await wait("document.querySelector('main').textContent.includes('PDF salvo com sucesso.')");
  await js("history.pushState({},'','/financeiro');dispatchEvent(new PopStateEvent('popstate'))");await wait("Array.from(document.querySelectorAll('main button')).some(b=>b.textContent==='Exportar PDF'&&!b.disabled)");
  await js("Array.from(document.querySelectorAll('main button')).find(b=>b.textContent==='Exportar PDF').click()");await wait("document.querySelector('main').textContent.includes('PDF salvo com sucesso.')");
  assert.equal(choices,3);for(const kind of ['employees','categories'])assert.equal((await fs.readFile(path.join(output,kind+'.pdf'))).subarray(0,5).toString(),'%PDF-');
  await write({passed:true,synthetic:true,realReactButtons:true,realSession:true,realIPC:true,realBackend:true,pdfFiles:2,cancellation:true,nativeDialogTested:false,packaged:false,installed:false});
 }catch(error){await write({passed:false,code:error.code||error.message});}finally{clearTimeout(deadline);w?.close();app.quit();}
}
run().catch(()=>app.quit());
