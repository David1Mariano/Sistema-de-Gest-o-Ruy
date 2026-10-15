import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {home as localHome} from '../../server/d1-lab/environment.mjs';
import {home as centralHome} from '../../server/sync-lab/environment.mjs';
if(process.platform!=='win32'||process.argv[2]!=='--new-synthetic-lab')throw Error('Somente Windows: --new-synthetic-lab cria ambientes novos, nunca recupera banco existente.');
for(const destination of [localHome,centralHome]){
 try{await fs.access(destination);throw Error('Diretório existente preservado; bootstrap recusado. Use procedimentos de retomada.');}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
const exec=promisify(execFile);
for(const args of [
 [fileURLToPath(new URL('../d1-lab.mjs',import.meta.url)),'init'],
 [fileURLToPath(new URL('../sync-lab.mjs',import.meta.url)),'init'],
 [fileURLToPath(new URL('./prepare-sync.mjs',import.meta.url))],
 [fileURLToPath(new URL('../sync-lab.mjs',import.meta.url)),'start','central'],
 [fileURLToPath(new URL('../d1-lab.mjs',import.meta.url)),'start-api'],
]){
 try{await exec(process.execPath,args,{windowsHide:true,timeout:120000});}
 catch{throw Error('Etapa de bootstrap falhou. Ambientes parciais foram preservados; não repetir init nem apagar diretórios. Consulte os logs privados.');}
}
console.log('D1 e central C2 sintéticos preparados. Criar usuário fictício e provisionar vínculo explicitamente. Nenhuma sincronização operacional ativada.');
