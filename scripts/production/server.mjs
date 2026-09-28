import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { productionHome, state, verifyRelease, mime, safeFile, validId } from './store.mjs';

const ipv4 = ip => ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
export function localPeer(address, interfaces = os.networkInterfaces()) {
  const ip = address?.replace(/^::ffff:/, '');
  if (ip === '::1' || /^127\./.test(ip)) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip || '')) return false;
  return Object.values(interfaces).flat().some(net => net && net.family === 'IPv4' && !net.internal &&
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address) &&
    (ipv4(ip) & ipv4(net.netmask)) === (ipv4(net.address) & ipv4(net.netmask)));
}

export function createProductionServer({ home = productionHome, enforceLocal = true } = {}) {
  const versions = new Map();
  const release = async id => {
    if (!versions.has(id)) versions.set(id, await verifyRelease(home, id));
    return versions.get(id);
  };
  const server = http.createServer(async (req, res) => {
    const fail = code => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(http.STATUS_CODES[code]); };
    try {
      if (enforceLocal && !localPeer(req.socket.remoteAddress)) return fail(403);
      if (!['GET', 'HEAD'].includes(req.method)) return fail(405);
      const raw = decodeURIComponent(req.url.split('?')[0]);
      if (!raw.startsWith('/') || /[\\\x00-\x1f:]/.test(raw) || raw.split('/').some(p => p.startsWith('.'))) return fail(400);
      if (/^\/(?:src|scripts|node_modules|api|@vite|@fs)(?:\/|$)/i.test(raw)) return fail(404);
      const current = await state(home);
      if (raw === '/__health') {
        await release(current.current);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ service: 'gestao-ruy-production', release: current.current }));
      }
      let id = current.current, name = raw.slice(1), versioned = false;
      if (raw.startsWith('/releases/')) {
        const parts = name.split('/');
        id = parts[1]; name = parts.slice(2).join('/'); versioned = true;
        if (!validId(id) || !safeFile(name)) return fail(404);
      }
      let build;
      try { build = await release(id); } catch (error) { if (versioned && error.code === 'ENOENT') return fail(404); throw error; }
      if (!Object.hasOwn(build.files, name)) {
        if (versioned || path.posix.extname(name) || name.startsWith('assets/')) return fail(404);
        name = 'index.html';
      }
      const file = path.join(build.root, ...name.split('/'));
      const real = await fs.realpath(file);
      if (path.relative(build.root, real).startsWith('..')) return fail(404);
      const bytes = await fs.readFile(real);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(name).toLowerCase()], 'Content-Length': bytes.length,
        'Cache-Control': versioned && name !== 'index.html' ? 'public, max-age=31536000, immutable' : 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { if (!res.headersSent) fail(503); else res.destroy(); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await verifyRelease(productionHome, (await state(productionHome)).current);
  const server = createProductionServer();
  server.on('error', error => { console.error(`Servidor: ${error.code || 'erro'}`); process.exit(error.code === 'EADDRINUSE' ? 20 : 1); });
  server.listen(8080, '0.0.0.0', () => console.log(`Produção: http://${os.hostname()}:8080 (somente sub-rede local)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
