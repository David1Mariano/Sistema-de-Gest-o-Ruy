import {app, BrowserWindow, dialog, session, utilityProcess} from 'electron';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {allowedNavigation,allowedDownload, localOrigin, webPreferences} from './policy.mjs';
import {createSupervisor} from './supervisor.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? app.getAppPath() : path.resolve(here, '..');
const metadata=JSON.parse(await fs.readFile(path.join(here,'package.json'),'utf8'));
app.setName('Sistema de Gestão Ruy');
// Namespace exclusivo: não usa sessão, cache ou cluster operacional.
const profileName=metadata.ruyRevision?.startsWith('A5-')?'SistemaGestaoRuy-Agente5-Homolog':process.env.RUY_D1_TEST_API_PORT==='18091'&&process.env.RUY_D1_ALLOW_TESTS==='1'?'SistemaGestaoRuy-Agente5-Test':'SistemaGestaoRuy-Lab';
app.setPath('userData', path.join(app.getPath('appData'),profileName));
app.setAppUserModelId(metadata.ruyAppId||'br.ruy.gestao.laboratorio.g');
let worker, window, timer, closing = false,preparing=false;
let backupTimer,backupFlight,smokeAccount,supervisor;
let stage='startup';
const smoke = process.argv.includes('--lab-smoke');
if(smoke&&process.env.RUY_D1_ALLOW_TESTS==='1'&&process.argv.includes('--lab-attachments-smoke')){
 process.stdin.setEncoding('utf8');process.stdin.on('data',text=>{if(text.trim()==='shutdown')app.quit();});
}

