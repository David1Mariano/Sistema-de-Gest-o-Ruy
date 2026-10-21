const {app,dialog}=require('electron');const path=require('node:path');const {startupLog}=require('./startup-log.cjs');
const revision='RUY-WINDOWS-CANDIDATE-20261021',id='windows-candidate-20261021';const profile=path.join(app.getPath('appData'),'SistemaGestaoRuy-'+id);app.setPath('userData',profile);
try{
 if(require('./package.json').ruyRevision!==revision)throw Error('CANDIDATE_ID_INVALID');
 for(const [key,value] of Object.entries({RUY_D1_ALLOW_TESTS:'1',RUY_D1_INSTALLATION:id,RUY_D1_TEST_API_PORT:'18143',RUY_D1_BREVO_ENABLED:'1'})){if(process.env[key]!==undefined&&process.env[key]!==value)throw Error('CANDIDATE_ENV_CONFLICT');process.env[key]=value;}
 if(process.env.RUY_D1_RESTART_FIXTURE)throw Error('CANDIDATE_ENV_CONFLICT');
 import(process.argv.includes('--candidate-preflight')?'./candidate-preflight.mjs':'./main.mjs').catch(fail);
}catch(error){fail(error);}
function fail(error){startupLog(profile,revision,'entry-failed','entry',error);app.whenReady().then(()=>{dialog.showErrorBox('Sistema Ruy — candidata bloqueada','A candidata não confirmou seu isolamento. Dados e instalações anteriores foram preservados. Consulte o registro local de inicialização.');app.exit(1);});}
