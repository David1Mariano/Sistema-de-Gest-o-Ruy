import {app,BrowserWindow} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {powershell,home,installation} from '../server/d1-lab/environment.mjs';
import {webPreferences,allowedNavigation} from './policy.mjs';
async function run(){
 assert.equal(app.isPackaged,false);assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_IDENTITY_ACCEPTANCE,'1');
 const root=process.env.RUY_IDENTITY_UI_ROOT;if(!root||path.dirname(root)!==home||!path.basename(root).startsWith('ui-test-'))throw Error('IDENTITY_UI_ROOT_REFUSED');
 const open=async file=>JSON.parse(powershell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}',await fs.readFile(path.join(root,file),'utf8')));
 const c=await open('context.dpapi');assert.equal(c.purpose,'SYNTHETIC_IDENTITY_UI_TEST');app.setPath('userData',path.join(root,'profile'));let w,stage='ready';
 const write=value=>fs.writeFile(path.join(root,'result.json'),JSON.stringify(value),{flag:'wx'});
 const deadline=setTimeout(()=>write({passed:false,stage,reason:'UI_DEADLINE'}).finally(()=>{w?.close();app.quit();}),120000);
 try{
  await app.whenReady();w=new BrowserWindow({width:1100,height:800,show:true,webPreferences});w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(e,url)=>{if(!allowedNavigation(url))e.preventDefault();});
  const js=code=>w.webContents.executeJavaScript(code),wait=async code=>{for(let n=0;n<200;n++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI_TIMEOUT');};
  const click=async text=>js(`Array.from(document.querySelectorAll('button[type=button]')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const submit=async data=>js(`(()=>{for(const [key,value] of Object.entries(${JSON.stringify(data)}))document.querySelector('input[name="'+key+'"]').value=value;document.querySelector('form').requestSubmit();})()`);
  await w.loadURL('http://127.0.0.1:18133/');await wait("document.querySelector('h1')?.textContent==='Sistema Ruy — acesso individual'");stage='register';await click('Criar conta');await wait('!!document.querySelector("input[name=name]")');await submit({name:'FICTICIO Teste de interface',email:c.member,password:c.password});await wait("document.querySelector('[role=status]')?.textContent.includes('Solicitação recebida')");
  const message=await open('mail.dpapi');assert.equal(message.to,c.member);assert.equal(message.purpose,'verify');stage='verify';await click('Confirmar e-mail');await wait('!!document.querySelector("input[name=code]")');await submit({email:c.member,code:message.code});await wait("document.querySelector('[role=status]')?.textContent.includes('Aguarde aprovação')");
  stage='login-admin';await click('Entrar');await wait('!!document.querySelector("input[name=password]")');await submit({email:c.admin,password:c.password});await wait("document.querySelector('main h1')?.textContent==='Dashboard'");assert.equal(await js('location.pathname'),'/');stage='administration';await js("Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='Acessos individuais').click()");await wait("document.querySelector('main h1')?.textContent==='Acessos individuais'");stage='administration-list';await wait('document.querySelectorAll("form select[name=role]").length>=2');
  stage='reload';w.reload();await wait("document.querySelector('main h1')?.textContent==='Acessos individuais'");
  clearTimeout(deadline);await write({passed:true,packaged:false,installed:false,registrationUi:true,verificationUiWithSimulatedMailbox:true,pendingApproval:true,individualLogin:true,dashboardNoSectorRedirect:true,adminUi:true,reloadSession:true,mailDeliveryReal:false});w.close();app.quit();
  }catch{clearTimeout(deadline);let diagnostic={};try{diagnostic=await w.webContents.executeJavaScript('({path:location.pathname,adminHeading:document.querySelector("h1")?.textContent==="Acessos individuais",selectCount:document.querySelectorAll("form select[name=role]").length})');}catch{/* A closed renderer has no additional diagnostic. */}await write({passed:false,stage,reason:'IDENTITY_UI_FAILED',diagnostic});w?.close();app.quit();}
}
run().catch(()=>{app.quit();});
