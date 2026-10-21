import pg from 'pg';
import {installation,unseal} from './environment.mjs';
import {createOperationalHistory} from './operational-history.mjs';
export async function loadOperationalHistory(){
 if(!installation?.recoveredPreview)return null;
 const profile=await unseal('recovered-source.dpapi');
 if(profile.purpose!=='RUY_ISOLATED_RECOVERED_CANDIDATE'||profile.installationId!==installation.id||profile.config?.host!=='127.0.0.1'||profile.config.port!==55463||!/^ruy_operational_trial_[a-f0-9]{12}$/.test(profile.config.database)||!/^ruy_import_[a-f0-9]{16}_reader$/.test(profile.config.user))throw Error('RECOVERED_SOURCE_PROFILE_REFUSED');
 const pool=new pg.Pool({...profile.config,connectionTimeoutMillis:3000});
 try{const reader=createOperationalHistory({pool,grants:profile.grants});await reader.verify();return {...reader,close:()=>pool.end()};}catch(error){await pool.end();throw error;}
}
