import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, statSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { productionHome } from './store.mjs';

const runtime = path.dirname(fileURLToPath(import.meta.url));
const logs = path.join(productionHome, 'logs');
mkdirSync(logs, { recursive: true });
let child, stopping = false;
function start() {
  const log = path.join(logs, 'server.log');
  if (existsSync(log) && statSync(log).size > 5 * 1024 * 1024) renameSync(log, path.join(logs, `server-${Date.now()}.log`));
  const fd = openSync(log, 'a');
  child = spawn(process.execPath, [path.join(runtime, 'server.mjs')], { cwd: runtime, windowsHide: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.on('error', () => { if (!stopping) setTimeout(start, 5000); });
  child.on('exit', code => {
    if (stopping) process.exit(0);
    if (code === 20) { console.error('Porta 8080 ocupada; nenhuma instância foi encerrada.'); process.exit(1); }
    setTimeout(start, 5000);
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(); });
start();
