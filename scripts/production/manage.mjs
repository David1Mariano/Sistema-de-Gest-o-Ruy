import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { productionHome, state, inspectBuild, prepareBuild, atomicJson, activate } from './store.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(scripts, '../..');
const runtime = path.join(productionHome, 'runtime');
const command = process.argv[2];
const node = process.execPath;
function run(args) {
  const result = spawnSync(node, args, { cwd: project, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw Error('Verificação/build falhou. A versão ativa não foi alterada.');
}
async function installRuntime() {
  await fs.mkdir(runtime, { recursive: true });
  for (const name of ['store.mjs', 'server.mjs', 'supervisor.mjs']) {
    try { await fs.copyFile(path.join(scripts, name), path.join(runtime, name), 1); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
}

try {
  await fs.mkdir(productionHome, { recursive: true });
  if (command === 'start') {
    await state(productionHome);
    await installRuntime();
    try {
      const response = await fetch('http://127.0.0.1:8080/__health', { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.json()).service === 'gestao-ruy-production') {
        console.log('Produção já está ativa.'); process.exit(0);
      }
      throw Error('A porta 8080 responde por outro serviço; não foi alterada.');
    } catch (error) { if (!['TypeError', 'TimeoutError'].includes(error.name)) throw error; }
    const child = spawn(node, [path.join(runtime, 'supervisor.mjs')], {
      detached: true, windowsHide: true, stdio: 'ignore', cwd: runtime,
    });
    child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      try {
        const response = await fetch('http://127.0.0.1:8080/__health', { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.json()).service === 'gestao-ruy-production') { ready = true; break; }
      } catch { /* Aguarda somente a nova instância. */ }
    }
    if (!ready) throw Error('Servidor não confirmou saúde. Consulte logs/server.log.');
    console.log('Produção iniciada e saudável na porta 8080.');
  } else if (command === 'status') {
    console.log(await state(productionHome));
    const response = await fetch('http://127.0.0.1:8080/__health', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw Error('Produção indisponível.');
    console.log(await response.json());
  } else if (command === 'publish' || command === 'rollback') {
    const lockPath = path.join(productionHome, 'publish.lock');
    const lock = await fs.open(lockPath, 'wx');
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    try {
      if (command === 'rollback') {
        const before = await state(productionHome);
        if (!before.previous) throw Error('Não há versão anterior publicada.');
        console.log('Rollback concluído:', await activate(productionHome, before.previous));
      } else {
        // Todos os testes executáveis do projeto, sem acessar/migrar dados reais.
        const tests = (await fs.readdir(path.join(project, 'scripts'))).filter(name => /^test-.*\.mjs$/.test(name)).map(name => `scripts/${name}`);
        run(['--test', ...tests]);
        const npm = process.env.npm_execpath || path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js');
        run([npm, 'run', 'lint']);
        const id = new Date().toISOString().replace(/[-:.]/g, '') + '-' + randomUUID().slice(0, 8);
        const release = path.join(productionHome, 'releases', id);
        const site = path.join(release, 'site');
        await fs.mkdir(site, { recursive: true });
        // Mesmo build Vite, mas saída exclusiva: npm run build/dist nunca afeta produção.
        run([npm, 'run', 'build', '--', '--outDir', site, '--base', `/releases/${id}/`]);
        await prepareBuild(site);
        const manifest = await inspectBuild(site, id);
        await atomicJson(path.join(release, 'manifest.json'), manifest);
        await installRuntime();
        console.log('Publicação concluída:', await activate(productionHome, id));
      }
    } finally { await lock.close(); await fs.unlink(lockPath); }
  } else throw Error('Use publish, rollback, start ou status.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Outra publicação está em execução (publish.lock). Não houve troca de versão.' : error.message);
  process.exitCode = 1;
}
