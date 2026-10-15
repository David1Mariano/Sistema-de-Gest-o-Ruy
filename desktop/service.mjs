// Raiz fornecida exclusivamente pelo processo principal, nunca pelo renderer.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root = process.env.RUY_DESKTOP_ROOT;
if (!root || !path.isAbsolute(root)) throw Error('Raiz do aplicativo ausente.');
await import(pathToFileURL(path.join(root, 'scripts/d1-lab/network-guard.cjs')));
await import(pathToFileURL(path.join(root, 'server/d1-lab/start.mjs')));
