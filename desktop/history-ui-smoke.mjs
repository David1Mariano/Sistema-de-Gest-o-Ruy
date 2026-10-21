// Opt-in acceptance in development Electron only; never an installed entry point.
import {app,BrowserWindow} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {webPreferences,allowedNavigation,allowedDownload,localOrigin} from './policy.mjs';
import {powershell,installation} from '../server/d1-lab/environment.mjs';
async function run(){
assert.equal(process.env.RUY_HISTORY_ACCEPTANCE,'1');assert.equal(installation?.id,'history-view-dev-20261020');assert.equal(app.isPackaged,false);
const profile=process.env.RUY_HISTORY_PROFILE_ID;assert.ok(/^history-[a-z0-9-]{8,80}$/.test(profile||''));
const root=path.join(process.env.LOCALAPPDATA,'GestaoRuy','history-view-profiles',profile),work=path.join(root,'ui-'+randomUUID());await fs.mkdir(work);app.setPath('userData',work);
const c=JSON.parse(powershell("$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}",await fs.readFile(path.join(root,'acceptance.dpapi'),'utf8')));
let w;let blockedOperationalCalls=0,historyWrites=0;let stage='ready';const deadline=setTimeout(()=>{fs.writeFile(path.join(work,'failure.json'),JSON.stringify({passed:false,stage,reason:'UI_DEADLINE'})).finally(()=>{if(w&&!w.isDestroyed())w.close();app.quit();});},180000);
const mark=async value=>{stage=value;console.log('HISTORY_UI_STAGE '+stage);await fs.writeFile(path.join(work,'progress.json'),JSON.stringify({stage}));};
try{
 await mark('creating-window');await app.whenReady();w=new BrowserWindow({width:1200,height:850,show:true,webPreferences});w.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 w.webContents.on('will-navigate',(e,url)=>{if(!allowedNavigation(url))e.preventDefault();});
 w.webContents.session.webRequest.onBeforeRequest((details,callback)=>{const u=new URL(details.url);if(u.origin!==localOrigin){callback({cancel:true});return;}if(u.pathname.startsWith('/api/d1/')&&!['/api/d1/login','/api/d1/me','/api/d1/account/config'].includes(u.pathname)&&!u.pathname.startsWith('/api/d1/history/'))blockedOperationalCalls++;if(u.pathname.startsWith('/api/d1/history/')&&details.method!=='GET')historyWrites++;callback({});});
 const js=code=>w.webContents.executeJavaScript(code);
 const wait=async code=>{for(let n=0;n<250;n++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('HISTORY_UI_TIMEOUT');};
 const input=async(label,value)=>js(`(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 const choose=async(entity,total)=>{await input('Estado histórico','');await input('Pesquisa histórica','');await input('Entidade histórica',entity);await wait(`document.querySelector('[aria-label="Quantidade histórica"]')?.textContent===${JSON.stringify(total+' registro(s) nesta consulta')}`);};
 const consult=async()=>{await js("[...document.querySelectorAll('button')].find(b=>b.textContent==='Consultar').click()");await wait('!!document.querySelector("[aria-label=\\"Registro histórico consultado\\"] pre")');};
 await mark('loading');await w.loadURL(localOrigin+'/');await wait('!!document.querySelector("input[name=login]")');
 await js(`document.querySelector('input[name=login]').value=${JSON.stringify(c.accounts.authorized.login)};document.querySelector('input[name=password]').value=${JSON.stringify(c.accounts.authorized.password)};document.querySelector('form').requestSubmit();`);
 await wait("document.querySelector('h1')?.textContent==='Histórico Recuperado — Supabase'");await wait('!!document.querySelector("select[aria-label=\\"Entidade histórica\\"]")');
 await mark('employee-query');await choose('Employee',63);await consult();assert.equal(await js('document.querySelectorAll("article dl dt").length>0'),true);assert.equal(await js("!!document.querySelector('[aria-label=\"Registro histórico consultado\"] pre').textContent"),true);
 await input('Pesquisa histórica','no-match-'+randomUUID());await wait("document.querySelector('[aria-label=\"Quantidade histórica\"]')?.textContent==='0 registro(s) nesta consulta'");
 await choose('EmployeePayment',134);await input('Estado histórico','cancelado');await wait("document.querySelector('[aria-label=\"Quantidade histórica\"]')?.textContent==='1 registro(s) nesta consulta'");await consult();assert.equal(await js("document.querySelector('[role=note]')?.textContent.includes('Inconsistência histórica preservada')"),true);
 await choose('FinancialExpense',168);await js("document.querySelector('summary').click()");assert.equal(await js("document.querySelector('details')?.open"),true);
 await mark('attachment-query');const linked=await js(`(async()=>{for(let offset=0;offset<134;offset+=30){const page=await (await fetch('/api/d1/history/records?entity=EmployeePayment&offset='+offset)).json();for(const r of page.records){const detail=await (await fetch('/api/d1/history/records/'+r.id)).json();if(detail.attachments.length)return {legacyId:r.legacy_id,sha256:detail.attachments[0].sha256};}}throw Error('HISTORY_UI_NO_AUTHORIZED_ATTACHMENT');})()`);
 await choose('EmployeePayment',134);await input('Pesquisa histórica',linked.legacyId);await wait("document.querySelector('[aria-label=\"Quantidade histórica\"]')?.textContent==='1 registro(s) nesta consulta'");await consult();
 const file=path.join(work,'authorized-download.bin');
 const downloaded=new Promise((resolve,reject)=>{w.webContents.session.once('will-download',(_event,item)=>{if(!allowedDownload(item.getURL())){item.cancel();reject(Error('HISTORY_DOWNLOAD_POLICY'));return;}item.setSavePath(file);item.once('done',(_event,state)=>state==='completed'?resolve():reject(Error('HISTORY_DOWNLOAD_FAILED')));});});
 await js("document.querySelector('[aria-label=\"Registro histórico consultado\"] a').click()");await Promise.race([downloaded,new Promise((_,reject)=>setTimeout(()=>reject(Error('DOWNLOAD_TIMEOUT')),15000))]);
 await mark('download-verification');assert.ok(createHash('sha256').update(await fs.readFile(file)).digest('hex')===linked.sha256,'HISTORY_UI_ATTACHMENT_INTEGRITY');
 assert.equal(await js("[...document.querySelectorAll('button')].some(b=>['Salvar','Editar','Excluir','Pagar','Estornar','Movimentar'].includes(b.textContent.trim()))"),false);
 await mark('reload');w.reload();await wait("document.querySelector('h1')?.textContent==='Histórico Recuperado — Supabase'");
 await mark('no-operational-calls');assert.equal(blockedOperationalCalls,0);assert.equal(historyWrites,0);
 await fs.writeFile(path.join(root,'ui-acceptance-'+Date.now()+'.json'),JSON.stringify({passed:true,electronDevelopment:true,packaged:false,installedR4Touched:false,syntheticLogin:true,realHistoricalSource:true,employeeQuery:true,searchAndStatus:true,cancelledPaymentFlag:true,originalTotalsDisplayed:true,authorizedAttachmentSha256:true,noMutationButtons:true,reloadSession:true,operationalApiCalls:0,historicalWrites:0},null,2),{flag:'wx'});
 clearTimeout(deadline);await mark('passed');w.close();app.quit();
}catch(e){console.log('HISTORY_UI_FAILURE '+stage+' '+e.name);clearTimeout(deadline);await fs.writeFile(path.join(work,'failure.json'),JSON.stringify({passed:false,stage,reason:'UI_ACCEPTANCE_FAILED'}));process.exitCode=1;if(w&&!w.isDestroyed())w.close();app.quit();}

}
run().catch(()=>{process.exitCode=1;app.quit();});
