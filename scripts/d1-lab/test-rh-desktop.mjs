import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
import {productionWitness} from './production-witness.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in obrigatório para formulários sintéticos Electron.');
const root=fileURLToPath(new URL('../../',import.meta.url)),env={...process.env},before=await productionWitness();
delete env.ELECTRON_RUN_AS_NODE;
const evidenceFile=root+'logs/etapa-f-desktop-'+randomUUID()+'.json';
const result=await promisify(execFile)(root+'desktop/node_modules/electron/dist/electron.exe',[root+'desktop','--lab-smoke','--lab-rh-smoke','--lab-evidence='+evidenceFile],{cwd:root,env,windowsHide:true,timeout:120000});
await fs.writeFile(root+'logs/etapa-f-desktop-process.log',result.stdout+result.stderr);
const evidence=JSON.parse(await fs.readFile(evidenceFile,'utf8'));
assert.equal(evidence.rh?.discountLink,true);assert.equal(evidence.rh?.history,true);assert.equal(evidence.renderer.nodeExposed,false);
const pool=poolFor(await config());
try{
 const history=(await pool.query('SELECT * FROM d1_rh_history WHERE owner_id=$1',[evidence.syntheticActor])).rows;
 assert.equal(history.length,5);evidence.rh.persistedAfterWindowClosed=true;
 assert.deepEqual(await productionWitness(),before);
 await fs.writeFile(root+'logs/etapa-f-desktop-evidence.json',JSON.stringify(evidence,null,2));
}finally{await pool.end();}
console.log('RH_DESKTOP_OK');
