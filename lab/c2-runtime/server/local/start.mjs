import fs from 'node:fs/promises';
import { createPool } from './core.mjs';
import { createLocalServer } from './api.mjs';
if (!process.env.RUY_LOCAL_CONFIG) throw Error('Set RUY_LOCAL_CONFIG to protected development config.');
const pool = createPool(JSON.parse(await fs.readFile(process.env.RUY_LOCAL_CONFIG,'utf8')));
await pool.query('SELECT 1 FROM local_activation LIMIT 1');
const port=Number(process.env.RUY_LOCAL_PORT||18080);
if(![18080,18089].includes(port))throw Error('Only laboratory ports permitted.');
const origin = process.env.RUY_LOCAL_ORIGIN || `http://127.0.0.1:${port}`;
if (![`http://127.0.0.1:${port}`,'http://127.0.0.1:5180'].includes(origin)) throw Error('Only isolated development origins permitted.');
const centralPort=Number(process.env.RUY_D1_CENTRAL_TEST_PORT||18086);
if(![18086,18090].includes(centralPort))throw Error('Only synthetic central ports permitted.');
const server = createLocalServer(pool,{origin,d1BridgeOrigin:process.env.RUY_D1_BRIDGE_TEST==='1'?`http://127.0.0.1:${centralPort}`:undefined});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port,'127.0.0.1',()=>console.log(`Local DEVELOPMENT API: http://127.0.0.1:${port}/api/local/me`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{ await pool.end(); process.exit(0); }));
// Only a parent with an explicit pipe can request controlled shutdown.
if (!process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  let input='';
  process.stdin.on('data',chunk=>{
    input+=chunk;
    if(input.includes('\n')&&input.trim()==='shutdown')server.close(async()=>{await pool.end();process.exit(0);});
    if(input.length>64)input='';
  });
}
