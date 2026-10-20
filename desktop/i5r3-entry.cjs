const {app,dialog}=require('electron');
const path=require('node:path');
const {startupLog}=require('./startup-log.cjs');
const revision='A5-I5-R3-20261020',id='i5r3-20261020';
const profile=path.join(app.getPath('appData'),'SistemaGestaoRuy-'+id);
app.setPath('userData',profile);
try{
 const metadata=require('./package.json');
 if(metadata.ruyRevision!==revision)throw Error('CANDIDATE_ID_INVALID');
 const required={RUY_D1_ALLOW_TESTS:'1',RUY_D1_INSTALLATION:id,RUY_D1_TEST_API_PORT:'18103'};
 for(const [key,value] of Object.entries(required)){
  if(process.env[key]!==undefined&&process.env[key]!==value)throw Error('LAB_ENV_CONFLICT');
  process.env[key]=value;
 }
 if(process.env.RUY_D1_RESTART_FIXTURE)throw Error('LAB_ENV_CONFLICT');
 delete process.env.RUY_D1_DELIVERY_LAB;delete process.env.RUY_D1_DELIVERY_UI;
 import('./main.mjs').catch(fail);
}catch(error){fail(error);}
function fail(error){
 startupLog(profile,revision,'entry-failed','entry',error);
 app.whenReady().then(()=>{if(!process.argv.includes('--lab-startup-failure-test'))dialog.showErrorBox('I5 R3 bloqueada','Isolamento indisponível. Consulte startup.jsonl. Dados preservados.');app.exit(1);});
}
