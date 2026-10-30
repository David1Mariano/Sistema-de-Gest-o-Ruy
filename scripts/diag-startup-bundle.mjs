// Read-only build measurement: npm run build, then
// node scripts/diag-startup-bundle.mjs [outDir] [--max-initial-js=750000].
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseAst } from 'rollup/parseAst';

const args = process.argv.slice(2);
const root = path.resolve(args.find(arg => !arg.startsWith('--')) || 'dist');
const budgetArg = args.find(arg => arg.startsWith('--max-initial-js='));
const budget = budgetArg ? Number(budgetArg.split('=')[1]) : null;
if (budgetArg && (!Number.isFinite(budget) || budget <= 0)) throw Error('Invalid initial JS budget');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const assetPath = url => path.join(root, 'assets', path.basename(url));
const initial = new Set();
async function visit(file) {
  if (initial.has(file)) return;
  initial.add(file);
  const source = await readFile(file, 'utf8');
  for (const item of parseAst(source).body) {
    const imported = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(item.type)
      ? item.source?.value : null;
    if (imported?.startsWith('.')) await visit(path.resolve(path.dirname(file), imported));
  }
}
for (const match of html.matchAll(/(?:src|href)="([^"]+\.js)"/g)) await visit(assetPath(match[1]));
const files = [];
for (const name of await readdir(path.join(root, 'assets'))) {
  const file = path.join(root, 'assets', name);
  const bytes = await readFile(file);
  files.push({ name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, initial: initial.has(file) });
}
const js = files.filter(file => file.name.endsWith('.js'));
const report = {
  scope: 'static startup JS graph; excludes API, browser execution and dynamic route requests',
  initialJsRequests: initial.size,
  initialJsBytes: js.filter(file => file.initial).reduce((sum, file) => sum + file.bytes, 0),
  initialJsGzipBytes: js.filter(file => file.initial).reduce((sum, file) => sum + file.gzipBytes, 0),
  jsChunks: js.length,
  largestChunk: [...js].sort((a, b) => b.bytes - a.bytes)[0],
  cssBytes: files.filter(file => file.name.endsWith('.css')).reduce((sum, file) => sum + file.bytes, 0),
  files,
};
console.log(JSON.stringify(report, null, 2));
if (budget !== null && report.initialJsBytes > budget) {
  console.error(`Initial JS exceeds budget: ${report.initialJsBytes} > ${budget}`);
  process.exitCode = 1;
}
