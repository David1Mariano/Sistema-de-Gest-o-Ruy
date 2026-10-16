import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {pg} from '../server/d1-lab/core.mjs';
import {home,cluster,database,DB_PORT,API_PORT,validateHome,config,pgCommand,powershell} from '../server/d1-lab/environment.mjs';
const command=process.argv[2];
const pause=()=>new Promise(r=>setTimeout(r,250));
try{
 if(command==='init'){
  const {initializeLab}=await import('../server/d1-lab/bootstrap.mjs');
  await initializeLab({bin:process.env.RUY_LAB_PG_BIN||'C:/Program Files/PostgreSQL/17/bin'});
  console.log('Laboratório criado. Nenhuma conta operacional ativada. Device UUID persistido.');
 }else if(['start-db','stop-db','status-db'].includes(command)){
  const marker=await validateHome();
  // Lê somente o cluster etiquetado desta etapa, nunca serviços Windows/5432.
  if(command==='stop-db')pgCommand(marker.bin,'pg_ctl',['-D',cluster,'-m','fast','-w','stop']);
  else if(command==='start-db')pgCommand(marker.bin,'pg_ctl',['-D',cluster,'-l',path.join(home,'postgres.log'),'-w','start']);
  else pgCommand(marker.bin,'pg_ctl',['-D',cluster,'status']);
  console.log(command+': OK');
 }else if(command==='start-api'){
  await config();
  try{const r=await fetch(`http://127.0.0.1:${API_PORT}/health`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).service==='ruy-d1-lab'){console.log('API do laboratório já ativa.');process.exit(0);}throw Error('Porta ocupada por outro serviço.');}
  catch(e){if(e.name!=='TypeError'&&e.name!=='TimeoutError')throw e;}
  const log=await fs.open(path.join(home,'api.log'),'a');
  const child=spawn(process.execPath,['--require',fileURLToPath(new URL('./d1-lab/network-guard.cjs',import.meta.url)),fileURLToPath(new URL('../server/d1-lab/start.mjs',import.meta.url))],{windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
  let ready=false;
  for(let i=0;i<30;i++){await pause();try{const r=await fetch(`http://127.0.0.1:${API_PORT}/health`,{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.json()).service==='ruy-d1-lab'){ready=true;break;}}catch{/*aguarda*/}}
  if(!ready)throw Error('API não confirmou saúde. Inspecionar api.log.');
  console.log(`API lab ativa em 127.0.0.1:${API_PORT}.`);
 }else if(command==='stop-api'){
  await validateHome();
  const pid=Number(await fs.readFile(path.join(home,'api.pid'),'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('PID inválido.');
  const expected=fileURLToPath(new URL('../server/d1-lab/start.mjs',import.meta.url)).replaceAll("'","''");
  powershell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if(!$p -or $p.Name -ne 'node.exe' -or !$p.CommandLine.Contains('${expected}')){throw 'Processo não corresponde ao laboratório'}; Stop-Process -Id ${pid}`);
  console.log('Somente API do laboratório parada.');
 }else if(command==='status'){
  const marker=await validateHome();
  const db=new pg.Client({...await config(),connectionTimeoutMillis:3000});await db.connect();
  try{
    const counts=(await db.query("SELECT (SELECT count(*) FROM d1_records) as synthetic_records,(SELECT count(*) FROM lab_outbox WHERE state='pending') as pending")).rows[0];
    const r=await fetch(`http://127.0.0.1:${API_PORT}/health`,{signal:AbortSignal.timeout(3000)});
    console.log(JSON.stringify({purpose:marker.purpose,deviceId:marker.deviceId,database,dbHost:'127.0.0.1',dbPort:DB_PORT,apiStatus:r.status,api:await r.json(),...counts}));
  }finally{await db.end();}
 }else throw Error('Use init/start-db/stop-db/status-db/start-api/stop-api/status. Não há comando para apagar dados.');
}catch(e){console.error('LAB_BLOCKED:',e.code==='EEXIST'?'Diretório existente preservado; init recusado.':e.message?.includes('password')?'Preparação falhou; segredo omitido.':e.message);process.exitCode=1;}
