import fs from 'node:fs/promises';
import path from 'node:path';
import {config,validateHome,home,API_PORT} from './environment.mjs';
import {poolFor} from './core.mjs';
import {createServer} from './api.mjs';
const marker=await validateHome();
const pool=poolFor(await config());
const device=(await pool.query('SELECT id FROM lab_device WHERE singleton')).rows[0];
if(device?.id!==marker.deviceId)throw Error('Identidade do banco e dispositivo divergem.');
const server=createServer(pool,device.id);
server.on('error',()=>{console.error('API do laboratório não iniciou. Porta/estado indisponível.');pool.end().finally(()=>process.exit(1));});
server.listen(API_PORT,'127.0.0.1',async()=>{
  await fs.writeFile(path.join(home,'api.pid'),String(process.pid));
  console.log(`Laboratório sintético em http://127.0.0.1:${API_PORT}; sincronização desligada.`);
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  server.close(()=>pool.end().finally(()=>process.exit(0)));server.closeAllConnections();
});
