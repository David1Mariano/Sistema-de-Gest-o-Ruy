import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {powershell,installation} from './environment.mjs';
import {createHistoryReader} from './history-readonly.mjs';

export async function loadHistoryProfile(){
 const id=process.env.RUY_HISTORY_PROFILE_ID;if(!id)return null;
 if(installation?.id!=='history-view-dev-20261020'||!/^history-[a-z0-9-]{8,80}$/.test(id))throw Error('HISTORY_PROFILE_SCOPE_REFUSED');
 const root=path.join(process.env.LOCALAPPDATA,'GestaoRuy','history-view-profiles',id);
 if((await fs.realpath(root)).toLowerCase()!==path.resolve(root).toLowerCase())throw Error('HISTORY_PROFILE_REDIRECTION_REFUSED');
 const encrypted=await fs.readFile(path.join(root,'profile.dpapi'),'utf8');
 const config=JSON.parse(powershell("$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}",encrypted));
 if(config.purpose!=='RUY_REAL_HISTORY_READONLY'||config.project!=='wvcvveqdkecsoygtilop'||config.profileId!==id||config.connection.host!=='127.0.0.1'||config.connection.port!==55463||!/^ruy_history_view_[a-f0-9]{12}$/.test(config.connection.database)||!/^ruy_history_view_[a-f0-9]{12}_reader$/.test(config.connection.user))throw Error('HISTORY_PROFILE_TARGET_REFUSED');
 const pool=new pg.Pool({...config.connection,max:3,connectionTimeoutMillis:5000,statement_timeout:5000,application_name:'ruy-history-readonly'});
 pool.on('error',()=>{});
 const history=createHistoryReader({pool,grants:config.grants});
 try{await history.verify();const source=(await pool.query('SELECT project FROM historical_view.source_info')).rows;if(source.length!==1||source[0].project!==config.project)throw Error('HISTORY_SOURCE_INVALID');return history;}catch{await history.close();throw Error('HISTORY_PROFILE_UNAVAILABLE');}
}
