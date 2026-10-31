// Own-application Electron acceptance. Never reads operational profiles.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {revealWindow} from './window-visibility.mjs';
export async function sharedClientSmoke({window,profileRoot,app,screen}){
 const fixture=JSON.parse(await fs.readFile(path.join(profileRoot,'synthetic-fixture.json'),'utf8'));
 assert.match(fixture.email,/@example\.invalid$/);assert.match(fixture.recordId,/^[a-f0-9-]{36}$/);
 const base=path.join(process.env.LOCALAPPDATA,'GestaoRuy','installation-final-dev-20261021');
 assert.equal(path.dirname(fixture.coordination),base);assert.match(path.basename(fixture.coordination),/^shared-test-[a-f0-9]{16}$/);
 const evaluate=code=>window.webContents.executeJavaScript(code);
 const wait=async predicate=>{for(let n=0;n<400;n++){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('SHARED_UI_TIMEOUT');};
 const exists=file=>fs.access(path.join(fixture.coordination,file)).then(()=>true,()=>false);
 await wait(()=>evaluate("!!document.querySelector('input[name=email]')"));
 assert.equal(await evaluate("document.querySelector('h1')?.textContent"),'Sistema Ruy — acesso individual');
 assert.equal(await evaluate("/Gerar pedido do dispositivo|Importar autorização do administrador/.test(document.body.innerText)"),false);
 await fs.writeFile(path.join(profileRoot,'login-window.png'),(await window.webContents.capturePage()).toPNG());
 if(fixture.phase==='connection'){
  await wait(()=>evaluate("document.body.innerText.includes('Tentar novamente')"));
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Tentar novamente').click()");
  await wait(()=>evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Tentar novamente'&&!b.disabled)"));
  assert.equal(await evaluate("!!document.querySelector('input[name=email]')"),true);
  await fs.writeFile(path.join(profileRoot,'shared-window.png'),(await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(profileRoot,'acceptance-result.json'),JSON.stringify({passed:true,packaged:app.isPackaged,version:app.getVersion(),phase:'connection',originalLoginFirst:true,retryWithoutLocalDatabase:true}));return;
 }
 // Exercise the actual installed-bundle login form, not a substituted frontend.
 await evaluate(`(()=>{const set=(name,value)=>{const input=document.querySelector('input[name='+name+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};set('email',${JSON.stringify(fixture.email)});set('password',${JSON.stringify(fixture.password)});document.querySelector('form').requestSubmit();})()`);
 await wait(()=>evaluate("document.body.innerText.includes('Compartilhado — homologação')&&!!document.querySelector('a[href=\"/funcionarios\"]')"));
 assert.equal(await evaluate("typeof require==='undefined'"),true);
 if(fixture.phase==='public-login'){
  const me=await evaluate("fetch('/api/d1/me').then(r=>r.json())");
  assert.equal(me.user.id,fixture.userId);assert.equal(me.user.role,fixture.role);
  await fs.writeFile(path.join(profileRoot,'dashboard-public.png'),(await window.webContents.capturePage()).toPNG());
  const status=await evaluate("fetch('/api/d1/sync-status').then(r=>r.json())");assert.equal(status.connection,'online');
  const logout=await evaluate("(async()=>{const me=await(await fetch('/api/d1/me')).json();return (await fetch('/api/d1/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:'{}'})).status;})()");assert.equal(logout,200);
  await wait(()=>evaluate("!!document.querySelector('input[name=email]')"));
  await fs.writeFile(path.join(profileRoot,'acceptance-result.json'),JSON.stringify({passed:true,packaged:app.isPackaged,version:app.getVersion(),phase:'public-login',originalLoginFirst:true,originalDashboardOpened:true,originalSidebar:true,individualLogin:true,online:true,logoutToLogin:true,independentProfile:true,localPostgresStarted:false,clientCertificatesRequired:false,deviceApprovalRequired:false,physicalComputer:false}));return;
 }
 await evaluate("document.querySelector('a[href=\"/funcionarios\"]').click()");
 const local=async(route,body)=>evaluate(`(async()=>{const me=await(await fetch('/api/d1/me')).json();const r=await fetch('/api/d1'+${JSON.stringify(route)},{method:${body?'"POST"':'"GET"'},headers:${body?`{'Content-Type':'application/json','X-CSRF-Token':me.csrf}`:'{}'},body:${body?JSON.stringify(JSON.stringify(body)):'undefined'}});return {status:r.status,body:await r.json()};})()`);
 const financial=async()=>((await local('/domain/FinancialExpense')).body.records||[]).find(r=>r.id===fixture.expenseId);
 const stock=async()=>((await local('/operations/state')).body.balances||[]).find(r=>r.item_id===fixture.stockId);
 const bytes=Buffer.from('FICTICIO Anexo entre dois Electron independentes'),sha256=createHash('sha256').update(bytes).digest('hex');
 const original={operationId:fixture.operationId,operation:'create',baseVersion:null,data:{name:'FICTICIO Electron A',status:'ativo',hire_type:'outros',admission_date:'2026-10-26'}};
 if(fixture.phase==='history'){
  const {sharedHistoryAcceptance}=await import('./shared-history-acceptance.mjs');
  const history=await sharedHistoryAcceptance({window,fixture,profileRoot,local,wait,evaluate});
  await fs.writeFile(path.join(profileRoot,'acceptance-result.json'),JSON.stringify({passed:true,packaged:app.isPackaged,version:app.getVersion(),phase:'history',history}));return;
 }
 if(fixture.phase==='modules'){
  const {sharedModulesAcceptance}=await import('./shared-modules-acceptance.mjs');
  const modules=await sharedModulesAcceptance({window,fixture,profileRoot,local,wait,exists,evaluate});
  await fs.writeFile(path.join(profileRoot,'shared-window.png'),(await window.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(profileRoot,'acceptance-result.json'),JSON.stringify({passed:true,packaged:app.isPackaged,version:app.getVersion(),phase:'modules',modules}));return;
 }
 if(['reopen','reconnect'].includes(fixture.phase)){
  await wait(()=>evaluate("document.body.innerText.includes('FICTICIO Electron B')"));
  const current=(await local('/entities/Employee')).body.records.find(r=>r.id===fixture.recordId);assert.equal(current.name,'FICTICIO Electron B');assert.equal(current._version,2);assert.equal((await financial()).status,'cancelado');assert.equal((await stock()).quantity_milli,5000);assert.equal((await local('/attachments/'+fixture.attachmentId)).body.sha256,sha256);
  if(fixture.phase==='reconnect'){
   await fs.writeFile(path.join(fixture.coordination,fixture.side+'-ready-reconnect'),'yes');
   await wait(async()=>(await local('/sync-status')).body.connection==='offline');
   for(const entity of ['FinancialExpense','PayrollRun','TimeRecord','Schedule','Purchase','DeliveryOrder','DailyProduction'])assert.equal((await local('/domain/command',{entity,id:fixture.recordId,operationId:randomUUID(),action:'save',baseVersion:1,data:{}})).status,503);
   assert.equal((await local('/operations/command',{kind:'journal',operationId:randomUUID()})).status,503);
   await fs.writeFile(path.join(fixture.coordination,fixture.side+'-offline-verified'),'yes');
   await wait(async()=>(await local('/sync-status')).body.connection==='online');
   assert.equal((await local('/me')).status,200);assert.equal((await financial()).status,'cancelado');assert.equal((await stock()).quantity_milli,5000);
  }
 }else if(fixture.side==='A'){
  const result=await local('/catalog/Employee/'+fixture.recordId,original);assert.equal(result.status,200);
  assert.equal((await local('/domain/command',{entity:'Revenue',id:fixture.revenueId,operationId:randomUUID(),action:'save',baseVersion:null,data:{description:'FICTICIO Receita de teste',source:'FICTICIO Recibo Electron 1',date:'2026-10-26',gross_amount:100,fee_amount:0,net_amount:100,status:'recebido'}})).status,200);
  assert.equal((await local('/domain/command',{entity:'FinancialExpense',id:fixture.expenseId,operationId:randomUUID(),action:'save',baseVersion:null,data:{description:'FICTICIO Despesa compartilhada',date:'2026-10-26',amount:10,status:'pago',payment_method:'dinheiro',origin_type:'manual',document_number:'FICTICIO-ELECTRON-1',beneficiary_name:'FICTICIO Fornecedor'}})).status,200);
  assert.equal((await local('/operations/create-item',{operationId:randomUUID(),itemId:fixture.stockId,data:{name:'FICTICIO Estoque compartilhado',unit:'kg',status:'ativo'},initialMilli:4000,unitCents:100})).status,200);
  assert.equal((await local('/attachments',{id:fixture.attachmentId,operationId:randomUUID(),recordId:fixture.recordId,recordVersion:1,entity:'Employee',filename:'FICTICIO-shared.txt',mediaType:'text/plain',sha256,bytes:bytes.toString('base64')})).status,200);
  await fs.writeFile(path.join(fixture.coordination,'electron-A-created'),'yes',{flag:'wx'});
  await wait(()=>evaluate("document.body.innerText.includes('FICTICIO Electron B')"));
  await wait(async()=>((await financial())?.status==='cancelado')&&((await stock())?.quantity_milli===5000));
  const replay=await local('/catalog/Employee/'+fixture.recordId,original);assert.equal(replay.status,200);assert.equal(replay.body.replay,true);assert.equal(replay.body.record.name,'FICTICIO Electron B');
  await fs.writeFile(path.join(fixture.coordination,'electron-A-observed-B'),'yes',{flag:'wx'});
 }else{
  await wait(()=>exists('electron-A-created'));await wait(()=>evaluate("document.body.innerText.includes('FICTICIO Electron A')"));
  const current=(await local('/entities/Employee')).body.records.find(r=>r.id===fixture.recordId);assert.ok(current);
  const result=await local('/catalog/Employee/'+fixture.recordId,{operationId:fixture.operationId,operation:'update',baseVersion:current._version,data:{name:'FICTICIO Electron B'}});assert.equal(result.status,200);assert.equal(result.body.record.admission_date,'2026-10-26');
  assert.equal((await local('/catalog/Employee/'+fixture.recordId,{operationId:randomUUID(),operation:'update',baseVersion:1,data:{name:'FICTICIO Versao obsoleta'}})).status,409);
  assert.equal((await local('/sync-status')).body.connection,'online');
  const balance=await stock();assert.equal(balance.quantity_milli,4000);
  assert.equal((await local('/operations/command',{operationId:randomUUID(),kind:'adjust',itemId:fixture.stockId,targetMilli:5000,baseVersion:balance.version,unitCents:100})).status,200);
  assert.equal((await financial()).amount,10);
  const reverse={operationId:randomUUID(),entity:'FinancialExpense',id:fixture.expenseId,baseVersion:1,action:'reverse',reason:'FICTICIO Conferido no segundo cliente'};
  assert.equal((await local('/domain/command',reverse)).status,200);assert.equal((await local('/domain/command',reverse)).body.replay,true);
  assert.equal((await local('/attachments/'+fixture.attachmentId)).body.bytes,bytes.toString('base64'));
  await wait(()=>exists('electron-A-observed-B'));
 }
 let historyProof;
 if(fixture.phase==='write'&&fixture.history){const {sharedHistoryAcceptance}=await import('./shared-history-acceptance.mjs');historyProof=await sharedHistoryAcceptance({window,fixture,profileRoot,local,wait,evaluate});}
 window.minimize();revealWindow(window,screen.getAllDisplays());assert.equal(window.isVisible(),true);assert.equal(window.isMinimized(),false);
 window.setPosition(-20000,-20000);revealWindow(window,screen.getAllDisplays());assert.ok(window.getBounds().x>-20000);
 await fs.writeFile(path.join(profileRoot,'shared-window.png'),(await window.webContents.capturePage()).toPNG());
 const state=(await local('/sync-status')).body;assert.equal(state.connection,'online');
 if(fixture.phase==='reopen'){
  const read=name=>fs.readFile(path.join(fixture.coordination,name),'utf8').then(JSON.parse),setup=await read('modules-setup'),aggregate=await read('modules-aggregates'),production=await read('modules-production');
  const find=async(entity,id)=>(await local('/domain/'+entity)).body.records.find(r=>r.id===id);
  assert.equal((await find('Schedule',setup.schedule)).observation,'FICTICIO Editado pelo cliente B');assert.equal((await find('TimeRecord',setup.point)).worked_minutes,480);
  assert.equal((await find('PayrollRun',setup.run)).status,'estornado');assert.equal((await find('Vale',setup.vale)).status,'pendente');assert.equal((await find('AccountsPayable',aggregate.payable)).status,'pago');
  assert.equal((await find('DailyProduction',production.id)).local_status,'confirmado');assert.equal((await find('DeliveryOrder',aggregate.order)).financialStatus,'refunded');
  assert.equal((await local('/settlements/reconciliation')).body.consistent,true);
  if(fixture.side==='B')assert.equal((await local('/domain/command',await read('modules-production-command'))).body.replay,true);
 }
 if(fixture.phase==='reopen'){const report=await local('/reports/employees');assert.equal(report.status,200);assert.ok(report.body.rows.some(row=>row.includes('FICTICIO Electron B')));const categories=await local('/reports/categories?start=2026-10-01&end=2026-10-31');assert.equal(categories.status,200);assert.equal(categories.body.totalCents,200);}
 const proof={passed:true,...(historyProof?{history:historyProof}:{}),packaged:app.isPackaged,version:app.getVersion(),phase:fixture.phase||'write',realLoginForm:true,originalSidebar:true,automaticEmployeeRefresh:true,mutationsThroughOwnBackend:true,manualExpenseAndReversal:true,sharedStock:true,attachmentHashVerified:true,formMutationManuallyTested:false,independentProfile:true,localPostgreSQLStarted:false,normalShutdownRequested:true,physicalMachines:false,reopenPersistence:fixture.phase==='reopen',reportsAuthorized:fixture.phase==='reopen',sixModulePersistence:fixture.phase==='reopen',postRestartReplay:fixture.phase==='reopen'&&fixture.side==='B',automaticReconnectSameSession:fixture.phase==='reconnect',criticalWritesRefusedOffline:fixture.phase==='reconnect'};
 await fs.writeFile(path.join(profileRoot,'acceptance-result.json'),JSON.stringify(proof));
}
