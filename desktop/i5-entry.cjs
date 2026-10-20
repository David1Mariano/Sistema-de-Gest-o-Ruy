// Configure this experimental process before importing ESM transport policy.
const fs=require('node:fs'),path=require('node:path'),{app,dialog}=require('electron');
const {configureI5Environment}=require('./i5-environment.cjs');
const {startupLog}=require('./startup-log.cjs');
const revision='A5-I5-R2-20261020';
const profile=path.join(app.getPath('appData'),'SistemaGestaoRuy-Agente5-I5R2-Homolog');
app.setPath('userData',profile);
const log=(event,error)=>startupLog(profile,revision,event,'entry',error);
try{
 const metadata=JSON.parse(fs.readFileSync(path.join(__dirname,'package.json'),'utf8'));
 if(metadata.ruyRevision!==revision)throw Error('CANDIDATE_ID_INVALID');
 const actual=path.join(process.env.LOCALAPPDATA||'', 'GestaoRuy','agente5-restart-e5aaec701010f607');
 if(!path.isAbsolute(actual)||path.resolve(fs.realpathSync(actual)).toLowerCase()!==path.resolve(actual).toLowerCase())throw Error('LAB_PATH_INVALID');
 configureI5Environment(process.env,JSON.parse(fs.readFileSync(path.join(actual,'lab.json'),'utf8')));
 log('entry-ready');
 import('./main.mjs').catch(fail);
}catch(error){fail(error);}
function fail(error){
 log('entry-failed',error);
 app.whenReady().then(()=>{
  if(!process.argv.includes('--lab-startup-failure-test'))dialog.showErrorBox('I5 R2 — homologação bloqueada','Não foi possível validar o laboratório autorizado. Consulte startup.jsonl no perfil I5R2. Nenhum banco foi recriado.');
  app.exit(1);
 });
}
