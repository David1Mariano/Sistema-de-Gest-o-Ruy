// Two actual Electron processes, separate DPAPI/device/Chromium profiles and
// individual accounts. All SQL is confined to a freshly named synthetic DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,X509Certificate} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {config,installation,home} from '../../server/d1-lab/environment.mjs';
import {pg,digest} from '../../server/d1-lab/core.mjs';
import {identityPassword} from '../../server/d1-lab/identity.mjs';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {prepareCandidateHistory} from './candidate-history-fixture.mjs';
import {powershell} from '../../server/d1-lab/environment.mjs';
import {createEnrollment,importEnrollment} from '../../desktop/shared-profile.mjs';
assert.equal(installation?.id,'final-dev-20261021');assert.equal(process.env.RUY_SHARED_LAB,'1');
const executable=path.resolve(process.env.RUY_SHARED_ELECTRON_EXE||'desktop/node_modules/electron/dist/electron.exe');
const packaged=process.env.RUY_SHARED_PACKAGED==='1',exec=promisify(execFile),suffix=randomBytes(8).toString('hex');
const root=path.join(home,'shared-test-'+suffix);await fs.mkdir(root);
const centralRoot=path.join(process.env.LOCALAPPDATA,'GestaoRuy','central-lab-'+suffix);await fs.mkdir(centralRoot);
await exec('icacls.exe',[centralRoot,'/inheritance:r','/grant:r','*'+powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value')+':(OI)(CI)F'],{windowsHide:true});
const prep=JSON.parse(await fs.readFile('artifacts/central-preparacao-20261027/package-prep.3.json','utf8'));
assert.equal(prep.sha256,'361db183d7fe6be175ab8584c156eb05cce35c202480edcef271e12db19ee35f');
const {createHash}=await import('node:crypto');const hashFile=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
assert.equal(await hashFile(prep.zip),prep.sha256);const manifest=JSON.parse(await fs.readFile(path.join(prep.directory,'manifest.json'),'utf8'));for(const entry of manifest.files)assert.equal(await hashFile(path.join(prep.directory,entry.path)),entry.sha256);
const {initializeCentralSchema,grantCentralRuntime}=await import(pathToFileURL(path.join(prep.directory,'server/central/schema.mjs')));
assert.equal(packaged,true,'This acceptance requires the real packaged candidate');

const output=path.resolve('artifacts/multicomputador-0.9.0-rc.2-20261027/packaged-two-clients',suffix);await fs.mkdir(output,{recursive:true});
const owner=await config(true),control=new pg.Client(owner);await control.connect();
const database='ruy_d1_rc_'+randomBytes(8).toString('hex');await control.query('CREATE DATABASE '+database+' OWNER ruy_d1_owner');await control.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');await control.end();
let pool=new pg.Pool({...owner,database}),host,tlsPort,ready,relay,relayPort,online=false,historical;const sockets=new Set();const children=new Set(),profiles=[];
const password=randomBytes(24).toString('hex'),workspace=randomUUID(),users=[randomUUID(),randomUUID()],tokens=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
const common={recordId:randomUUID(),expenseId:randomUUID(),revenueId:randomUUID(),stockId:randomUUID(),attachmentId:randomUUID(),coordination:root};
const openssl='C:/Program Files/Git/usr/bin/openssl.exe';
const opensslRun=args=>exec(openssl,args,{windowsHide:true});
const file=name=>path.join(root,name),read=name=>fs.readFile(file(name),'utf8');
const readLog=async()=>{try{return (await fs.readFile(path.join(centralRoot,'central.log'),'utf8')).trim().split('\n').map(v=>JSON.parse(v));}catch{return [];}};
const waitReady=async(after=0)=>{for(let n=0;n<400;n++){const lines=await readLog();const found=lines.slice(after).find(v=>v.event==='ready');if(found){ready=found;tlsPort=found.tlsPort;return found;}if(host?.exitCode!==null)throw Error('PREP3_HOST_REFUSED');await new Promise(r=>setTimeout(r,100));}throw Error('PREP3_START_TIMEOUT');};
const disconnectRelay=()=>{online=false;for(const socket of sockets)socket.destroy();};
async function start(){
 const offset=(await readLog()).length;
 host=spawn(path.join(prep.directory,'runtime/RuyCentralService.exe'),['--console',path.join(prep.directory,'runtime/node.exe'),path.join(prep.directory,'scripts/central/supervisor.mjs'),centralRoot],{windowsHide:true,stdio:['pipe','ignore','ignore']});
 await waitReady(offset);online=true;
}
async function stop(){
 disconnectRelay();if(!host||host.exitCode!==null)return;const ended=new Promise(r=>host.once('exit',r));host.stdin.write('shutdown\n');let timer;try{await Promise.race([ended,new Promise((_,j)=>{timer=setTimeout(()=>j(Error('PREP3_GRACEFUL_STOP_TIMEOUT')),45000);})]);}finally{clearTimeout(timer);}assert.equal(host.exitCode,0);await assert.rejects(fs.stat(path.join(centralRoot,'supervisor.lock')),e=>e.code==='ENOENT');
}
async function launch(i,phase){
 const profile=profiles[i],fixture={...common,side:i===0?'A':'B',phase,operationId:randomUUID(),email:'electron-'+i+'@example.invalid',password};
 await fs.writeFile(path.join(profile,'synthetic-fixture.json'),JSON.stringify(fixture));
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('RUY_')||k==='ELECTRON_RUN_AS_NODE')delete env[k];
 Object.assign(env,{RUY_SHARED_LAB:'1',RUY_SHARED_CLIENT_TEST_ROOT:profile,PATH:[path.join(process.env.SystemRoot,'System32'),process.env.SystemRoot,path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0')].join(';')});
 await assert.rejects(()=>exec(path.join(process.env.SystemRoot,'System32/where.exe'),['node.exe'],{env,cwd:profile,windowsHide:true}));
 const args=[...(packaged?[]:['desktop/shared-main.mjs']),'--shared-client-smoke'];
 const code=await new Promise((r,j)=>{const child=spawn(executable,args,{env,cwd:process.cwd(),windowsHide:true,stdio:'ignore'});children.add(child);const timer=setTimeout(()=>{child.kill();j(Error('OWN_ELECTRON_TEST_TIMEOUT'));},240000);child.once('error',j);child.once('exit',code=>{children.delete(child);clearTimeout(timer);r(code);});});
 assert.equal(code,0,'OWN_ELECTRON_EXIT_FAILED');
 const proof=JSON.parse(await fs.readFile(path.join(profile,'acceptance-result.json'),'utf8'));assert.equal(proof.passed,true,JSON.stringify(proof));assert.equal(proof.packaged,packaged);assert.equal(proof.phase,phase);
 await fs.copyFile(path.join(profile,'shared-window.png'),path.join(output,phase+'-'+i+'.png'));
 if(phase==='write')for(const name of ['history-audit','history-stock'])await fs.copyFile(path.join(profile,name+'.png'),path.join(output,name+'-'+i+'.png'));
 await fs.writeFile(path.join(output,phase+'-'+i+'.json'),JSON.stringify(proof,null,2));return proof;
}
try{
 await initializeCentralSchema(pool,{lab:true});
 const hash=await identityPassword(password);
 await opensslRun(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',file('ca.key'),'-out',file('ca.crt'),'-days','1','-subj','/CN=FICTICIO Ruy Test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 await opensslRun(['req','-new','-newkey','rsa:2048','-nodes','-keyout',file('server.key'),'-out',file('server.csr'),'-subj','/CN=localhost']);
 await fs.writeFile(file('server.ext'),'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
 await opensslRun(['x509','-req','-in',file('server.csr'),'-CA',file('ca.crt'),'-CAkey',file('ca.key'),'-CAcreateserial','-out',file('server.crt'),'-days','1','-extfile',file('server.ext')]);
 await fs.writeFile(file('client.ext'),'basicConstraints=critical,CA:FALSE\nextendedKeyUsage=clientAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n');
 for(let i=0;i<2;i++){
  const profile=path.join(home,'shared-electron-test-'+randomBytes(8).toString('hex'));await fs.mkdir(profile);profiles.push(profile);
  const pending=await createEnrollment(profile);await fs.writeFile(file('client-'+i+'.csr'),pending.csr);
  await opensslRun(['x509','-req','-in',file('client-'+i+'.csr'),'-CA',file('ca.crt'),'-CAkey',file('ca.key'),'-CAcreateserial','-out',file('client-'+i+'.crt'),'-days','1','-extfile',file('client.ext')]);
  await pool.query("INSERT INTO lab_users VALUES($1,$2,$3,'admin',true)",[users[i],'electron-'+i+'@example.invalid',hash]);
  await pool.query('INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by) VALUES($1,$2,now(),now(),$1)',[users[i],'FICTICIO Electron '+i]);
  await pool.query("INSERT INTO shared_memberships VALUES($1,$2,'admin',true)",[users[i],workspace]);
  await pool.query('INSERT INTO shared_devices VALUES($1,$2,$3,true)',[pending.deviceId,workspace,digest(tokens[i])]);
 }
 const runtimeRole='ruy_central_'+suffix,runtimePassword=randomBytes(32).toString('hex');
 const grantControl=new pg.Client(owner);await grantControl.connect();await grantControl.query(`CREATE ROLE ${runtimeRole} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${runtimePassword}'`);await grantControl.query(`GRANT CONNECT ON DATABASE ${database} TO ${runtimeRole}`);await grantControl.end();await grantCentralRuntime(pool,runtimeRole);
 const prepared=await prepareCandidateHistory({owner,pool,suffix,workspace,users,root:centralRoot,packageDirectory:prep.directory});historical=prepared.pool;common.history=prepared.history;
 const profile={contract:'RUY-CENTRAL/1',mode:'lab',enabled:true,syntheticOnly:true,pgBin:'C:/Program Files/PostgreSQL/17/bin',database:{host:'127.0.0.1',port:55483,database,user:runtimeRole},api:{host:'127.0.0.1',port:0},tls:{host:'127.0.0.1',port:0},history:prepared.configuration};
 const secrets={databasePassword:runtimePassword,historyPassword:prepared.password,backupKey:randomBytes(32).toString('hex'),identityPepper:randomBytes(32).toString('hex'),tlsKey:await read('server.key'),tlsCert:await read('server.crt'),tlsCa:await read('ca.crt'),devices:await Promise.all(profiles.map(async(p,i)=>({fingerprint:new X509Certificate(await read('client-'+i+'.crt')).fingerprint256,token:tokens[i]})))};
 await fs.writeFile(path.join(centralRoot,'central.json'),JSON.stringify(profile),{flag:'wx'});await fs.writeFile(path.join(centralRoot,'secrets.dpapi'),powershell('$v=[Console]::In.ReadToEnd();ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)',JSON.stringify(secrets)),{flag:'wx'});await pool.query('UPDATE central_deployment SET active=true,maintenance=false');
 // Laboratory-only TCP fault injection. TLS is not terminated by the relay;
 // both client certificates are authenticated by the immutable prep.3 server.
 relay=net.createServer(socket=>{if(!online){socket.destroy();return;}const upstream=net.connect(tlsPort,'127.0.0.1');sockets.add(socket);sockets.add(upstream);socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());socket.on('close',()=>{sockets.delete(socket);upstream.destroy();});upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});socket.pipe(upstream).pipe(socket);});await new Promise(r=>relay.listen(0,'127.0.0.1',r));relayPort=relay.address().port;
 await start();
 for(let i=0;i<2;i++){const pending=await createEnrollment(profiles[i]),authorization=file('authorization-'+i+'.json');await fs.writeFile(authorization,JSON.stringify({purpose:'RUY_SHARED_CLIENT_LAB',contract:'RUY-SHARED-LAB/1',deviceId:pending.deviceId,endpoint:'https://127.0.0.1:'+relayPort+'/',cert:await read('client-'+i+'.crt'),ca:await read('ca.crt'),token:tokens[i]}));await importEnrollment(profiles[i],authorization);}
 const first=await Promise.all([launch(0,'write'),launch(1,'write')]);assert.equal(first[0].version,'0.9.0-rc.2');
 const history=first.map(r=>r.history);assert.ok(history.every(r=>r?.auditVisible&&r.authenticatedDownload&&r.historicalWriteBlocked));
 const stored=(await pool.query('SELECT data,version FROM d1_central_records WHERE workspace_id=$1 AND id=$2',[workspace,common.recordId])).rows[0];assert.equal(stored.data.name,'FICTICIO Electron B');assert.equal(Number(stored.version),2);assert.equal(stored.data.admission_date,'2026-10-26');
 assert.equal(Number((await pool.query('SELECT count(*) FROM d1_central_receipts')).rows[0].count),7);
 const modules=await Promise.all([launch(0,'modules'),launch(1,'modules')]);
 const receiptCount=Number((await pool.query('SELECT count(*) FROM d1_central_receipts')).rows[0].count);assert.ok(receiptCount>30);
 const rollback=JSON.parse(await read('modules-rollback'));assert.equal((await pool.query('SELECT 1 FROM lab_outbox WHERE operation_id=$1',[rollback.operationId])).rowCount,0);assert.equal((await pool.query('SELECT 1 FROM d1_central_receipts WHERE operation_id=$1',[rollback.operationId])).rowCount,0);assert.equal(JSON.parse((await pool.query('SELECT data FROM d1_central_records WHERE id=$1',[rollback.payable])).rows[0].data.payload_json).status,'pendente');

 for(const table of ['d1_payroll_history','d1_attendance_history','d1_purchase_history']){const actors=(await pool.query('SELECT DISTINCT actor_id FROM '+table)).rows.map(r=>r.actor_id);assert.ok(actors.every(a=>users.includes(a)));assert.ok(actors.length>0);}
 assert.equal(Number((await pool.query("SELECT count(*) FROM lab_audit WHERE actor NOT IN ($1,$2)",users)).rows[0].count),0);
 console.log('PASS two Electron clients: independent login, A/B changes, stock, financial reversal, attachment and replay');
 const waitMarker=async name=>{for(let n=0;n<200;n++){try{await fs.access(file(name));return;}catch{await new Promise(r=>setTimeout(r,100));}}throw Error('OWN_RECONNECT_COORDINATION_TIMEOUT');};
 const reconnecting=Promise.all([launch(0,'reconnect'),launch(1,'reconnect')]);
 await Promise.all(['A-ready-reconnect','B-ready-reconnect'].map(waitMarker));const offset=(await readLog()).length,previous=ready.pid;disconnectRelay();process.kill(previous);await waitReady(offset);assert.notEqual(ready.pid,previous);
 await Promise.all(['A-offline-verified','B-offline-verified'].map(waitMarker));online=true;const reconnected=await reconnecting;
 console.log('PASS two live Electron clients: real TLS outage, critical writes refused, automatic recovery with the same individual session');
 await stop();await pool.end();pool=new pg.Pool({...owner,database});await start();
 const reopened=await Promise.all([launch(0,'reopen'),launch(1,'reopen')]);
 assert.equal(Number((await pool.query('SELECT count(*) FROM d1_central_receipts')).rows[0].count),receiptCount);
 assert.equal(Number((await pool.query("SELECT balance FROM d1_business_accounts WHERE workspace=$1 AND account='cash'",[workspace])).rows[0].balance),59800);
 assert.equal(Number((await pool.query('SELECT quantity FROM d1_business_stock WHERE workspace=$1 AND item=$2',[workspace,common.stockId])).rows[0].quantity),5000);
 const unbalanced=(await pool.query('SELECT operation FROM d1_business_entries WHERE workspace=$1 GROUP BY operation HAVING sum(cents)<>0',[workspace])).rowCount;assert.equal(unbalanced,0);
 assert.equal((await pool.query('SELECT a.account FROM d1_business_accounts a LEFT JOIN d1_business_entries e USING(workspace,account) WHERE a.workspace=$1 GROUP BY a.account,a.balance HAVING a.balance<>coalesce(sum(e.cents),0)',[workspace])).rowCount,0);
 assert.equal((await pool.query('SELECT s.item FROM d1_business_stock s LEFT JOIN d1_business_movements m USING(workspace,item) WHERE s.workspace=$1 GROUP BY s.item,s.quantity HAVING s.quantity<>coalesce(sum(m.delta),0)',[workspace])).rowCount,0);
 const executionOwner=(await pool.query('SELECT owner_id FROM shared_execution_scopes WHERE workspace_id=$1',[workspace])).rows[0].owner_id;
 assert.equal((await pool.query('SELECT 1 FROM identity_accounts WHERE user_id=$1',[executionOwner])).rowCount,0);
 assert.equal((await pool.query('SELECT 1 FROM shared_memberships WHERE user_id=$1',[executionOwner])).rowCount,0);
 const result={passed:true,packaged,centralPackage:'0.9.0-rc.1-prep.3',centralPackageSha256:prep.sha256,centralNativeHostConsole:true,workerCrashRecovered:true,gracefulStop:true,testOnlyTcpFaultRelay:true,history,historyReadOnly:true,historyAttachments:true,version:first[0].version,independentElectronProcesses:2,independentDeviceCertificates:2,individualUsers:2,realTLS:true,realCentralPostgreSQL:true,serverRestarted:true,clientsClosedAndReopened:true,realOutageWithClientsOpen:true,automaticReconnectSameSession:true,criticalWritesRefusedOffline:true,persistedSharedEmployeeVersion:2,committedOperations:receiptCount,replayAndReversalNotDuplicated:true,manualExpenseAndRevenue:true,sharedStock:true,attachments:true,externalNodeAbsentFromClientPath:true,localPostgresStartedByClients:false,physicalComputers:false,installed:false,operationalDatabaseChanged:false,balancedCentralLedger:true,stockMatchesAppendOnlyMovements:true,scopeOwnerCannotLogin:true,insufficientFundsRolledBack:true,first,modules,reconnected,reopened};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({passed:false,message:error.message,code:error.code||null}));console.error(error);process.exitCode=1;}
finally{for(const child of children)child.kill();await stop();disconnectRelay();if(relay?.listening)await new Promise(r=>relay.close(r));await historical?.end();await pool.end();}
