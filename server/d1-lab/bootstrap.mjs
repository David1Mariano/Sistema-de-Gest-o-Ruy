import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pg,hashPassword} from './core.mjs';
import {home,cluster,database,DB_PORT,API_PORT,installation,createHome,seal,config,pgCommand,powershell,validateHome} from './environment.mjs';
export function validateAccount(account){
 if(!account||typeof account.login!=='string'||!/^[-a-z0-9._+]+@example\.invalid$/.test(account.login)||account.login.length>254)throw Error('Use um e-mail fictício terminado em @example.invalid.');
 if(typeof account.password!=='string'||account.password.length<12||Buffer.byteLength(account.password)>256)throw Error('Senha local deve ter pelo menos 12 caracteres.');
}
export async function initializeLab({bin='C:/Program Files/PostgreSQL/17/bin',account}={}){
 if(account)validateAccount(account);
 const accountHash=account?await hashPassword(account.password):null;
 if(!path.isAbsolute(bin))throw Error('Selecione a pasta bin do PostgreSQL 17.');
 for(const executable of ['postgres','pg_ctl','initdb','pg_dump','pg_restore'])await fs.access(path.join(bin,executable+'.exe'));

  if(!pgCommand(bin,'postgres',['--version']).match(/PostgreSQL\) 17\./))throw Error('Requer PostgreSQL 17 instalado de origem confiável.');
  powershell(`if(Get-NetTCPConnection -State Listen -LocalPort ${DB_PORT},${API_PORT} -ErrorAction SilentlyContinue){throw 'Porta D1 ocupada'}`);
  const marker=await createHome(bin);
  const password=randomBytes(32).toString('hex');
  const c={host:'127.0.0.1',port:DB_PORT,database,user:'ruy_d1_owner',password};
  await seal('owner.dpapi',c);
  const pw=path.join(home,'init-password.tmp');await fs.writeFile(pw,password,{flag:'wx'});
  try{pgCommand(bin,'initdb',['-D',cluster,'-U',c.user,'--pwfile',pw,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C']);}
  finally{await fs.unlink(pw);}
  await fs.appendFile(path.join(cluster,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${DB_PORT}\nfsync=on\nsynchronous_commit=on\n`);
  pgCommand(bin,'pg_ctl',['-D',cluster,'-l',path.join(home,'postgres.log'),'-w','start']);
  const owner=new pg.Client({...c,database:'postgres',connectionTimeoutMillis:3000});await owner.connect();
  const appPassword=randomBytes(32).toString('hex');
  try{await owner.query(`CREATE ROLE ruy_d1_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${appPassword}'`);await owner.query(`CREATE DATABASE ${database} OWNER ruy_d1_owner`);}finally{await owner.end();}
  const db=new pg.Client(c);await db.connect();
  try{
    await db.query('BEGIN');if(installation?.delivery)await db.query("SELECT set_config('ruy.initializing_installation',$1,true)",[installation.id]);await db.query(await fs.readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    for(const name of ['entities.sql','catalog.sql','sync.sql','operations.sql','domain.sql',...(installation?['attachments.sql','business.sql']:[]),...(installation?.delivery?['delivery.sql']:[])])await db.query(await fs.readFile(new URL('./'+name,import.meta.url),'utf8'));
    await db.query('INSERT INTO lab_device(id) VALUES($1)',[marker.deviceId]);
    await db.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await db.query(`GRANT CONNECT ON DATABASE ${database} TO ruy_d1_app`);
    await db.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await db.query('GRANT USAGE ON SCHEMA public TO ruy_d1_app');
    await db.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ruy_d1_app');
    await db.query('REVOKE INSERT,UPDATE,DELETE ON lab_device FROM ruy_d1_app');
    await db.query('REVOKE UPDATE,DELETE ON lab_audit,lab_outbox,d1_rh_history FROM ruy_d1_app');
    await db.query('REVOKE UPDATE,DELETE ON d1_stock_movements,d1_financial_entries,d1_operation_events FROM ruy_d1_app');
    await db.query('REVOKE DELETE ON d1_records FROM ruy_d1_app');
    await db.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ruy_d1_app');
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
  await seal('app.dpapi',{...c,user:'ruy_d1_app',password:appPassword});
  if(account){
   const app=new pg.Client(await config());await app.connect();
   try{await app.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[randomUUID(),account.login,accountHash]);}
   finally{await app.end();}
  }
  if(installation){const {installationCertificates}=await import('./installation-certificates.mjs');await installationCertificates();}
  return {deviceId:marker.deviceId,database,created:true};
}
export async function ensureLocalDatabase(){
 const marker=await validateHome();
 if((await fs.realpath(cluster)).toLowerCase()!==path.resolve(cluster).toLowerCase())throw Error('Cluster redirecionado recusado.');
 const credentials=await config();
 if(installation){try{const lines=(await fs.readFile(path.join(cluster,'postmaster.pid'),'utf8')).trim().split(/\r?\n/);if(lines.at(-1)==='stopping')throw Object.assign(Error('Laboratory PostgreSQL is stopping; wait for its normal shutdown'),{code:'LAB_DATABASE_STOPPING'});}catch(error){if(error.code!=='ENOENT')throw error;}}
 let started=false;
 try{pgCommand(marker.bin,'pg_ctl',['-D',cluster,'status']);}catch{
  await new Promise((resolve,reject)=>{
   const child=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-t','180','-w','start'],{windowsHide:true,stdio:'ignore'});
   const timer=setTimeout(()=>{reject(Error('PostgreSQL não confirmou partida em 180 segundos; cluster preservado.'));},190000);
   child.once('error',()=>{clearTimeout(timer);reject(Error('Executável PostgreSQL indisponível.'));});
   child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('PostgreSQL não confirmou partida; verificar log privado, sem repetir init.'));});
  });started=true;
 }
 const deadline=Date.now()+180000;let db;
 while(Date.now()<deadline){
  const candidate=new pg.Client({...credentials,connectionTimeoutMillis:1500});
  try{await candidate.connect();db=candidate;break;}
  catch(error){await candidate.end().catch(()=>{});if(['28P01','28000','3D000'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,500));}
 }
 if(!db)throw Error('PostgreSQL ainda não disponível após espera limitada; dados preservados.');
 try{
  if(installation){const identity=new pg.Client(await config(true));await identity.connect();try{const actual=(await identity.query('SHOW data_directory')).rows[0].data_directory;if(path.resolve(actual).toLowerCase()!==path.resolve(cluster).toLowerCase())throw Error('INSTALLATION_PGDATA_MISMATCH');}finally{await identity.end();}}
  if((await db.query('SELECT id FROM lab_device WHERE singleton')).rows[0]?.id!==marker.deviceId||(await db.query('SHOW listen_addresses')).rows[0].listen_addresses!=='127.0.0.1')throw Error('Identidade/origem do PostgreSQL divergente.');
  if(!(await db.query("SELECT to_regclass('public.d1_rh_history') AS name")).rows[0].name){
   // Apenas o banco marcado D1: ampliar contrato da etapa F sem apagar registros.
   const owner=new pg.Client(await config(true));await owner.connect();
   try{await owner.query('BEGIN');await owner.query(await fs.readFile(new URL('./domain.sql',import.meta.url),'utf8'));await owner.query('COMMIT');}
   catch(error){await owner.query('ROLLBACK');throw error;}finally{await owner.end();}
  }
 }finally{await db.end();}
 return {started,deviceId:marker.deviceId};
}
