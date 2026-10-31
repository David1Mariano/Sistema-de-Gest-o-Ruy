// Temporary, synthetic LAN activation. The immutable prep.4 bootstrap and
// supervisor run unchanged. Never use this profile for operational data.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL, fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createPublicKey} from 'node:crypto';
import {createUserTransport} from '../../server/sync-lab/user-transport.mjs';
import {signedDiscovery,publicApiOrigin} from '../../server/central/public-discovery.mjs';
import {loadProfile} from '../../server/central/profile.mjs';

process.env.RUY_D1_INSTALLATION='final-dev-20261021';
process.env.RUY_D1_ALLOW_TESTS='1';
process.env.RUY_D1_TEST_API_PORT='18133';
process.env.RUY_SHARED_LAB='1';
const {config,home,cluster,powershell,validateHome}=await import('../../server/d1-lab/environment.mjs');
const {pg}=await import('../../server/d1-lab/core.mjs');
const {identityPassword}=await import('../../server/d1-lab/identity.mjs');
const {prepareCandidateHistory}=await import('./candidate-history-fixture.mjs');
const exec=promisify(execFile),repo=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const json=async f=>JSON.parse((await fs.readFile(f,'utf8')).replace(/^\uFEFF/,''));
const write=async(f,v)=>fs.writeFile(f,JSON.stringify(v,null,2));
const sha=async f=>createHash('sha256').update(await fs.readFile(f)).digest('hex');
const [action,receiptArg]=process.argv.slice(2);
assert.equal(process.env.COMPUTERNAME,'ADM-RUY','Server hostname changed; recheck the LAN binding');
assert.equal((await validateHome()).purpose,'RUY_D1_SYNTHETIC_ONLY');
const prep=await json(path.join(repo,'artifacts/central-sessoes-20261027/package-prep.4.json'));
const pgBin='C:/Program Files/PostgreSQL/17/bin';
const openssl='C:/Program Files/Git/usr/bin/openssl.exe';
const run=async(exe,args)=>exec(exe,args,{windowsHide:true,timeout:60000,maxBuffer:1024*1024});
async function verifyPackage(){
 assert.equal(await sha(prep.zip),prep.sha256);
 for(const e of (await json(path.join(prep.directory,'manifest.json'))).files){const p=path.resolve(prep.directory,e.path);assert.ok(p.startsWith(path.resolve(prep.directory)+path.sep));assert.equal(await sha(p),e.sha256);}
}
const owner=await config(true);
assert.equal(owner.port,55483);assert.equal(owner.host,'127.0.0.1');
async function ensureCluster(){
 let active=false;try{await run(path.join(pgBin,'pg_ctl.exe'),['status','-D',cluster]);active=true;}catch{/* The validated synthetic cluster may be stopped. */}
 if(!active)await run(path.join(pgBin,'pg_ctl.exe'),['start','-D',cluster,'-l',path.join(home,'lan-homologation-postgres.log'),'-w','-t','30']);
 const c=new pg.Client(owner);await c.connect();
 try{const r=(await c.query("SELECT current_setting('port') port,current_setting('listen_addresses') addresses")).rows[0];assert.equal(r.port,'55483');assert.equal(r.addresses,'127.0.0.1');}finally{await c.end();}
 return !active;
}
async function loadReceipt(){
 const f=path.resolve(receiptArg||'');
 assert.ok(f.startsWith(path.join(repo,'artifacts','homologacao-lan-ativa-'))&&path.basename(f)==='server.json');
 const r=await json(f);assert.equal(r.purpose,'RUY_TEMPORARY_SYNTHETIC_LAN');
 assert.match(r.database,/^ruy_d1_rc_[a-f0-9]{16}$/);assert.match(path.basename(r.profile),/^central-lab-[a-f0-9]{16}$/);
 assert.equal(path.dirname(r.profile).toLowerCase(),path.join(process.env.LOCALAPPDATA,'GestaoRuy').toLowerCase());
 assert.equal(r.prepSha256,prep.sha256);assert.ok(Date.parse(r.expiresAt)>Date.now(),'Temporary activation expired');
 return {r,file:f};
}
if(action==='--prepare'){
 await verifyPackage();
 const release=await json(path.join(repo,'artifacts/multicomputador-0.10.0-rc.2-20261028/release-manifest.json'));
 const installer=path.join(repo,'artifacts/multicomputador-0.10.0-rc.2-20261028/build/Sistema-Ruy-Compartilhado-0.10.0-rc.2-Setup.exe');
 assert.equal(await sha(installer),release.sha256);
 const bind='192.168.1.102';
 const local=JSON.parse((await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress) | ConvertTo-Json -Compress"])).stdout);
 assert.ok(local.includes(bind),'Observed server address changed; do not bind a stale IP');
 const probe=net.createServer();await new Promise((r,j)=>{probe.once('error',j);probe.listen(18716,bind,r);});await new Promise(r=>probe.close(r));
 const clusterStarted=await ensureCluster(),suffix=randomBytes(8).toString('hex');
 const out=path.join(repo,'artifacts','homologacao-lan-ativa-'+suffix),publicDir=path.join(out,'RUI-PC-ESTOQUE');
 const profile=path.join(process.env.LOCALAPPDATA,'GestaoRuy','central-lab-'+suffix);
 await fs.mkdir(publicDir,{recursive:true});await fs.mkdir(profile);
 await run('icacls.exe',[profile,'/inheritance:r','/grant:r','*'+powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value')+':(OI)(CI)F']);
 const database='ruy_d1_rc_'+suffix,workspace=randomUUID(),users=[randomUUID(),randomUUID()];
 const control=new pg.Client(owner);await control.connect();
 try{await control.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await control.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');}finally{await control.end();}
 const pool=new pg.Pool({...owner,database});let history;
 try{
  const {initializeCentralSchema,grantCentralRuntime}=await import(pathToFileURL(path.join(prep.directory,'server/central/schema.mjs')));
  await initializeCentralSchema(pool,{lab:true});
  const firstPassword=randomBytes(32).toString('hex'),hash=await identityPassword(firstPassword);
  for(let i=0;i<users.length;i++){
   const email=i===0?'pichau.teste@example.invalid':'estoque.teste@example.invalid';
   await pool.query('INSERT INTO lab_users VALUES($1,$2,$3,\'admin\',true)',[users[i],email,hash]);
   await pool.query('INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by) VALUES($1,$2,now(),now(),$1)',[users[i],'FICTICIO Homologacao LAN '+i]);
   await pool.query("INSERT INTO shared_memberships VALUES($1,$2,'admin',true)",[users[i],workspace]);
  }
  const runtimeRole='ruy_central_'+suffix,password=randomBytes(32).toString('hex');
  const c=new pg.Client(owner);await c.connect();try{await c.query(`CREATE ROLE ${runtimeRole} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);await c.query(`GRANT CONNECT ON DATABASE ${database} TO ${runtimeRole}`);}finally{await c.end();}
  await grantCentralRuntime(pool,runtimeRole);
  const prepared=await prepareCandidateHistory({owner,pool,suffix,workspace,users,root:profile,packageDirectory:prep.directory});history=prepared.pool;
  const f=name=>path.join(profile,name);
  await run(openssl,['req','-x509','-newkey','rsa:3072','-nodes','-keyout',f('test-ca.key'),'-out',f('test-ca.pem'),'-days','7','-subj','/CN=Ruy HOMOLOGACAO FICTICIA '+suffix,'-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign']);
  await run(openssl,['req','-new','-newkey','rsa:3072','-nodes','-keyout',f('test-server.key'),'-out',f('test-server.csr'),'-subj','/CN=ADM-RUY']);
  await fs.writeFile(f('test-server.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:ADM-RUY,IP:127.0.0.1\n');
  await run(openssl,['x509','-req','-in',f('test-server.csr'),'-CA',f('test-ca.pem'),'-CAkey',f('test-ca.key'),'-CAcreateserial','-out',f('test-server.pem'),'-days','3','-extfile',f('test-server.ext')]);
  const p={contract:'RUY-CENTRAL/1',mode:'lab',authentication:'user-session',enabled:true,syntheticOnly:true,pgBin,database:{host:'127.0.0.1',port:55483,database,user:runtimeRole},api:{host:'127.0.0.1',port:0},tls:{host:'127.0.0.1',port:0,serverName:'ADM-RUY'},history:prepared.configuration};
  const secrets={databasePassword:password,historyPassword:prepared.password,backupKey:randomBytes(32).toString('hex'),identityPepper:randomBytes(32).toString('hex'),tlsKey:await fs.readFile(f('test-server.key'),'utf8'),tlsCert:await fs.readFile(f('test-server.pem'),'utf8'),tlsCa:await fs.readFile(f('test-ca.pem'),'utf8')};
  await write(f('central.json'),p);await fs.writeFile(f('secrets.dpapi'),powershell('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify(secrets)),{flag:'wx'});
  // Remove temporary unencrypted key files after DPAPI sealing. Only these
  // freshly created files are removed; no operational certificates are read.
  await fs.unlink(f('test-server.key'));await fs.unlink(f('test-ca.key'));
  await pool.query('UPDATE central_deployment SET active=true,maintenance=false');
  await fs.copyFile(f('test-ca.pem'),path.join(publicDir,'Ruy-Homologacao-CA.cer'));
  const caSha256=await sha(path.join(publicDir,'Ruy-Homologacao-CA.cer'));
  const r={purpose:'RUY_TEMPORARY_SYNTHETIC_LAN',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+48*3600000).toISOString(),server:'ADM-RUY',bind,port:18716,endpoint:'https://ADM-RUY:18716/',database,workspace,profile,publicDir,prepDirectory:prep.directory,prepSha256:prep.sha256,installer,installerSha256:release.sha256,clusterStarted,accounts:['pichau.teste@example.invalid','estoque.teste@example.invalid'],passwordsSet:[],caSha256,production:false};
  await write(path.join(out,'server.json'),r);
  for(const name of ['Trust-ServerPublicCa.ps1','Test-RuyLanConnection.ps1','Update-SharedClient.ps1'])await fs.copyFile(path.join(repo,'scripts/central',name),path.join(publicDir,name));
  await write(path.join(publicDir,'autorizacao-homologacao.json'),{scope:'Temporary fictitious LAN only; no network/firewall/DNS changes',computer:'RUI-PC-ESTOQUE',approvedBy:'Usuario: autorizacao explicita de homologacao LAN nesta conversa',expiresAt:r.expiresAt,testLanConnectivityApproved:true,trustServerCaApproved:true,caSha256,updateClientApproved:true,installerSha256:release.sha256});
  await fs.copyFile(path.join(repo,'artifacts/multicomputador-0.10.0-rc.2-20261028/release-manifest.json'),path.join(publicDir,'release-manifest.json'));
  await fs.writeFile(path.join(publicDir,'CA-SHA256.txt'),caSha256+'\r\n');
  console.log(JSON.stringify({prepared:true,receipt:path.join(out,'server.json'),publicDir,caSha256,passwordsDistributed:false,realDataImported:false}));
 }finally{await history?.end();await pool.end();}
}else if(action==='--set-password'){
 const {r,file}=await loadReceipt();await ensureCluster();let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>2048)throw Error('INPUT_LIMIT');}
 const body=JSON.parse(input);assert.ok(r.accounts.includes(body.email));const hash=await identityPassword(body.password);body.password='';input='';
 const pool=new pg.Pool({...owner,database:r.database});try{
  const c=await pool.connect();try{await c.query('BEGIN');const u=await c.query('UPDATE lab_users SET password_hash=$1 WHERE login=$2 RETURNING id',[hash,body.email]);assert.equal(u.rowCount,1);await c.query('UPDATE d1_principals SET active=false WHERE actor_id=$1',[u.rows[0].id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  r.passwordsSet=[...new Set([...r.passwordsSet,body.email])];await write(file,r);console.log('Senha individual definida apenas na central ficticia.');
 }finally{await pool.end();}
}else if(action==='--stop'){
 const {r}=await loadReceipt();await fs.writeFile(path.join(r.profile,'STOP-LAN'),'User requested safe shutdown\n');console.log('Encerramento seguro solicitado.');
}else if(action==='--check'){
 const {r,file}=await loadReceipt();const status=await json(path.join(path.dirname(file),'status.json'));assert.equal(status.running,true);
 const ca=await fs.readFile(path.join(r.publicDir,'Ruy-Homologacao-CA.cer'),'utf8');
 const call=(route,{token,body}={})=>new Promise((resolve,reject)=>{
  const req=https.request({hostname:r.bind,port:r.port,servername:'ADM-RUY',path:'/api/local/d1'+route,ca,minVersion:'TLSv1.2',timeout:10000,method:body?'POST':'GET',headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{let data='';res.on('data',v=>data+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));res.on('error',reject);});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('TIMEOUT')));req.end(body?JSON.stringify(body):undefined);
 });
 assert.equal((await call('/connection')).body.available,true);assert.equal((await call('/state')).status,401);
 const proof={timestamp:new Date().toISOString(),prep4:true,serverLanBinding:r.bind+':'+r.port,tlsHostnameValidated:'ADM-RUY',tlsVerificationDisabled:false,connection:true,anonymousDenied:true,loginChecked:false,physicalClientsChecked:false,operationalDataChanged:false};
 if(!r.passwordsSet.length){
  // Only the newly created fictitious accounts, before the user chooses any
  // password. The random check password and session tokens are never persisted.
  const password=randomBytes(32).toString('hex'),hash=await identityPassword(password),pool=new pg.Pool({...owner,database:r.database});
  try{await pool.query('UPDATE lab_users SET password_hash=$1 WHERE login=ANY($2::text[])',[hash,r.accounts]);}finally{await pool.end();}
  assert.equal((await call('/session/login',{body:{email:r.accounts[0],password:'FICTICIO senha incorreta'}})).status,401);
  for(const email of r.accounts){
   const login=await call('/session/login',{body:{email,password,clientId:randomUUID()}});assert.equal(login.status,200);
   assert.equal((await call('/state',{token:login.body.token})).status,200);
   assert.equal((await call('/session/logout',{token:login.body.token,body:{}})).status,200);
   assert.equal((await call('/state',{token:login.body.token})).status,401);
  }
  Object.assign(proof,{loginChecked:true,individualAccounts:2,incorrectPasswordRejected:true,authenticatedRead:true,logoutRevoked:true,clientCertificatesRequired:false,deviceApprovalRequired:false});
 }
 await write(path.join(path.dirname(file),'verificacao-'+Date.now()+'.json'),proof);console.log(JSON.stringify(proof));
}else if(action==='--start'){
 const {r,file}=await loadReceipt();await verifyPackage();
 try{await fs.access(path.join(r.profile,'STOP-LAN'));throw Error('TEMPORARY_CENTRAL_STOPPED_BY_USER');}catch(e){if(e.code!=='ENOENT')throw e;}
 await ensureCluster();
 const lock=path.join(r.profile,'lan-controller.lock');
 try{const old=await json(lock);let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}assert.equal(alive,false,'Temporary central already running');await fs.unlink(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
 await write(lock,{pid:process.pid,receipt:file});
 let child,relay,loopbackRelay,publicEdge,publicApiPort,ready,stopping=false,timer,recovering=false,checking=false;const sockets=new Set(),hostRestarts=[];
 let ngrokPublic,publicSecrets,discoveryPrivateKey;
 try{
  ngrokPublic=await json(path.join(r.profile,'ngrok-public.json'));
  assert.equal(ngrokPublic.contract,'RUY_NGROK_SYNTHETIC/1');assert.equal(ngrokPublic.syntheticOnly,true);
  assert.equal(ngrokPublic.database,r.database);assert.equal(ngrokPublic.expiresAt,r.expiresAt);
  assert.equal(publicApiOrigin(ngrokPublic.apiOrigin),ngrokPublic.apiOrigin);
  assert.equal(publicApiOrigin(ngrokPublic.tunnelOrigin),ngrokPublic.tunnelOrigin);
  assert.match(new URL(ngrokPublic.tunnelOrigin).hostname,/^[a-z0-9-]+\.ngrok-free\.(?:dev|app)$/);
  publicSecrets=(await loadProfile(r.profile)).secrets;
  discoveryPrivateKey=JSON.parse(powershell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}',await fs.readFile(path.join(r.profile,'ngrok-signing.dpapi'),'utf8'))).key;
  assert.equal(createPublicKey(discoveryPrivateKey).export({format:'der',type:'spki'}).toString('base64'),ngrokPublic.publicKey);
 }catch(e){if(e.code!=='ENOENT')throw e;if(ngrokPublic)throw Error('PUBLIC_GATEWAY_SECRETS_REQUIRED');}
 const state=async extra=>{
  let authorizedIdentity=false;try{const a=await json(path.join(r.profile,'authorized-real-identity.json'));assert.equal(a.contract,'RUY_AUTHORIZED_IDENTITY_EXCEPTION/1');assert.equal(a.identityOnly,true);authorizedIdentity=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  await write(path.join(path.dirname(file),'status.json'),{timestamp:new Date().toISOString(),temporary:true,syntheticOnly:true,businessDataSyntheticOnly:true,containsAuthorizedRealIdentity:authorizedIdentity,controllerPid:process.pid,endpoint:r.endpoint,...extra});
 };
 const lines=async()=>{try{return (await fs.readFile(path.join(r.profile,'central.log'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}};
 const shutdownHost=async()=>{
  if(child&&child.exitCode===null){const ended=new Promise(resolve=>child.once('exit',resolve));child.stdin.write('shutdown\n');let timeout;try{await Promise.race([ended,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('SAFE_SHUTDOWN_TIMEOUT')),45000);})]);}finally{clearTimeout(timeout);}}
 };
 const stop=async reason=>{
  if(stopping)return;stopping=true;clearInterval(timer);for(const s of sockets)s.destroy();
  for(const server of [relay,loopbackRelay,publicEdge?.server])if(server?.listening){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
  await shutdownHost();
  await state({running:false,reason,hostExitCode:child?.exitCode});await fs.unlink(lock);process.exitCode=child?.exitCode===0?0:2;
 };
 const ca=await fs.readFile(path.join(r.profile,'test-ca.pem'),'utf8');
  const request=(route,options={})=>new Promise((resolve,reject)=>{
   const q=https.request({hostname:'127.0.0.1',port:ready.tlsPort,path:'/api/local/d1'+route,ca:options.ca,minVersion:'TLSv1.2',timeout:10000,method:options.body?'POST':'GET',headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1',...(options.token?{Authorization:'Bearer '+options.token}:{}),...(options.body?{'Content-Type':'application/json'}:{})}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));res.on('error',reject);});q.on('timeout',()=>q.destroy(Error('TIMEOUT')));q.on('error',reject);q.end(options.body?JSON.stringify(options.body):undefined);
  });
 const publishReady=async extra=>{
  if(ngrokPublic&&publicApiPort!==ready.apiPort){
   if(publicEdge?.server.listening){publicEdge.server.closeAllConnections();await new Promise(resolve=>publicEdge.server.close(resolve));}
   publicEdge=createUserTransport({key:publicSecrets.tlsKey,cert:publicSecrets.tlsCert,apiPort:ready.apiPort,ngrokTunnel:true,publicHostname:new URL(ngrokPublic.tunnelOrigin).hostname,serviceDiscovery:()=>signedDiscovery({...ngrokPublic,privateKey:discoveryPrivateKey})});
   await publicEdge.listen(r.port);publicApiPort=ready.apiPort;
  }
  // The isolated host client uses a stable loopback TLS relay. Its CA remains
  // scoped to the existing test profile; Windows trust is never changed here.
  try{
   const c=await json(path.join(path.dirname(file),'cliente-pichau-isolado.json'));
   assert.equal(path.dirname(c.ClientProfile).toLowerCase(),home.toLowerCase());assert.match(path.basename(c.ClientProfile),/^shared-electron-test-[a-f0-9]{16}$/);
   assert.equal((await fs.realpath(c.ClientProfile)).toLowerCase(),path.resolve(c.ClientProfile).toLowerCase());
   const target=path.join(c.ClientProfile,'synthetic-endpoint.json'),temporary=target+'.'+process.pid+'.tmp';
   await write(temporary,{endpoint:'https://127.0.0.1:'+(ngrokPublic?ready.tlsPort:r.port)+'/',ca});await fs.rename(temporary,target);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  await state({running:true,hostPid:child.pid,workerPid:ready.pid,loopbackTlsPort:ready.tlsPort,hostClientPort:r.port,backupBeforeStart:true,trustedTlsVerified:true,unauthenticatedStateStatus:401,lanBinding:r.bind+':'+r.port,remoteComputerTested:false,realDataImported:false,...(ngrokPublic?{publicGateway:ngrokPublic.apiOrigin,publicOriginLoopbackOnly:true}:{}),...extra});
 };
 async function launchHost(){
  const offset=(await lines()).length;ready=null;let spawnError;
  child=spawn(path.join(prep.directory,'runtime/RuyCentralService.exe'),['--console',path.join(prep.directory,'runtime/node.exe'),path.join(prep.directory,'scripts/central/supervisor.mjs'),r.profile],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  child.on('error',e=>{spawnError=e;});
  for(let n=0;n<600&&!ready&&!stopping;n++){
   if(spawnError||child.exitCode!==null)throw Error('BOOTSTRAP_REFUSED');
   ready=(await lines()).slice(offset).find(v=>v.event==='ready');if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(stopping)return;assert.ok(ready,'BOOTSTRAP_TIMEOUT');
  assert.equal((await request('/connection',{ca})).body.available,true);assert.equal((await request('/state',{ca})).status,401);
  child.once('exit',()=>{if(!stopping)void recoverHost();});
 }
 async function recoverHost(){
  if(stopping||recovering)return;recovering=true;ready=null;for(const socket of sockets)socket.destroy();
  try{
   while(!stopping){
    if(Date.now()>Date.parse(r.expiresAt))return await stop('TEMPORARY_AUTHORIZATION_EXPIRED');
    try{await fs.access(path.join(r.profile,'STOP-LAN'));return await stop('USER_REQUEST');}catch(e){if(e.code!=='ENOENT')throw e;}
    while(hostRestarts.length&&hostRestarts[0]<Date.now()-10*60*1000)hostRestarts.shift();
    if(hostRestarts.length>=3)return await stop('NATIVE_HOST_RECOVERY_LIMIT');hostRestarts.push(Date.now());
    await state({running:false,recovering:true,hostRestartAttempts:hostRestarts.length});
    await new Promise(resolve=>setTimeout(resolve,Math.min(5000,1000*hostRestarts.length)));
    try{await launchHost();if(!stopping){await publishReady({nativeHostRecovered:true,hostRestartAttempts:hostRestarts.length});return;}}catch{await shutdownHost();/* Retry only within the bounded recovery budget. */}
   }
  }catch{await stop('NATIVE_HOST_RECOVERY_FAILED');}finally{recovering=false;}
 }
 try{
  await launchHost();
  // Transparent, temporary LAN forwarding: no TLS termination or trust bypass,
  // no database port forwarding, no firewall changes. Only observed /24 peers.
  const forward=socket=>{
   if((socket.remoteAddress!=='127.0.0.1'&&!/^192\.168\.1\.\d+$/.test(socket.remoteAddress||''))||stopping||!ready){socket.destroy();return;}
   const upstream=net.connect(ready.tlsPort,'127.0.0.1');sockets.add(socket);sockets.add(upstream);
   socket.setTimeout(30000,()=>socket.destroy());socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
   socket.on('close',()=>{sockets.delete(socket);upstream.destroy();});upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});socket.pipe(upstream).pipe(socket);
  };
  relay=net.createServer(forward);await new Promise((resolve,reject)=>{relay.once('error',reject);relay.listen(r.port,r.bind,resolve);});
  if(!ngrokPublic){loopbackRelay=net.createServer(forward);await new Promise((resolve,reject)=>{loopbackRelay.once('error',reject);loopbackRelay.listen(r.port,'127.0.0.1',resolve);});}
  await publishReady();
  console.log('Central prep.4 iniciada: '+r.endpoint+' (somente homologacao ficticia).');
  timer=setInterval(async()=>{if(checking||stopping||recovering)return;checking=true;try{
   if(Date.now()>Date.parse(r.expiresAt))return await stop('TEMPORARY_AUTHORIZATION_EXPIRED');
   try{await fs.access(path.join(r.profile,'STOP-LAN'));return await stop('USER_REQUEST');}catch(e){if(e.code!=='ENOENT')throw e;}
   const last=(await lines()).filter(v=>v.event==='ready').at(-1);if(last&&last.pid!==ready.pid){ready=last;await publishReady({workerRecovered:true});}
  }catch{await stop('CONTROLLER_GUARD_FAILED');}finally{checking=false;}},2000);
  process.on('SIGINT',()=>void stop('SIGINT'));process.on('SIGTERM',()=>void stop('SIGTERM'));
 }catch(e){await stop(e.message);throw e;}
}else throw Error('Use --prepare, --start, --check, --stop or --set-password <server.json>');
