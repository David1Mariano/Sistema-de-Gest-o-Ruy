import {Menu,dialog} from 'electron';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {recoveryPrompt} from './recovery.mjs';
export function installLabMenu(root,window,{recover}={}){
 const load=()=>import(pathToFileURL(path.join(root,'server/d1-lab/backup.mjs')));
 const report=async task=>{try{await task();}catch{await dialog.showMessageBox(window,{type:'error',message:'Operação de laboratório não concluída.',detail:'Os dados existentes foram preservados. Verifique o destino, espaço disponível e o estado do PostgreSQL.'});}};
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  {label:process.env.RUY_D1_INSTALLATION==='windows-operational'?'Sistema Ruy':'Laboratório',submenu:[
   {label:'Tentar recuperar serviços locais',click:()=>report(async()=>{if(!await recover?.())throw Error('Recuperação indisponível.');})},
   {label:'Configurar destino de cópia do backup...',click:()=>report(async()=>{
    const selected=await dialog.showOpenDialog(window,{title:'Destino configurável de backup criptografado',properties:['openDirectory','createDirectory']});
    if(selected.canceled)return;
    await (await load()).configureExternalBackup(selected.filePaths[0]);
    await dialog.showMessageBox(window,{message:'Destino configurado.',detail:'A próxima cópia será verificada por hash. Recuperação da chave em outro Windows e proteção contra perda física continuam pendentes.'});
   })},
   {label:'Criar backup criptografado agora',click:()=>report(async()=>{
    const api=await load(),settings=await api.backupConfig(),result=await api.backup({retain:settings.retain,preserveExisting:true});
    await dialog.showMessageBox(window,{message:'Backup local criptografado criado.',detail:result.externalState==='verified-copy'?'Cópia no destino configurado verificada por hash. Recuperação independente da chave ainda pendente.':result.externalError||'Destino externo ainda não configurado.'});
   })},
   {label:'Testar restauração isolada do último backup',click:()=>report(async()=>{
    const api=await load(),status=await api.backupStatus();
    const {home}=await import(pathToFileURL(path.join(root,'server/d1-lab/environment.mjs')));
    if(!status.file)throw Error('Sem backup');
    const restored=await api.restoreIsolated(path.join(home,'backups',status.file));
    await dialog.showMessageBox(window,{message:'Restauração de teste validada.',detail:`Banco isolado: ${restored.database}. ${restored.recoveryTablesVerified} tabelas verificadas; sincronização desativada. O banco ativo não foi substituído.`});
   })},
   {label:'Exportar chave de recuperação protegida...',click:()=>report(async()=>{
    const chosen=await dialog.showSaveDialog(window,{title:'Chave protegida — guardar fora do computador',defaultPath:'laboratorio.ruykey',filters:[{name:'Chave protegida Ruy',extensions:['ruykey']}]});if(chosen.canceled)return;
    const api=await load();
    await recoveryPrompt(window,path.dirname(fileURLToPath(import.meta.url)), 'export', phrase=>api.exportRecoveryKey(chosen.filePath,phrase));
    await dialog.showMessageBox(window,{message:'Chave exportada com proteção por frase.',detail:'Guarde a frase separadamente. A proteção só estará validada após restauração com esses arquivos no ambiente de destino.'});
   })},
   {label:'Restaurar backup externo em banco isolado...',click:()=>report(async()=>{
    const chosen=await dialog.showOpenDialog(window,{title:'Selecionar backup criptografado',properties:['openFile'],filters:[{name:'Backup Ruy',extensions:['ruybak']}]});if(chosen.canceled)return;
    const key=await dialog.showOpenDialog(window,{title:'Selecionar chave de recuperação protegida',properties:['openFile'],filters:[{name:'Chave Ruy',extensions:['ruykey']}]});if(key.canceled)return;
    const api=await load();
    const restored=await recoveryPrompt(window,path.dirname(fileURLToPath(import.meta.url)),'restore',phrase=>api.restoreWithRecovery(chosen.filePaths[0],key.filePaths[0],phrase));
    await dialog.showMessageBox(window,{message:'Recuperação externa validada em banco isolado.',detail:`Banco novo: ${restored.database}. Ativação e sincronização bloqueadas; reconcile dispositivos e fila antes de qualquer migração.`});
   })},
   {type:'separator'},{role:'quit',label:'Sair'},
  ]},
  {label:'Exibir',submenu:[{role:'reload',label:'Recarregar'},{role:'togglefullscreen',label:'Tela cheia'}]},
 ]));
}
