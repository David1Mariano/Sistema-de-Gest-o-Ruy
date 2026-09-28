import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProductionServer, localPeer } from './production/server.mjs';
import { activate, inspectBuild, prepareBuild, atomicJson, state } from './production/store.mjs';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ruy-prod-test-'));
  t.after(async () => {
    const resolved = path.resolve(home);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ruy-prod-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const build = async (id, text = id) => {
    const site = path.join(home, 'releases', id, 'site');
    await fs.mkdir(path.join(site, 'assets'), { recursive: true });
    await fs.writeFile(path.join(site, 'index.html'), `<html>${text}<script src="/releases/${id}/assets/app.js"></script></html>`);
    await fs.writeFile(path.join(site, 'assets/app.js'), `console.log('${text}')`);
    await atomicJson(path.join(home, 'releases', id, 'manifest.json'), await inspectBuild(site, id));
    return site;
  };
  return { home, build };
}

test('Produção: rotas SPA, assets versionados, HEAD, arquivos privados bloqueados e métodos restritos', async t => {
  const { home, build } = await fixture(t);
  await build('v1'); await activate(home, 'v1');
  const server = createProductionServer({ home });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const route of ['/', '/login', '/Financeiro', '/funcionarios/123']) {
      const res = await fetch(base + route);
      assert.equal(res.status, 200); assert.match(await res.text(), /<html>v1/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    for (const route of ['/.env', '/.git/config', '/src/App.jsx', '/node_modules/x', '/scripts/admin.ps1', '/assets/missing.js', '/assets/app.js.map', '/manifest.json', '/releases/v1/manifest.json', '/%2e%2e%5c.env', '/%00']) {
      const res = await fetch(base + route);
      assert.ok([400, 404].includes(res.status), route);
      assert.doesNotMatch(await res.text(), /<html>/);
    }
    const asset = await fetch(base + '/releases/v1/assets/app.js');
    assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
    assert.equal(await (await fetch(base + '/', { method: 'HEAD' })).text(), '');
    assert.equal((await (await fetch(base + '/__health')).json()).release, 'v1');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Publicação/rollback sem reinício; falha preserva versão ativa; assets antigos continuam disponíveis', async t => {
  const { home, build } = await fixture(t);
  await build('v1'); await activate(home, 'v1');
  const server = createProductionServer({ home });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await build('v2');
    // Construir/editar um candidato não publica nada.
    assert.match(await (await fetch(base)).text(), /<html>v1/);
    await activate(home, 'v2');
    assert.equal((await state(home)).previous, 'v1');
    assert.match(await (await fetch(base)).text(), /<html>v2/);
    assert.equal((await fetch(base + '/releases/v1/assets/app.js')).status, 200);
    await assert.rejects(activate(home, 'inexistente'));
    const broken = await build('broken');
    await fs.writeFile(path.join(broken, 'assets/app.js'), 'alterado depois da validação');
    await assert.rejects(activate(home, 'broken'));
    assert.equal((await state(home)).current, 'v2');
    await activate(home, (await state(home)).previous);
    assert.match(await (await fetch(base)).text(), /<html>v1/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Build recusa arquivos privados, mapas de código e credencial service_role sem imprimir segredo', async t => {
  const { build } = await fixture(t);
  for (const name of ['.env', 'source.map', 'admin.ps1']) {
    const site = await build('invalid-' + name.replace(/\W/g, ''));
    await fs.writeFile(path.join(site, name), 'fixture');
    await assert.rejects(inspectBuild(site, 'candidate'));
  }
  const site = await build('secret');
  const fake = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  await fs.writeFile(path.join(site, 'assets/app.js'), `eyJhbGciOiJIUzI1NiJ9.${fake}.testsignature`);
  await assert.rejects(inspectBuild(site, 'secret'), /service_role/);
});

test('Acesso somente loopback ou sub-rede privada diretamente conectada', () => {
  const nets = { Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.106', netmask: '255.255.255.0' }] };
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.20']) assert.equal(localPeer(ip, nets), true);
  for (const ip of ['8.8.8.8', '192.168.2.20', '10.0.0.10', '::abcd', undefined]) assert.equal(localPeer(ip, nets), false);
});

test('Referência preexistente a manifest ausente é removida apenas do build publicado', async t => {
  const { build } = await fixture(t);
  const site = await build('manifest-check');
  const file = path.join(site, 'index.html');
  await fs.appendFile(file, '<link rel="manifest" href="/manifest.json" />');
  await prepareBuild(site);
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /manifest.json/);
  await inspectBuild(site, 'manifest-check');
});
