const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const file=process.env.RUY_OPERATIONAL_UI_FIXTURE;
if(!file||!file.includes(path.join('GestaoRuy','audits','api-consulta-'))||path.basename(file)!=='two-electron-fixture.json')throw Error('PRIVATE_ISOLATED_FIXTURE_REQUIRED');
const fixture=JSON.parse(fs.readFileSync(file,'utf8'));app.setPath('userData',path.join(path.dirname(file),'two-client-profiles'));
app.whenReady().then(async()=>{const windows=[],proof={at:new Date().toISOString(),passed:false,independentElectronWindows:2,isolatedDataOnly:true};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 try{for(let index=0;index<2;index++){const origin=fixture.origins[index];if(new URL(origin).hostname!=='127.0.0.1')throw Error('LOOPBACK_ONLY');const win=new BrowserWindow({show:false,webPreferences:{partition:'persist:independent-'+index,sandbox:true,nodeIntegration:false,contextIsolation:true}});windows.push(win);await win.loadURL(origin+'/');await win.webContents.executeJavaScript(`fetch('/api/d1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({login:fixture.email,password:fixture.password})})}).then(async r=>{if(!r.ok)throw Error('LOGIN_FAILED');return true})`);await win.loadURL(origin+'/funcionarios');}
 const read=(index,code)=>windows[index].webContents.executeJavaScript(code);
 const until=async(index,code)=>{for(let attempt=0;attempt<100;attempt++){if(await read(index,code))return;await delay(100);}throw Error('ELECTRON_UI_TIMEOUT');};
 await until(0,"!!document.querySelector('button[title=\"Ver ficha\"]')");proof.employeeList=true;
 const id=crypto.randomUUID(),name='VALIDACAO_ISOLADA_'+crypto.randomBytes(5).toString('hex');
 const post=(index,route,body)=>read(index,`(async()=>{const me=await(await fetch('/api/d1/me')).json();const r=await fetch('/api/d1'+${JSON.stringify(route)},{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify(${JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(v.error);return v;})()`);
 const created=await post(0,'/catalog/Employee/'+id,{operationId:crypto.randomUUID(),operation:'create',baseVersion:null,data:{name,status:'ativo',hire_type:'outros',admission_date:'2026-10-29'}});
 await until(1,`document.body.innerText.includes(${JSON.stringify(name)})`);proof.AcreateVisibleB=true;
 await post(1,'/catalog/Employee/'+id,{operationId:crypto.randomUUID(),operation:'update',baseVersion:created.record._version,data:{name:name+'_EDITADO'}});
 await until(0,`document.body.innerText.includes(${JSON.stringify(name+'_EDITADO')})`);proof.BeditVisibleA=true;
 await windows[0].loadURL(fixture.origins[0]+'/funcionarios/'+id);await until(0,"!!document.querySelector('[role=tablist]')");proof.originalDetail=true;
 proof.editEnabled=await read(0,"Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Editar')&&!button.disabled)");
 await windows[0].loadURL(fixture.origins[0]+'/financeiro');await delay(2500);proof.financialScreen=await read(0,"!!document.querySelector('h1')&&!document.body.innerText.includes('aguarda integração')");
 await windows[0].loadURL(fixture.origins[0]+'/estoque');await delay(1500);proof.heldStockLabel=await read(0,"document.body.innerText.includes('PENDENTE DE CLASSIFICAÇÃO')&&document.body.innerText.includes('Pendente de confirmação')");
 proof.passed=proof.employeeList&&proof.AcreateVisibleB&&proof.BeditVisibleA&&proof.originalDetail&&proof.editEnabled&&proof.financialScreen&&proof.heldStockLabel;
 }catch(error){proof.error=/^[A-Z0-9_]+$/.test(error.message)?error.message:'TWO_ELECTRON_FAILED';}
 finally{fs.writeFileSync(fixture.output,JSON.stringify(proof,null,2));for(const win of windows)win.destroy();app.exit(proof.passed?0:1);}
});
