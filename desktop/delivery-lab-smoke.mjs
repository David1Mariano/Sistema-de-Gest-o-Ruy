// Automated regression in an owned hidden Electron window; no OS/network control.
import {app,BrowserWindow} from 'electron';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import {webPreferences,allowedNavigation,localOrigin} from './policy.mjs';
const isolated=process.env.RUY_D1_INSTALLATION==='i5r4-dev-20261020'&&process.env.RUY_D1_TEST_API_PORT==='18113';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||!isolated&&(process.env.RUY_D1_RESTART_FIXTURE!=='e5aaec701010f607'||process.env.RUY_D1_DELIVERY_LAB!=='1'||process.env.RUY_D1_TEST_API_PORT!=='18091'))throw Error('Owned synthetic UI fixture required.');
process.on('uncaughtException',()=>{process.exitCode=1;app.quit();});
const config=JSON.parse(syncFs.readFileSync(process.env.RUY_D1_DELIVERY_UI_CONFIG,'utf8'));
if(config.purpose!=='RUY_DELIVERY_UI_SYNTHETIC'||!path.isAbsolute(config.home)||!path.basename(config.home).startsWith('ruy-rc-'))throw Error('Private synthetic profile required.');
syncFs.mkdirSync(path.join(config.home,'electron-profile'));app.setPath('userData',path.join(config.home,'electron-profile'));
let window,step=0;
const normalStop=()=>{syncFs.writeFileSync(path.join(config.home,'delivery-ui-result.json'),JSON.stringify({passed:false,step,normalWatchdogStop:true}));if(window&&!window.isDestroyed())window.close();app.quit();};
const watchdog=setTimeout(normalStop,120000);
const stopPoll=setInterval(()=>{if(syncFs.existsSync(path.join(config.home,'stop-electron')))normalStop();},1000);
app.on('before-quit',()=>{clearTimeout(watchdog);clearInterval(stopPoll);});
app.whenReady().then(async()=>{
try{
 window=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{...webPreferences,backgroundThrottling:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(!allowedNavigation(url))event.preventDefault();});
 const js=async code=>{let timer;try{return await Promise.race([window.webContents.executeJavaScript(code),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Renderer response timeout')),5000);})]);}finally{clearTimeout(timer);}};
 const wait=async condition=>{step++;syncFs.writeFileSync(path.join(config.home,'ui-step.json'),JSON.stringify({step}));for(let n=0;n<200;n++){if(await condition())return;await new Promise(r=>setTimeout(r,100));}throw Error('Synthetic Delivery UI timed out at step '+step);};
 const click=async text=>{await wait(()=>js(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`));await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);};
 const set=async(selector,value,event='input')=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Control absent');Object.getOwnPropertyDescriptor(${event==='change'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
 const selectLabel=async(label,text,index=0)=>{await wait(()=>js(`!![...document.querySelectorAll('label')].filter(l=>l.textContent.startsWith(${JSON.stringify(label)}))[${index}]?.querySelector('select')`));await js(`(()=>{const e=[...document.querySelectorAll('label')].filter(l=>l.textContent.startsWith(${JSON.stringify(label)}))[${index}].querySelector('select');const option=[...e.options].find(o=>o.textContent.startsWith(${JSON.stringify(text)}));if(!option)throw Error('Option absent');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,option.value);e.dispatchEvent(new Event('change',{bubbles:true}));})()`);};
 await window.loadURL(localOrigin+'/delivery-lab');
 await wait(()=>js("!!document.querySelector('input[name=login]')"));await set('input[name=login]',config.login);await set('input[name=password]',config.password);await js("document.querySelector('input[name=login]').form.requestSubmit()");
 await wait(()=>js("!![...document.querySelectorAll('h1')].find(e=>e.textContent==='Delivery — homologação')"));
 for(const [tab,name,price] of [['Clientes','FICTICIO Windows cliente',null],['Cardápio','FICTICIO Windows item','8.75'],['Entregadores','FICTICIO Windows entregador',null]]){
  await click(tab);await wait(()=>js("!!document.querySelector('input[name=name]')"));await set('input[name=name]',name);if(price)await set('input[name=price]',price);await js("document.querySelector('input[name=name]').form.requestSubmit()");await wait(()=>js(`!![...document.querySelectorAll('li')].find(e=>e.textContent.includes(${JSON.stringify(name)}))`));
 }
 await click('Pedidos');await selectLabel('Cliente','FICTICIO Windows cliente');await selectLabel('Produto','FICTICIO Windows item');
 await js("(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Quantidade')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2.5');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await click('Adicionar item');await selectLabel('Produto','FICTICIO Windows item',1);await click('Salvar pedido');
 const orderRow=()=>js("[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('FICTICIO Windows cliente'))?.innerText||''");
 await wait(async()=>/2[.,]5/.test(await orderRow()));
 let id=await js("[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('FICTICIO Windows cliente')).textContent.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/)[0]");
 const rowClick=async text=>{await wait(()=>js(`!![...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(id)}))?.querySelector('td:last-child')`));await js(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(id)}));const button=[...row.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}&&!b.disabled);if(!button)throw Error('Action absent');button.click();})()`);};
 await rowClick('Editar pedido');await wait(()=>js("!![...document.querySelectorAll('h2')].find(e=>e.textContent==='Editar pedido novo')"));
 await js("(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Quantidade')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'3.5');e.dispatchEvent(new Event('input',{bubbles:true}));})()");await click('Salvar edição do pedido');await wait(async()=>/3[.,]5/.test(await orderRow()));
 for(const state of ['Aceito','Em preparo','Pronto','Concluído']){await rowClick(state);await wait(()=>js(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(id)}));return row?.children[2].textContent===${JSON.stringify(state)};})()`));}
 await selectLabel('Cliente','FICTICIO Windows cliente');await selectLabel('Produto','FICTICIO Windows item');await click('Salvar pedido');await wait(()=>js("[...document.querySelectorAll('tbody tr')].filter(r=>r.textContent.includes('FICTICIO Windows cliente')).length===2"));
 id=await js("[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes('FICTICIO Windows cliente')&&r.children[2].textContent==='Novo').textContent.match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/)[0]");
 await js(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(id)}));row.querySelector('details').open=true;})()`);
 await js(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(id)}));const e=row.querySelector('input[name=reason]');e.value='FICTICIO cancelamento Windows';})()`);await rowClick('Confirmar cancelamento');await wait(()=>js(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(id)}));return row?.children[2].textContent==='Cancelado';})()`));
 const summary=await js("document.querySelector('aside[aria-label=\"Indicadores de Delivery\"]').innerText");
 const estimated=((config.baseline.estimatedTotalCents+3938)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replaceAll('\u00a0',' ');
 if(!summary.includes((config.baseline.ordersCount+2)+' pedidos')||!summary.replaceAll('\u00a0',' ').includes(estimated))throw Error('UI report differs from persisted integer amounts');
 await new Promise(resolve=>setTimeout(resolve,250));
 await fs.writeFile(path.join(config.home,'delivery-ui.png'),(await Promise.race([window.webContents.capturePage(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Capture timeout')),3000))])).toPNG());
 await fs.writeFile(path.join(config.home,'delivery-ui-result.json'),JSON.stringify({passed:true,packaged:app.isPackaged,actualElectron:true,syntheticOnly:true,steps:step,orderItemsEdited:true,statesConcluded:true,cancelled:true,catalogsCreated:true}));
 window.close();app.quit();
}catch{if(window&&!window.isDestroyed()){try{await fs.writeFile(path.join(config.home,'delivery-ui-failure.png'),(await Promise.race([window.webContents.capturePage(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Capture timeout')),3000))])).toPNG());}catch{/* preserve the failure result even if the renderer is unavailable */}window.close();}await fs.writeFile(path.join(config.home,'delivery-ui-result.json'),JSON.stringify({passed:false,step}));process.exitCode=1;app.quit();}
}).catch(normalStop);