const evidence = {purpose:'RUY_DESKTOP_SYNTHETIC_ONLY', packaged:app.isPackaged,version:app.getVersion(),revision:metadata.ruyRevision||'source-H1'};
async function health() {
  const r = await fetch(localOrigin+'/health', {signal:AbortSignal.timeout(1500), redirect:'error'});
  const value = await r.json().catch(()=>null);
  if(!r.ok)throw Object.assign(Error('API local indisponível.'),{recoverable:r.status>=500});
  if (value?.service!=='ruy-d1-lab' || value.mode!=='synthetic-only' || value.syncEnabled!==false) throw Object.assign(Error('A porta do laboratório está ocupada por outro serviço.'),{recoverable:false});
  return value;
}
async function start() {
  stage='environment';
  const env = await import(pathToFileURL(path.join(root, 'server/d1-lab/environment.mjs')));
  try{await fs.lstat(env.home);}catch(error){
    if(error.code!=='ENOENT')throw error;
    if(smoke)throw Error('Smoke exige laboratório já preparado.');
    preparing=true;
    const {prepareFirstRun}=await import('./setup.mjs');await prepareFirstRun(root,here);
  }
  const {ensureLocalDatabase}=await import(pathToFileURL(path.join(root,'server/d1-lab/bootstrap.mjs')));
  evidence.databaseStartup=await ensureLocalDatabase();
  // Recusa outro Windows, diretório redirecionado ou cluster não marcado.
  const marker = await env.validateHome();
  await env.config();
  const core = await import(pathToFileURL(path.join(root, 'server/d1-lab/core.mjs')));
  const pool = core.poolFor(await env.config());
  stage='identity';
  try {
    const result = await pool.query('SELECT id FROM lab_device WHERE singleton');
    if (result.rows[0]?.id !== marker.deviceId) throw Error('Identidade local divergente.');
    if(smoke){
      const id=randomUUID(),password=randomBytes(24).toString('hex'),login='desktop-'+id+'@example.invalid';
      await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[id,login,await core.hashPassword(password)]);
      smokeAccount={id,login,password};
      if(process.argv.includes('--lab-attachments-smoke')){
        if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Attachment smoke requires explicit opt-in');
        const {operationalCommand}=await import(pathToFileURL(path.join(root,'server/d1-lab/operations.mjs')));
        await operationalCommand(pool,{id,role:'admin'},marker.deviceId,{operationId:randomUUID(),kind:'journal',entries:[{account:'cash',cents:100000,baseVersion:0},{account:'bank',cents:100000,baseVersion:0},{account:'equity',cents:-200000,baseVersion:0}]});
      }

      evidence.syntheticActor=id;
      const {save}=await import(pathToFileURL(path.join(root,'server/d1-lab/entities.mjs')));
      await save(pool,{id,role:'admin'},marker.deviceId,'Sector',randomUUID(),{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO Setor do aplicativo',description:'Cadastro sintético para homologação visual',status:'ativo'}});
    }
  } finally { await pool.end(); }
  // PostgreSQL privado é iniciado por pg_ctl; nenhum serviço Windows é instalado.
  const ensureApi=async()=>{
    if(closing)throw Error('Aplicativo encerrando.');
    if(!worker){
      const launched=utilityProcess.fork(path.join(here,'service.mjs'),[],{env:{...process.env,RUY_DESKTOP_ROOT:root},stdio:'pipe',serviceName:'Ruy API laboratório'});
      worker=launched;
      launched.on('exit',()=>{if(worker===launched)worker=null;if(!closing)supervisor?.recover();});
    }
    for(let attempt=0;attempt<40;attempt++){
      if(closing)throw Error('Aplicativo encerrando.');
      await new Promise(resolve=>setTimeout(resolve,250));
      try{await health();return;}catch(error){if(error.recoverable===false)throw error;}
    }
    throw Error('API local não confirmou recuperação.');
  };
  let available = false;
  stage='api';
  try { await health(); available=true; }
  catch (e) { if (e.recoverable!==true&&!(e instanceof TypeError)&&e.name!=='TimeoutError') throw e; }
  if (!available) {
    await ensureApi();
  }
  evidence.apiOwned=Boolean(worker);
  stage='backup-config';
  // Backup usa somente cluster D1 validado. Nunca instala agendamento permanente.
  const backups=await import(pathToFileURL(path.join(root,'server/d1-lab/backup.mjs')));
  const backupSettings=await backups.backupConfig();
  const createBackup=()=>backupFlight||(backupFlight=backups.backup({retain:backupSettings.retain}).catch(()=>{}).finally(()=>{backupFlight=null;}));
  if(!smoke&&backupSettings.enabled){await createBackup();backupTimer=setInterval(createBackup,backupSettings.intervalMinutes*60*1000);}
  const browserSession=smoke?session.fromPartition('ruy-lab-smoke-'+randomUUID()):session.defaultSession;
  browserSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  browserSession.setPermissionCheckHandler(()=>false);
  browserSession.webRequest.onBeforeRequest({urls:['<all_urls>']}, (details,callback)=>{
    callback({cancel: !allowedNavigation(details.url)});
  });
  browserSession.on('will-download',(event,item,contents)=>{
    if(!window||contents!==window.webContents||!allowedDownload(item.getURL())||!item.getURLChain().every(allowedDownload))event.preventDefault();
  });
  preparing=false;
  window = new BrowserWindow({title:'Sistema de Gestão Ruy — Laboratório',width:1366,height:900,minWidth:900,minHeight:640,
    show:!smoke,icon:path.join(here,'assets/ruy.ico'),webPreferences:{...webPreferences,session:browserSession,backgroundThrottling:!smoke}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate', (event,url)=>{if(!allowedNavigation(url))event.preventDefault();});
  window.webContents.on('will-redirect', (event,url)=>{if(!allowedNavigation(url))event.preventDefault();});
  window.webContents.on('will-attach-webview', event=>event.preventDefault());
  stage='load-window';
  await window.loadURL(localOrigin+'/setores');
  supervisor=createSupervisor({health,ensureDatabase:ensureLocalDatabase,ensureApi,onState:state=>{
    if(window&&!window.isDestroyed())window.setTitle(state==='healthy'?'Sistema de Gestão Ruy — Laboratório':state==='recovering'?'Sistema Ruy — recuperando serviços locais':'Sistema Ruy — recuperação indisponível; use o menu Laboratório');
  }});
  if(!smoke){const {installLabMenu}=await import('./lab-menu.mjs');installLabMenu(root,window,{recover:()=>supervisor.retry()});}
  if(smoke) {
    const waitFor=async condition=>{
      for(let n=0;n<60;n++){if(await window.webContents.executeJavaScript(condition))return;await new Promise(r=>setTimeout(r,100));}
      throw Error('Interface de laboratório não atingiu estado esperado.');
    };
    stage='login-form';
    await waitFor("!!document.querySelector('input[name=login]')");
    evidence.renderer = await window.webContents.executeJavaScript(`({title:document.title,hasLogin:!!document.querySelector('input[name=login]'),nodeExposed:typeof require!=='undefined',location:location.origin})`);
    const result=process.argv.find(a=>a.startsWith('--lab-evidence='))?.slice('--lab-evidence='.length);
    if(!evidence.renderer.hasLogin||evidence.renderer.nodeExposed)throw Error('Renderer fora do contrato de segurança.');
    await window.webContents.executeJavaScript(`document.querySelector('input[name=login]').value=${JSON.stringify(smokeAccount.login)};document.querySelector('input[name=password]').value=${JSON.stringify(smokeAccount.password)};document.querySelector('form').requestSubmit();`);
    stage='authenticated-sectors';
    await waitFor("document.body.textContent.includes('FICTICIO Setor do aplicativo')");
    evidence.authenticated=true;
    evidence.cloudIndicator=await window.webContents.executeJavaScript("document.querySelector('[aria-label^=\"Nuvem:\"]')?.getAttribute('aria-label')");
    if(result){
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Alternar claro/escuro')).click()");
      await new Promise(r=>setTimeout(r,200));
      await fs.writeFile(result+'.theme-a.png',(await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Alternar claro/escuro')).click()");
      await new Promise(r=>setTimeout(r,200));
      await fs.writeFile(result+'.theme-b.png',(await window.webContents.capturePage()).toPNG());
      stage='employees-route';
      await window.loadURL(localOrigin+'/funcionarios');
      await waitFor("document.body.textContent.includes('Novo colaborador')");
      evidence.originalEmployeesPage=true;
      stage='settings-route';
      await window.loadURL(localOrigin+'/configuracoes');
      await waitFor("document.body.textContent.includes('Configurações')");
      evidence.originalSettingsPage=true;
      stage='stock-route';
      await window.loadURL(localOrigin+'/estoque');
      await waitFor("document.body.textContent.includes('Novo item')");
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Novo item')).click()");
      await waitFor("!!document.querySelector('[role=dialog] input')");
      await window.webContents.executeJavaScript(`(()=>{const fields=document.querySelector('[role=dialog]').querySelectorAll('input');const set=(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));};set(fields[0],'FICTICIO Estoque desktop');set(fields[3],'2');})()`);
      await new Promise(r=>setTimeout(r,100));
      await window.webContents.executeJavaScript("[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b=>b.textContent.includes('Salvar item')).click()");
      await waitFor("!document.querySelector('[role=dialog]')&&document.body.textContent.includes('FICTICIO Estoque desktop')");
      const persisted=core.poolFor(await env.config());
      try{
        const b=(await persisted.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[smokeAccount.id])).rows;
        if(b.length!==1||b[0].quantity_milli!=='2000')throw Error('Saldo do formulário não persistiu.');
        evidence.originalStockPage={created:true,quantityMilli:2000};
        if(process.argv.includes('--lab-employee-smoke')){
          stage='employee-forms';const {employeeSmoke}=await import('./employee-smoke.mjs');
          evidence.employee=await employeeSmoke(window,waitFor,localOrigin,persisted,smokeAccount.id);
        }
        if(process.argv.includes('--lab-domain-smoke')){
          stage='domain-forms';const {domainSmoke}=await import('./domain-smoke.mjs');
          evidence.domains=await domainSmoke(window,waitFor,localOrigin,persisted,smokeAccount.id);
        }
        if(process.argv.includes('--lab-payroll-smoke')){
          stage='payroll-forms';const {payrollSmoke}=await import('./payroll-smoke.mjs');
          const {catalogSave}=await import(pathToFileURL(path.join(root,'server/d1-lab/catalog.mjs')));
          evidence.payroll=await payrollSmoke(window,waitFor,localOrigin,persisted,smokeAccount.id,{catalogSave,marker});
        }
        if(process.argv.includes('--lab-attachments-smoke')){
          stage='attachment-forms';const signalFile=process.argv.find(a=>a.startsWith('--lab-attachment-ready='))?.slice('--lab-attachment-ready='.length);
          const {attachmentSmoke}=await import('./attachment-smoke.mjs');
          evidence.attachments=await attachmentSmoke({window,pool:persisted,actor:smokeAccount.id,signalFile});
        }
        if(process.argv.includes('--lab-rh-smoke')){
          stage='rh-forms';const {rhSmoke}=await import('./rh-smoke.mjs');
          const {catalogSave}=await import(pathToFileURL(path.join(root,'server/d1-lab/catalog.mjs')));
          const {domainCommand}=await import(pathToFileURL(path.join(root,'server/d1-lab/domain.mjs')));
          evidence.rh=await rhSmoke(window,waitFor,localOrigin,persisted,smokeAccount.id,{catalogSave,domainCommand,marker});
        }
        if(process.argv.includes('--lab-autonomy-smoke')){
          stage='autonomy-recovery';
          if(process.env.RUY_D1_ALLOW_TESTS!=='1'||!worker)throw Error('Ensaio H exige API própria e opt-in.');
          const {autonomySmoke}=await import('./autonomy-smoke.mjs');
          evidence.autonomy=await autonomySmoke({window,waitFor,origin:localOrigin,pool:persisted,actor:smokeAccount.id,credentials:smokeAccount,recover:()=>supervisor.recover(),
           crashApi:async()=>{const owned=worker;await new Promise(resolve=>{owned.once('exit',resolve);owned.kill();});},
           crashPostgres:()=>env.pgCommand(marker.bin,'pg_ctl',['-D',env.cluster,'-m','immediate','-w','stop']),
          });
        }
      }finally{await persisted.end();}
    }
    if(result) await fs.writeFile(result,JSON.stringify(evidence,null,2),{flag:'wx'});
    app.quit(); return;
  }
  timer=setInterval(()=>supervisor.recover(),15000);
}
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(start).catch(async e=>{
    console.error('DESKTOP_LAB_BLOCKED',stage,e.code||e.name,smoke?e.message:'');
    const result=process.argv.find(a=>a.startsWith('--lab-evidence='))?.slice('--lab-evidence='.length);
    if(smoke&&result)await fs.writeFile(result+'.failure.json',JSON.stringify({stage,errorName:e.name,errorCode:e.code||null,revision:evidence.revision})).catch(()=>{});
    if(!smoke) dialog.showErrorBox('Sistema de Gestão Ruy — laboratório indisponível', 'Não foi possível validar PostgreSQL e API do laboratório. Prepare o ambiente D1 do usuário Windows atual e tente novamente. Nenhum dado foi removido e a produção 8080 não foi alterada.');
    process.exitCode=1;app.quit();
  });
  app.on('window-all-closed',()=>{if(!preparing)app.quit();});
  app.on('before-quit',event=>{
    supervisor?.close();
    clearInterval(timer);clearInterval(backupTimer);
    if(closing)return;
    event.preventDefault();closing=true;
    void (async()=>{
      try{await backupFlight;}finally{
        const owned=worker;
        if(owned)await new Promise(resolve=>{owned.once('exit',resolve);owned.postMessage({type:'shutdown'});});
        app.quit();
      }
    })();
  });
}
