import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

export const productionHome = process.env.RUY_PRODUCTION_HOME || path.join(process.env.LOCALAPPDATA || os.homedir(), 'GestaoRuy', 'producao');
export const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
export const safeFile = name => typeof name === 'string' && !name.includes('\\') && !name.includes(':') && name.split('/').every(p => p && !p.startsWith('.')) && Boolean(mime[path.extname(name).toLowerCase()]);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function prepareBuild(dir) {
  // O HTML atual referencia /manifest.json, mas o projeto não fornece esse
  // arquivo. Retira só esse link quebrado da cópia publicada, sem tocar no DEV.
  const file = path.join(dir, 'index.html');
  const html = await fs.readFile(file, 'utf8');
  try { await fs.access(path.join(dir, 'manifest.json')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(file, html.replace(/<link\b(?=[^>]*\brel="manifest")(?=[^>]*\bhref="\/manifest\.json")[^>]*>\s*/g, ''));
  }
}

export async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx');
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temp, file);
}

export async function state(home) {
  const result = JSON.parse(await fs.readFile(path.join(home, 'active.json'), 'utf8'));
  if (!validId(result.current) || (result.previous && !validId(result.previous))) throw Error('Estado de produção inválido.');
  return result;
}

export async function inspectBuild(dir, id) {
  if (!validId(id)) throw Error('Versão inválida.');
  const files = {};
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) throw Error('Build contém caminho não permitido.');
      if (entry.isDirectory()) { await walk(path.join(folder, entry.name), `${name}/`); continue; }
      if (!entry.isFile() || !safeFile(name)) throw Error('Build contém arquivo não permitido (incluindo fontes/mapas/scripts administrativos).');
      const bytes = await fs.readFile(path.join(folder, entry.name));
      const text = bytes.toString('utf8');
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]+/.test(text)) throw Error('Build contém segredo privado; publicação bloqueada.');
      for (const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
        try { if (JSON.parse(Buffer.from(token[1], 'base64url')).role === 'service_role') throw Error('PRIVATE_ROLE'); }
        catch (error) { if (error.message === 'PRIVATE_ROLE') throw Error('Build contém service_role; publicação bloqueada.'); }
      }
      files[name] = digest(bytes);
    }
  }
  await walk(dir);
  if (!files['index.html']) throw Error('Build sem index.html.');
  const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
  if (html.includes('/@vite/client') || html.includes('/src/')) throw Error('HTML de desenvolvimento não pode ser publicado.');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)].map(m => m[1]);
  if (!refs.length) throw Error('Build sem assets.');
  for (const ref of refs) {
    const prefix = `/releases/${id}/`;
    if (!ref.startsWith(prefix) || !files[ref.slice(prefix.length)]) throw Error('Asset do build ausente ou fora da versão.');
  }
  return { id, files, createdAt: new Date().toISOString() };
}

export async function verifyRelease(home, id) {
  if (!validId(id)) throw Error('Versão inválida.');
  const dir = path.join(home, 'releases', id);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (manifest.id !== id || !manifest.files?.['index.html']) throw Error('Manifesto inválido.');
  const root = await fs.realpath(path.join(dir, 'site'));
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (!safeFile(name)) throw Error('Arquivo não permitido.');
    const file = path.join(root, ...name.split('/'));
    const real = await fs.realpath(file);
    if (path.relative(root, real).startsWith('..') || digest(await fs.readFile(real)) !== hash) throw Error('Build alterado ou inválido.');
  }
  return { ...manifest, root };
}

export async function activate(home, id) {
  await verifyRelease(home, id);
  let before;
  try { before = await state(home); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (before?.current === id) return before;
  const next = { current: id, previous: before?.current || null, publishedAt: new Date().toISOString() };
  await atomicJson(path.join(home, 'active.json'), next);
  return next;
}
