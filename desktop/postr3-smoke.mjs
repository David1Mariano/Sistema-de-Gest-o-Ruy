import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function postR3Smoke({window,pool,actor,origin,result}){
 assert.equal(process.env.RUY_D1_INSTALLATION,'i5r4-dev-20261020');
 assert.equal(process.env.RUY_D1_ATTACHMENTS_LAB,undefined);
 assert.equal(process.env.RUY_D1_DELIVERY_LAB,undefined);
 const js=code=>window.webContents.executeJavaScript(code);
 const wait=async code=>{for(let n=0;n<200;n++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('POSTR3_UI_TIMEOUT '+code);};
 const click=async text=>{await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);};
 const select=async(label,value)=>js(`(()=>{const e=document.querySelector('select[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const expense=(await pool.query("SELECT id FROM d2_catalog WHERE owner_id=$1 AND entity='FinancialExpense' LIMIT 1",[actor])).rows[0];assert.ok(expense);
 await window.loadURL(origin+'/anexos');await wait("!!document.querySelector('select[aria-label=\"Tipo de registro\"]')");
 await select('Tipo de registro','FinancialExpense');await wait(`!!document.querySelector('select[aria-label="Registro"] option[value="${expense.id}"]')`);await select('Registro',expense.id);
 const name='FICTICIO-postr3-local.txt',text='FICTICIO <script>window.untrustedAttachment=true</script> arquivo local R4';
 await js(`(()=>{const e=document.querySelector('input[type=file]'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)},{type:'text/plain'}));e.files=data.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await click('Salvar anexo na fila');await wait(`document.body.textContent.includes(${JSON.stringify(name)})&&document.body.textContent.includes('Pendente de envio')`);
 const item=(await pool.query('SELECT id FROM d1_attachment_queue WHERE actor=$1',[actor])).rows[0];assert.ok(item);
 await js(`document.querySelector('[aria-label="Abrir ${name}"]').click()`);await wait("!!document.querySelector('[aria-label=\"Visualizar anexo\"] pre')");
 assert.equal(await js("document.querySelector('[aria-label=\"Visualizar anexo\"] pre').textContent"),text);assert.equal(await js('!!window.untrustedAttachment'),false);
 const destination=result+'.attachment.txt';
 const downloaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Download timeout')),15000);window.webContents.session.once('will-download',(_event,download)=>{download.setSavePath(destination);download.once('done',(_event,state)=>{clearTimeout(timer);state==='completed'?resolve():reject(Error('Download failed'));});});});
 await js("[...document.querySelectorAll('a')].find(a=>a.textContent==='Baixar cópia verificada').click()");await downloaded;assert.equal(await fs.readFile(destination,'utf8'),text);
 const reloaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.reload();await reloaded;await wait("!!document.querySelector('select[aria-label=\"Tipo de registro\"]')");await select('Tipo de registro','FinancialExpense');await wait(`document.body.textContent.includes(${JSON.stringify(name)})`);
 await window.loadURL(origin+'/delivery-lab');await wait("document.body.textContent.includes('Novo pedido')");await wait("document.body.textContent.includes('Salvar pedido')");
 assert.equal(await js("document.body.textContent.includes('Disponível somente no laboratório autorizado e provisionado.')"),false);
 return {ordinaryStartupWithoutFeatureFlags:true,localAttachmentQueued:true,localDownloadSha256:createHash('sha256').update(text).digest('hex'),previewEscaped:true,attachmentReloadPersisted:true,deliveryWorkspaceEnabled:true,externalPaymentsEnabled:false,operationalSyncEnabled:false};
}
