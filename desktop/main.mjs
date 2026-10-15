import {app, BrowserWindow, dialog, session, utilityProcess} from 'electron';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {allowedNavigation, localOrigin, webPreferences} from './policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = app.isPackaged ? app.getAppPath() : path.resolve(here, '..');
app.setName('Sistema de Gestão Ruy');
// Namespace exclusivo: não usa sessão, cache ou cluster operacional.
app.setPath('userData', path.join(app.getPath('appData'), 'SistemaGestaoRuy-Lab'));
app.setAppUserModelId('br.ruy.gestao.laboratorio');
let worker, window, timer, closing = false;
let backupTimer,backupFlight,smokeAccount;
let stage='startup';
const smoke = process.argv.includes('--lab-smoke');
const evidence = {purpose:'RUY_DESKTOP_SYNTHETIC_ONLY', packaged:app.isPackaged};
async function health() {
  const r = await fetch(localOrigin+'/health', {signal:AbortSignal.timeout(1500), redirect:'error'});
  const value = await r.json();
  if (!r.ok || value.service!=='ruy-d1-lab' || value.mode!=='synthetic-only' || value.syncEnabled!==false) throw Error('A porta do laboratório está ocupada por outro serviço.');
  return value;
}
async function start() {
  stage='environment';
  const env = await import(pathToFileURL(path.join(root, 'server/d1-lab/environment.mjs')));
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
      evidence.syntheticActor=id;
      const {save}=await import(pathToFileURL(path.join(root,'server/d1-lab/entities.mjs')));
      await save(pool,{id,role:'admin'},marker.deviceId,'Sector',randomUUID(),{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO Setor do aplicativo',description:'Cadastro sintético para homologação visual',status:'ativo'}});
    }
  } finally { await pool.end(); }
  // PostgreSQL é dependência verificada. Não instala serviços nem cria cluster
  // silenciosamente; o laboratório deve ter sido preparado explicitamente.
  let available = false;
  stage='api';
  try { await health(); available=true; }
  catch (e) { if (!(e instanceof TypeError) && e.name!=='TimeoutError') throw e; }
  if (!available) {
    worker = utilityProcess.fork(path.join(here, 'service.mjs'), [], {
      env:{...process.env, RUY_DESKTOP_ROOT:root}, stdio:'pipe', serviceName:'Ruy API laboratório',
    });
    worker.on('exit', () => { if(!closing && window) dialog.showErrorBox('API local indisponível', 'A API do laboratório foi encerrada. Seus dados permanecem no PostgreSQL. Feche e reabra o aplicativo após verificar o laboratório.'); });
    for(let attempt=0;attempt<40;attempt++) {
      await new Promise(r=>setTimeout(r,250));
      try { await health(); available=true; break; } catch { /* Aguarda API própria. */ }
    }
    if(!available) throw Error('API local não iniciou. Verifique dependências e disponibilidade da porta 18087.');
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
  browserSession.on('will-download', event=>event.preventDefault());
  window = new BrowserWindow({title:'Sistema de Gestão Ruy — Laboratório',width:1366,height:900,minWidth:900,minHeight:640,
    show:!smoke,icon:path.join(here,'assets/ruy.ico'),webPreferences:{...webPreferences,session:browserSession,backgroundThrottling:!smoke}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate', (event,url)=>{if(!allowedNavigation(url))event.preventDefault();});
  window.webContents.on('will-redirect', (event,url)=>{if(!allowedNavigation(url))event.preventDefault();});
  window.webContents.on('will-attach-webview', event=>event.preventDefault());
  stage='load-window';
  await window.loadURL(localOrigin+'/setores');
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
      }finally{await persisted.end();}
    }
    if(result) await fs.writeFile(result,JSON.stringify(evidence,null,2),{flag:'wx'});
    app.quit(); return;
  }
  timer=setInterval(()=>health().catch(()=>window?.setTitle('Sistema de Gestão Ruy — API local indisponível')),15000);
}
if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(start).catch(e=>{
    console.error('DESKTOP_LAB_BLOCKED',stage,e.code||e.name,smoke?e.message:'');
    if(!smoke) dialog.showErrorBox('Sistema de Gestão Ruy — laboratório indisponível', 'Não foi possível validar PostgreSQL e API do laboratório. Prepare o ambiente D1 do usuário Windows atual e tente novamente. Nenhum dado foi removido e a produção 8080 não foi alterada.');
    process.exitCode=1;app.quit();
  });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{
    clearInterval(timer);clearInterval(backupTimer);
    if(!closing&&backupFlight){event.preventDefault();closing=true;backupFlight.finally(()=>{worker?.kill();app.quit();});return;}
    closing=true;worker?.kill();
  });
}
