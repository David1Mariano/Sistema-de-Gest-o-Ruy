import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash} from 'node:crypto';
import {home, validateHome, config, seal, unseal, DB_PORT} from './environment.mjs';
import {poolFor, pg} from './core.mjs';

const magic=Buffer.from('RUYBAK01'),limit=64*1024*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
const snapshotTables=['d1_sync_binding','d1_sync_queue','d1_sync_versions','d1_sync_inbox','d1_sync_shadow','d1_stock_balances','d1_stock_movements','d1_financial_accounts','d1_financial_entries','d1_operation_events'];
async function recoveryState(client){
 const result={};
 for(const table of snapshotTables){
  if((await client.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name)result[table]=(await client.query(`SELECT coalesce(jsonb_agg(row_data ORDER BY row_data::text),'[]'::jsonb) AS rows FROM (SELECT to_jsonb(t) AS row_data FROM ${table} t) s`)).rows[0].rows;
 }
 return result;
}
export function encryptArchive(archive,key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Chave AES-256 inválida.');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(magic);
 return Buffer.concat([magic,iv,cipher.update(JSON.stringify(archive)),cipher.final(),cipher.getAuthTag()]);
}
export function decryptArchive(bytes,key){
 if(bytes.length<36||bytes.length>limit*2||!bytes.subarray(0,8).equals(magic))throw Error('Backup inválido.');
 const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(8,20));
 decipher.setAAD(magic);decipher.setAuthTag(bytes.subarray(-16));
 const archive=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(20,-16)),decipher.final()]).toString());
 if(archive.purpose!=='RUY_D1_SYNTHETIC_BACKUP'||archive.version!==1||hash(Buffer.from(archive.dump,'base64'))!==archive.dumpHash)throw Error('Manifesto de backup inválido.');
 for(const a of archive.attachments){if(!/^[a-zA-Z0-9_-]+\.(?:pdf|png|jpg|webp|txt)$/.test(a.name)||hash(Buffer.from(a.bytes,'base64'))!==a.sha256)throw Error('Anexo inválido.');}
 return archive;
}
async function runPG(bin,name,args,c,input){
 if(c.host!=='127.0.0.1'||c.port!==DB_PORT||!/^ruy_d1_(?:disposable|restore_[a-f0-9]{16})$/.test(c.database))throw Error('Destino de backup fora do laboratório.');
 return new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+'.exe'),args,{windowsHide:true,env:{...process.env,PGHOST:c.host,PGPORT:String(c.port),PGDATABASE:c.database,PGUSER:c.user,PGPASSWORD:c.password,PGCONNECT_TIMEOUT:'5'},stdio:['pipe','pipe','pipe']});
  const chunks=[];let size=0;
  const timeout=setTimeout(()=>child.kill(),30000);
  child.stdout.on('data',b=>{size+=b.length;if(size>limit)child.kill();else chunks.push(b);});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timeout);reject(Error('Executável PostgreSQL indisponível.'));});
  child.on('close',code=>{clearTimeout(timeout);if(code!==0||size>limit)reject(Error(`PostgreSQL ${name} falhou (exit ${code}); conteúdo omitido.`));else resolve(Buffer.concat(chunks));});
  child.stdin.end(input);
 });
}
async function key(){
 await validateHome();
 try{return Buffer.from((await unseal('backup-key.dpapi')).key,'hex');}
 catch(e){if(e.code!=='ENOENT')throw e;await seal('backup-key.dpapi',{key:randomBytes(32).toString('hex')});return Buffer.from((await unseal('backup-key.dpapi')).key,'hex');}
}
export async function backup({retain=24}={}){
 if(!Number.isInteger(retain)||retain<2||retain>365)throw Error('Retenção deve ficar entre 2 e 365 cópias.');
 const marker=await validateHome(),c=await config(),dir=path.join(home,'backups');
 await fs.mkdir(dir,{recursive:true});
 if((await fs.realpath(dir)).toLowerCase()!==path.resolve(dir).toLowerCase())throw Error('Diretório de backup redirecionado.');
 let lock;
 try{lock=await fs.open(path.join(dir,'backup.lock'),'wx');}
 catch(e){await fs.writeFile(path.join(home,'backup-status.json'),JSON.stringify({state:'error',lastError:'Backup ocupado ou lock de execução interrompida. Verifique o processo antes de recuperar o lock.',externalProtected:false}));throw e;}
 const target=path.join(dir,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.ruybak');
 let pool;
 try{
  const archiveKey=await key();pool=poolFor(c);const client=await pool.connect();
  let archive;
  try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const snapshot=(await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
   const pending=(await client.query('SELECT operation_id FROM lab_outbox ORDER BY operation_id')).rows.map(r=>r.operation_id);
   // O produto D1 usa public; schemas de testes críticos possuem outro owner
   // e não pertencem ao backup da aplicação nem ao papel restrito.
   const dump=await runPG(marker.bin,'pg_dump',['--format=custom','--schema=public','--no-owner','--no-acl','--snapshot='+snapshot],c);
   const attachmentDir=path.join(home,'attachments'),attachments=[];
   let entries=[];try{if((await fs.realpath(attachmentDir)).toLowerCase()!==path.resolve(attachmentDir).toLowerCase())throw Error('Diretório de anexos redirecionado.');entries=await fs.readdir(attachmentDir,{withFileTypes:true});}catch(e){if(e.code!=='ENOENT')throw e;}
   let total=dump.length;
   for(const entry of entries){
    if(!entry.isFile()||!/^FICTICIO-[a-zA-Z0-9_-]+\.(?:pdf|png|jpg|webp|txt)$/.test(entry.name))throw Error('Apenas anexos sintéticos imutáveis são permitidos.');
    const bytes=await fs.readFile(path.join(attachmentDir,entry.name));total+=bytes.length;
    if(total>limit)throw Error('Limite do laboratório excedido.');
    attachments.push({name:entry.name,bytes:bytes.toString('base64'),sha256:hash(bytes)});
   }
   archive={purpose:'RUY_D1_SYNTHETIC_BACKUP',version:1,createdAt:new Date().toISOString(),deviceId:marker.deviceId,dump:dump.toString('base64'),dumpHash:hash(dump),pending,attachments,recoveryState:await recoveryState(client)};
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  const encrypted=encryptArchive(archive,archiveKey);decryptArchive(encrypted,archiveKey);
  const temp=target+'.partial';await fs.writeFile(temp,encrypted,{flag:'wx'});
  const handle=await fs.open(temp,'r+');try{await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,target);
  const result={state:'local-only',createdAt:archive.createdAt,file:path.basename(target),sha256:hash(encrypted),bytes:encrypted.length,pendingOperations:archive.pending.length,externalProtected:false};
  await fs.writeFile(path.join(home,'backup-status.json'),JSON.stringify(result));
  // Retenção somente de arquivos regulares do diretório privado validado.
  const files=(await fs.readdir(dir,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.ruybak')).map(e=>e.name).sort().reverse();
  for(const name of files.slice(retain))await fs.unlink(path.join(dir,name));
  return result;
 }catch(e){
  await fs.writeFile(path.join(home,'backup-status.json'),JSON.stringify({state:'error',lastError:'Backup local falhou. Verifique espaço, dependências e estado do laboratório.',externalProtected:false}));
  throw e;
 }finally{await pool?.end();await lock.close();await fs.unlink(path.join(dir,'backup.lock'));}
}
export async function restoreIsolated(file){
 const marker=await validateHome(),dir=await fs.realpath(path.join(home,'backups'));
 if(dir.toLowerCase()!==path.resolve(home,'backups').toLowerCase())throw Error('Diretório redirecionado recusado.');
 const source=await fs.realpath(file);
 if(path.dirname(source)!==dir||!source.endsWith('.ruybak'))throw Error('Somente backup privado do laboratório.');
 const archive=decryptArchive(await fs.readFile(source),await key());
 if(archive.deviceId!==marker.deviceId)throw Error('Recuperação de outro dispositivo exige reconciliação explícita.');
 const c=await config(true),database='ruy_d1_restore_'+randomBytes(8).toString('hex');
 const owner=new pg.Client(c);await owner.connect();
 try{await owner.query('CREATE DATABASE '+database);}finally{await owner.end();}
 const dest={...c,database};
 // --clean é permitido SOMENTE neste banco vazio recém-criado acima, com nome
 // aleatório validado. Não existe parâmetro de destino nem restore sobre D1.
 await runPG(marker.bin,'pg_restore',['--clean','--if-exists','--no-owner','--no-acl','--exit-on-error','--single-transaction','--dbname='+database],dest,Buffer.from(archive.dump,'base64'));
 const db=new pg.Client(dest);await db.connect();
 try{
  const pending=(await db.query('SELECT operation_id FROM lab_outbox ORDER BY operation_id')).rows.map(r=>r.operation_id);
  if(JSON.stringify(pending)!==JSON.stringify(archive.pending))throw Error('Fila restaurada diverge do snapshot.');
  if(archive.recoveryState&&JSON.stringify(await recoveryState(db))!==JSON.stringify(archive.recoveryState))throw Error('Recibos, cursores ou lançamentos restaurados divergiram.');
  const attachments=path.join(home,'restore-attachments',database);await fs.mkdir(attachments,{recursive:true});
  for(const a of archive.attachments)await fs.writeFile(path.join(attachments,a.name),Buffer.from(a.bytes,'base64'),{flag:'wx'});
  // Banco recuperado não é registrado na API nem pode sincronizar automaticamente.
  return {database,pendingOperations:pending.length,attachments:archive.attachments.length,recoveryTablesVerified:archive.recoveryState?Object.keys(archive.recoveryState).length:0,syncEnabled:false};
 }finally{await db.end();}
}
export async function backupStatus(){
 await validateHome();try{return JSON.parse(await fs.readFile(path.join(home,'backup-status.json'),'utf8'));}
 catch(e){if(e.code!=='ENOENT')throw e;return {state:'unknown',externalProtected:false};}
}
export async function backupConfig(){
 await validateHome();
 let value;
 try{value=JSON.parse(await fs.readFile(path.join(home,'backup-settings.json'),'utf8'));}
 catch(e){if(e.code!=='ENOENT')throw e;value={enabled:true,intervalMinutes:60,retain:24};}
 if(typeof value.enabled!=='boolean'||!Number.isInteger(value.intervalMinutes)||value.intervalMinutes<1||value.intervalMinutes>1440||!Number.isInteger(value.retain)||value.retain<2||value.retain>365)throw Error('Configuração de backup inválida.');
 return value;
}
