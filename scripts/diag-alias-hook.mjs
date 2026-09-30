// ALIAS HOOK — permite que o Node resolva `@/lib/...` como o Vite resolve.
// Só usado pelos scripts de diagnóstico; não faz parte do app.
// O conteúdo é montado via data: URL para o script de diagnóstico rodar
// sem arquivo extra no repositório.
import { register } from 'node:module';

const HOOK = `
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = process.env.REPRO_ROOT || process.cwd();
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    for (const ext of ['.js', '.jsx', '/index.js']) {
      const p = path.join(root, 'src', rel + ext);
      if (existsSync(p)) {
        return { url: pathToFileURL(p).href, shortCircuit: true, format: 'module' };
      }
    }
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(HOOK)}`);

export const createEntityClient = async () => (
  (await import('../src/lib/cloudDb.js')).createEntityClient
);
