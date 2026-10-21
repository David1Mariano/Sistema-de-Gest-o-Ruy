import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {installation,validateHome,config,cluster,home} from '../../server/d1-lab/environment.mjs';
import {ensureLocalDatabase} from '../../server/d1-lab/bootstrap.mjs';
assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_IDENTITY_ACCEPTANCE,'1');
const marker=await validateHome();assert.equal(marker.port,55483);
// Refuse to stop a cluster while this application's API is running.
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(18133,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const connection=await config(true);
async function snapshot(){const c=new pg.Client(connection);await c.connect();try{
 const actual=(await c.query('SHOW data_directory')).rows[0].data_directory;assert.equal(path.resolve(actual).toLowerCase(),path.resolve(cluster).toLowerCase());const result={};
 for(const table of ['lab_users','d1_records','d2_catalog','d1_stock_balances','d1_stock_movements','d1_financial_entries','lab_outbox'])result[table]=(await c.query(`SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) fingerprint FROM ${table} t`)).rows[0];return result;
}finally{await c.end();}}
const before=await snapshot();
await new Promise((resolve,reject)=>{const p=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-m','smart','-w','-t','30','stop'],{windowsHide:true,stdio:'ignore'});p.once('error',()=>reject(Error('OWNED_CLUSTER_STOP_PENDING')));p.once('exit',code=>code===0?resolve():reject(Error('OWNED_CLUSTER_STOP_PENDING_NO_FORCE')));});
await ensureLocalDatabase();const after=await snapshot();assert.deepEqual(after,before);
const result={passed:true,syntheticOnly:true,port:55483,smartShutdown:true,restarted:true,allFingerprintsPreserved:true,installedR4Touched:false,historicalClusterRestarted:false};
await fs.writeFile(path.join(home,'restart-proof-'+Date.now()+'.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
