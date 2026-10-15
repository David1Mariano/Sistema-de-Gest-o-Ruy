import {backup,restoreIsolated} from '../../server/d1-lab/backup.mjs';
import path from 'node:path';
import {home} from '../../server/d1-lab/environment.mjs';
if(process.argv[2]==='create')console.log(JSON.stringify(await backup()));
else if(process.argv[2]==='restore-test'&&/^[a-zA-Z0-9_.-]+\.ruybak$/.test(process.argv[3]||''))console.log(JSON.stringify(await restoreIsolated(path.join(home,'backups',process.argv[3]))));
else throw Error('Use create ou restore-test <arquivo.ruybak>; restauração somente em banco novo descartável.');
