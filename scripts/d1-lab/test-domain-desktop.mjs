import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const packaged=process.argv.includes('--packaged');
const evidenceFile=root+'logs/etapa-e-desktop-'+randomUUID()+'.json';
const executable=packaged?root+'artifacts/windows-lab/win-unpacked/Sistema de Gestão Ruy.exe':root+'desktop/node_modules/electron/dist/electron.exe';
const result=await promisify(execFile)(executable,[...(packaged?[]:[root+'desktop']),'--lab-smoke','--lab-domain-smoke','--lab-evidence='+evidenceFile],{cwd:root,env,windowsHide:true,timeout:120000});
await fs.writeFile(root+'logs/etapa-e-desktop-process.log',result.stdout+result.stderr);
const evidence=JSON.parse(await fs.readFile(evidenceFile,'utf8'));
assert.equal(evidence.domains?.confirmedConsumption,true);assert.equal(evidence.domains?.expenseAmount,12.34);
if(packaged){assert.equal(evidence.packaged,true);assert.equal(evidence.apiOwned,true);}
const pool=poolFor(await config());
try{
 assert.equal((await pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[evidence.syntheticActor])).rows[0].quantity_milli,'1000');
 const documents=(await pool.query("SELECT entity,data FROM d2_catalog WHERE owner_id=$1 AND entity IN ('DailyProduction','FinancialExpense')",[evidence.syntheticActor])).rows;
 assert.equal(documents.length,2);assert.equal(JSON.parse(documents.find(d=>d.entity==='DailyProduction').data.payload_json).local_status,'confirmado');
 evidence.domains.persistedAfterWindowClosed=true;await fs.writeFile(root+'logs/etapa-e-desktop'+(packaged?'-packaged':'')+'.json',JSON.stringify(evidence,null,2));
}finally{await pool.end();}
console.log('DOMAIN_DESKTOP_OK');
