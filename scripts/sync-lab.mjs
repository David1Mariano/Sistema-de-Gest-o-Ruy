import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {home,cluster,dbPort,ports,dbNames,marker,createHome,seal,config,run,checkPort} from '../server/sync-lab/environment.mjs';
import {powershell} from '../server/local-lab/environment.mjs';
const command=process.argv[2],mode=process.argv[3];
const secret=()=>randomBytes(32).toString('hex');
try{
 if(command==='init'){
  for(const p of [dbPort,...Object.values(ports)])checkPort(p);
  const bin='C:/Program Files/PostgreSQL/17/bin';
  if(!run(bin,'postgres',['--version']).includes('PostgreSQL) 17.'))throw Error('Requer PostgreSQL 17 confiável.');
  const actorId=randomUUID(),workspaceId=randomUUID();
  const identities={A:{deviceId:randomUUID(),actorId,workspaceId},B:{deviceId:randomUUID(),actorId,workspaceId}};
  await createHome({bin,identities,createdAt:new Date().toISOString()});
  const owner={host:'127.0.0.1',port:dbPort,user:'ruy_c2_owner',password:secret(),database:'postgres'};
  await seal('owner',owner);
  const pw=path.join(home,'init-password.tmp');await fs.writeFile(pw,owner.password,{flag:'wx'});
  try{run(bin,'initdb',['-D',cluster,'-U',owner.user,'--pwfile',pw,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C']);}finally{await fs.unlink(pw);}
  await fs.appendFile(path.join(cluster,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${dbPort}\nfsync=on\nsynchronous_commit=on\n`);
  run(bin,'pg_ctl',['-D',cluster,'-l',path.join(home,'postgres.log'),'-w','start']);
  const admin=new pg.Client(owner);await admin.connect();
  const configs={};
  try{
   for(const key of Object.keys(ports)){
    const user=`ruy_c2_${key.toLowerCase()}_app`,password=secret();
    await admin.query(`CREATE ROLE ${user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await admin.query(`CREATE DATABASE ${dbNames[key]} OWNER ruy_c2_owner`);
    configs[key]={db:{...owner,database:dbNames[key],user,password},localToken:secret(),...(key==='central'?{}:{centralToken:secret(),identity:identities[key]})};
   }
  }finally{await admin.end();}
  for(const key of Object.keys(ports)){
   const c=new pg.Client({...owner,database:dbNames[key]});await c.connect();
   try{
    await c.query('BEGIN');await c.query(await fs.readFile(new URL(`../server/sync-lab/${key==='central'?'central':'device'}.sql`,import.meta.url),'utf8'));
    const user=configs[key].db.user;
    await c.query(`REVOKE ALL ON DATABASE ${dbNames[key]} FROM PUBLIC`);
    await c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await c.query(`GRANT CONNECT ON DATABASE ${dbNames[key]} TO ${user}`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
    await c.query(`GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO ${user}`);
    if(key==='central'){
     for(const device of ['A','B'])await c.query('INSERT INTO principals(token_hash,device_id,actor_id,workspace_id) VALUES($1,$2,$3,$4)',[createHash('sha256').update(configs[device].centralToken).digest('hex'),identities[device].deviceId,actorId,workspaceId]);
     await c.query(`REVOKE INSERT,UPDATE ON principals FROM ${user}`);
     await c.query(`REVOKE UPDATE ON receipts,changes FROM ${user}`);
    }else{
     await c.query('INSERT INTO identity VALUES(true,$1,$2,$3)',[identities[key].deviceId,actorId,workspaceId]);
     await c.query(`REVOKE INSERT,UPDATE ON identity FROM ${user}`);
    }
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
   await seal(key,configs[key]);
  }
  console.log('C2: três bancos sintéticos independentes inicializados, sem tokens na saída.');
 }else if(['start','stop'].includes(command)){
  await marker();if(!Object.hasOwn(ports,mode))throw Error('Escolha A, B ou central.');
  const entry=fileURLToPath(new URL('../server/sync-lab/start.mjs',import.meta.url));
  if(command==='start'){
   await config(mode);
   try{const r=await fetch(`http://127.0.0.1:${ports[mode]}/health`,{signal:AbortSignal.timeout(800)});if(r.ok&&(await r.json()).mode===mode){console.log(mode+': já ativa.');process.exit(0);}throw Error('Porta ocupada.');}catch(e){if(!['TypeError','TimeoutError'].includes(e.name))throw e;}
   checkPort(ports[mode]);const log=await fs.open(path.join(home,mode+'.log'),'a');
   const child=spawn(process.execPath,[entry,mode],{windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
   let ready=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,250));try{const r=await fetch(`http://127.0.0.1:${ports[mode]}/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{/*aguarda*/}}
   if(!ready)throw Error('API não confirmou saúde.');console.log(mode+': ativa apenas em loopback.');
  }else{
   const pid=Number(await fs.readFile(path.join(home,mode+'.pid'),'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('PID inválido.');
   const safe=entry.replaceAll("'","''");
   powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if(!$p -or $p.Name -ne 'node.exe' -or !$p.CommandLine.Contains('${safe}') -or !$p.CommandLine.TrimEnd().EndsWith(' ${mode}')){throw 'Processo não corresponde'};Stop-Process -Id ${pid}`);
   console.log(mode+': parada somente API C2 identificada.');
  }
 }else if(['start-db','stop-db'].includes(command)){
  const m=await marker();run(m.bin,'pg_ctl',['-D',cluster,...(command==='start-db'?['-l',path.join(home,'postgres.log'),'-w','start']:['-m','fast','-w','stop'])]);console.log(command+': somente cluster C2.');
 }else if(command==='status'){
  for(const key of Object.keys(ports)){
   const c=await config(key);const r=await fetch(`http://127.0.0.1:${ports[key]}/status`,{headers:{Authorization:'Bearer '+c.localToken},signal:AbortSignal.timeout(3000)});console.log(JSON.stringify({mode:key,status:r.status,...await r.json()}));
  }
 }else if(command==='sync'){
  if(!['A','B'].includes(mode))throw Error('Somente A/B.');await config(mode);
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server/sync-lab/worker.mjs',import.meta.url)),mode],{windowsHide:true,stdio:'inherit'});
  const code=await new Promise(resolve=>child.on('exit',resolve));process.exitCode=code;
 }else throw Error('Use init/start|stop A|B|central/start-db/stop-db/sync A|B/status.');
}catch(e){console.error(e.code==='EEXIST'?'C2 existente preservada; init recusado.':'C2_BLOCKED: '+(e.message?.includes('password')?'Falha de preparação; segredo omitido.':e.message));process.exitCode=1;}
