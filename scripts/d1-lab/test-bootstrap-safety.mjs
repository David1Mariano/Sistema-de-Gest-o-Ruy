import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {home,config,validateHome} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
await validateHome();const bytes=await fs.readFile(path.join(home,'lab.json')),digest=b=>createHash('sha256').update(b).digest('hex');
const bootstrap=spawnSync(process.execPath,[fileURLToPath(new URL('./bootstrap-windows.mjs',import.meta.url)),'--new-synthetic-lab'],{windowsHide:true,encoding:'utf8'});
assert.notEqual(bootstrap.status,0);assert.equal(digest(await fs.readFile(path.join(home,'lab.json'))),digest(bytes));
const login='setup-'+randomUUID()+'@example.invalid',password=randomBytes(24).toString('hex'),input=Buffer.from(JSON.stringify({login,password})).toString('base64');
const args=[fileURLToPath(new URL('./create-user.mjs',import.meta.url)),'--base64-stdin','--role','admin'];
const created=spawnSync(process.execPath,args,{windowsHide:true,input,encoding:'utf8'});assert.equal(created.status,0);const user=JSON.parse(created.stdout);assert.equal(user.role,'admin');assert.ok(!created.stdout.includes(password));
const pool=poolFor(await config());
try{
 const before=(await pool.query('SELECT password_hash,role FROM lab_users WHERE id=$1',[user.id])).rows[0];
 const replay=spawnSync(process.execPath,args,{windowsHide:true,input,encoding:'utf8'});assert.notEqual(replay.status,0);
 assert.deepEqual((await pool.query('SELECT password_hash,role FROM lab_users WHERE id=$1',[user.id])).rows[0],before);
}finally{await pool.end();}
console.log('BOOTSTRAP_SAFETY_OK: ambiente existente recusado, criação admin explícita sem senha em stdout, conta duplicada preservada.');
