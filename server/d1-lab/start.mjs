import fs from 'node:fs/promises';
import path from 'node:path';
import {config,validateHome,home,API_PORT,installation} from './environment.mjs';
import {poolFor} from './core.mjs';
import {createServer} from './api.mjs';
import {loadHistoryProfile} from './history-profile.mjs';
import {loadIdentity} from './identity-profile.mjs';
const marker=await validateHome();
const pool=poolFor(await config());
const device=(await pool.query('SELECT id FROM lab_device WHERE singleton')).rows[0];
if(device?.id!==marker.deviceId)throw Error('Identidade do banco e dispositivo divergem.');
let history,identity;
try{
 history=await loadHistoryProfile();
 if(installation?.historyOnly&&!history)throw Error('HISTORY_PROFILE_REQUIRED');
 identity=await loadIdentity(pool);
}catch(error){await Promise.all([pool.end(),history?.close()]);throw error;}
const server=createServer(pool,device.id,{history,historyOnly:Boolean(history),identity});
server.on('error',()=>{console.error('API do laboratório não iniciou. Porta/estado indisponível.');Promise.all([pool.end(),history?.close()]).finally(()=>process.exit(1));});
server.listen(API_PORT,'127.0.0.1',async()=>{
  await fs.writeFile(path.join(home,'api.pid'),String(process.pid));
  console.log(history?`Perfil histórico somente leitura em http://127.0.0.1:${API_PORT}; sincronização desligada.`:`Laboratório sintético em http://127.0.0.1:${API_PORT}; sincronização desligada.`);
});
let shutdownFlight;
export function shutdown(){
 if(!shutdownFlight)shutdownFlight=new Promise(resolve=>server.close(resolve)).then(()=>Promise.all([pool.end(),history?.close()]));
 return shutdownFlight;
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>shutdown().then(()=>process.exit(0)));
