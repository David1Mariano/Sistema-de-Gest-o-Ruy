// Stable installed product identity, distinct client data/profile; never boots PG.
if(process.env.RUY_D1_INSTALLATION||process.env.RUY_D1_RESTART_FIXTURE)throw Error('SHARED_CLIENT_ENV_CONFLICT');
import('./shared-main.mjs').catch(()=>{require('electron').app.quit();});
