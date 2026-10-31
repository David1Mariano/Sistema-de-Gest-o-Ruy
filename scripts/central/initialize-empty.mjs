import fs from 'node:fs/promises';import path from 'node:path';import pg from 'pg';
import {initializeCentralSchema,grantCentralRuntime} from '../../server/central/schema.mjs';
import {openDpapi} from '../homologacao/common.mjs';
const arg=k=>process.argv.find(a=>a.startsWith('--'+k+'='))?.slice(k.length+3),root=path.resolve(arg('profile')||'');
if(root.toLowerCase()!==path.join(process.env.LOCALAPPDATA,'GestaoRuy','central-pichau-rc1-staging').toLowerCase())throw Error('DEDICATED_SERVICE_USER_PROFILE_REQUIRED');
if(!process.argv.includes('--apply')){console.log(JSON.stringify({dryRun:true,target:{host:'127.0.0.1',port:55516,database:'ruy_central_rc1_staging'},existingTargetsPreserved:true,migrateData:false,activate:false}));process.exit(0);}
if((await fs.realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('PROFILE_REDIRECTION_REFUSED');
const a=JSON.parse(await fs.readFile(arg('authorization'),'utf8'));
if(a.initializeEmptyCentralApproved!==true||a.server!=='PICHAU'||a.database!=='ruy_central_rc1_staging'||!a.approvedBy||!Number.isFinite(Date.parse(a.expiresAt))||Date.parse(a.expiresAt)<=Date.now())throw Error('EMPTY_INITIALIZATION_AUTHORIZATION_REQUIRED');
const p=JSON.parse(await fs.readFile(path.join(root,'central.json'),'utf8'));
if(p.mode!=='controlled'||p.enabled!==false||p.activationApproved!==false||p.database.host!=='127.0.0.1'||p.database.port!==55516||p.database.database!=='ruy_central_rc1_staging'||!/^ruy_central_[a-f0-9]{16}$/.test(p.database.user))throw Error('DISABLED_NEW_TARGET_REQUIRED');
const c=await openDpapi(path.join(root,'owner-init.dpapi')),s=await openDpapi(path.join(root,'secrets.dpapi'));
if(c.host!=='127.0.0.1'||c.port!==55516||c.database!=='postgres'||c.user!=='ruy_central_owner'||! /^[a-f0-9]{64}$/.test(s.databasePassword))throw Error('DEDICATED_CLUSTER_OWNER_REQUIRED');
const control=new pg.Client({...c,connectionTimeoutMillis:3000});let pool;
try{
 await control.connect();const actual=(await control.query("SELECT current_setting('port') port,current_database() db")).rows[0];if(actual.port!=='55516'||actual.db!=='postgres')throw Error('CLUSTER_IDENTITY_MISMATCH');
 if((await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[p.database.database])).rowCount||(await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[p.database.user])).rowCount)throw Error('EXISTING_TARGET_PRESERVED');
 await control.query(`CREATE ROLE ${p.database.user} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${s.databasePassword}'`);
 await control.query('CREATE DATABASE ruy_central_rc1_staging OWNER ruy_central_owner');await control.query('REVOKE CONNECT ON DATABASE ruy_central_rc1_staging FROM PUBLIC');await control.query(`GRANT CONNECT ON DATABASE ruy_central_rc1_staging TO ${p.database.user}`);
 pool=new pg.Pool({...c,database:p.database.database});await initializeCentralSchema(pool);await grantCentralRuntime(pool,p.database.user);
 console.log(JSON.stringify({initialized:true,active:false,maintenance:true,dataMigrated:false,historyImported:false,serviceStarted:false}));
}finally{await pool?.end();await control.end();}
