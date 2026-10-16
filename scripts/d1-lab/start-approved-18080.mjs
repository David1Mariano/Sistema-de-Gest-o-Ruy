import net from 'node:net';
import path from 'node:path';
if(!process.argv.includes('--normal-stop-confirmed'))throw Error('Confirme antes o encerramento NORMAL da API antiga. Nenhum processo será encerrado por este script.');
const probe=net.createServer();
await new Promise((resolve,reject)=>{probe.once('error',()=>reject(Error('18080 ocupada; substituição recusada.')));probe.listen(18080,'127.0.0.1',resolve);});
await new Promise(resolve=>probe.close(resolve));
process.env.RUY_LOCAL_CONFIG=process.env.RUY_LOCAL_CONFIG||path.join(process.env.LOCALAPPDATA,'GestaoRuy','dev-core','db-config.json');
process.env.RUY_LOCAL_PORT='18080';process.env.RUY_D1_BRIDGE_TEST='1';process.env.RUY_D1_CENTRAL_TEST_PORT='18090';
await import('../../lab/c2-runtime/scripts/local-api-supervisor.mjs');
