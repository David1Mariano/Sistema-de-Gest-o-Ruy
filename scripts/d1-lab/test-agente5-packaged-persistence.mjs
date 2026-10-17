import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic opt-in required');
const first=JSON.parse(await fs.readFile('logs/agente5-packaged-20261017.json')),second=JSON.parse(await fs.readFile('logs/agente5-packaged-modules-20261017.json'));
for(const value of [first,second])assert.equal(value.purpose,'RUY_DESKTOP_SYNTHETIC_ONLY');
const pool=poolFor(await config());
try{
assert.equal((await pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[first.syntheticActor])).rows[0].quantity_milli,'2000');
assert.equal((await pool.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1',[second.syntheticActor])).rows[0].quantity_milli,'1000');
const employee=(await pool.query("SELECT data,version FROM d1_records WHERE owner_id=$1 AND id=$2 AND entity='Employee'",[second.syntheticActor,second.employee.id])).rows[0];assert.equal(employee.data._deleted,'true');assert.equal(Number(employee.version),3);
const report={checks:3,firstAppDataSurvivedSecondLaunch:true,secondAppDataPersistedAfterExit:true,employeeTombstoneVersion:3,syntheticOnly:true,osRestartTested:false,reinstallationTested:false};await fs.writeFile('logs/agente5-packaged-persistence-20261017.json',JSON.stringify(report));console.log(JSON.stringify(report));
}finally{await pool.end();}
