// Narrow live homologation check: two packaged clients, original login/dashboard.
// No business writes, operational accounts, physical-computer access or install.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
process.env.RUY_D1_INSTALLATION='final-dev-20261021';process.env.RUY_D1_ALLOW_TESTS='1';process.env.RUY_D1_TEST_API_PORT='18133';process.env.RUY_SHARED_LAB='1';
const {config,home}=await import('../../server/d1-lab/environment.mjs');
const {pg}=await import('../../server/d1-lab/core.mjs');
const {identityPassword}=await import('../../server/d1-lab/identity.mjs');
const {default:asar}=await import('../../desktop/node_modules/@electron/asar/lib/asar.js');
const read=async f=>JSON.parse((await fs.readFile(f,'utf8')).replace(/^\uFEFF/,''));
const location=await read('artifacts/acesso-simples-20261028/ngrok-active-location.json'),receipt=await read(location.receipt);
const tunnel=await read(path.join(location.directory,'status.json'));assert.equal(tunnel.running,true);assert.equal(tunnel.domainAuthorizedByAuthenticatedAgent,true);
const owner=await config(true);assert.equal(owner.host,'127.0.0.1');assert.equal(owner.port,55483);assert.match(receipt.database,/^ruy_d1_rc_[a-f0-9]{16}$/);
const release=path.resolve('artifacts/multicomputador-0.10.0-rc.3-20261028'),executable=path.join(release,'build/win-unpacked/Sistema Ruy.exe'),archive=path.join(path.dirname(executable),'resources/app.asar');
const metadata=asar.extractFile(archive,'central-endpoint.json');assert.equal(JSON.parse(metadata).discoveryUrl,location.origin+'/.well-known/sistema-ruy.json');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,'0.10.0-rc.3');
const reference=await read(path.join(release,'frontend-reference/manifest.json'));
for(const entry of reference.files)assert.equal(createHash('sha256').update(asar.extractFile(archive,entry.file.split('/').join(path.sep))).digest('hex'),entry.sha256);
const pool=new pg.Pool({...owner,database:receipt.database}),ids=[randomUUID(),randomUUID()],password=randomBytes(32).toString('hex'),suffix=randomBytes(8).toString('hex');
const coordination=path.join(home,'shared-test-'+suffix),profiles=[],children=[];await fs.mkdir(coordination);
const output=path.join(location.directory,'packaged-login-'+suffix);await fs.mkdir(output);
let created=false;
try{
 const target=(await pool.query("SELECT current_database() db,current_setting('port') port,(SELECT purpose FROM central_deployment WHERE singleton) purpose")).rows[0];assert.equal(target.db,receipt.database);assert.equal(target.port,'55483');assert.equal(target.purpose,'RUY_CENTRAL_LAB');
 const hash=await identityPassword(password);
 for(let i=0;i<2;i++){
  const email='ngrok-electron-'+suffix+'-'+i+'@example.invalid';
  await pool.query("INSERT INTO lab_users(id,login,password_hash,role,active) VALUES($1,$2,$3,'admin',true)",[ids[i],email,hash]);created=true;
  await pool.query('INSERT INTO identity_accounts(user_id,full_name,verified_at,approved_at,approved_by) VALUES($1,$2,now(),now(),$1)',[ids[i],'FICTICIO Electron HTTPS '+i]);
  await pool.query("INSERT INTO shared_memberships(user_id,workspace_id,role,active) VALUES($1,$2,'admin',true)",[ids[i],receipt.workspace]);
  const profile=path.join(home,'shared-electron-test-'+randomBytes(8).toString('hex'));profiles.push(profile);await fs.mkdir(profile);
  const sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{windowsHide:true,encoding:'utf8'}).trim();
  execFileSync('icacls.exe',[profile,'/inheritance:r','/grant:r','*'+sid+':(OI)(CI)F'],{windowsHide:true});
  await fs.writeFile(path.join(profile,'synthetic-endpoint.json'),JSON.stringify({purpose:'RUY_SYNTHETIC_PUBLIC_DISCOVERY/1'}),{flag:'wx'});
  await fs.writeFile(path.join(profile,'public-endpoint.json'),metadata,{flag:'wx'});
  await fs.writeFile(path.join(profile,'synthetic-fixture.json'),JSON.stringify({phase:'public-login',userId:ids[i],role:'admin',email,password,recordId:randomUUID(),coordination}),{flag:'wx'});
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('RUY_D1_')||key.startsWith('PG')||key==='NODE_OPTIONS')delete env[key];
  env.RUY_SHARED_LAB='1';env.RUY_SHARED_CLIENT_TEST_ROOT=profile;env.PATH=(env.PATH||'').split(path.delimiter).filter(v=>!/nodejs|nvm/i.test(v)).join(path.delimiter);
  children.push(spawn(executable,['--shared-client-smoke'],{env,windowsHide:true,stdio:'ignore'}));
 }
 const results=[];
 for(const profile of profiles){
  let result;
  for(let n=0;n<700;n++){try{result=await read(path.join(profile,'acceptance-result.json'));break;}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.ok(result,'PUBLIC_ELECTRON_LOGIN_TIMEOUT');assert.equal(result.passed,true,result.code||result.message);assert.equal(result.packaged,true);assert.equal(result.originalDashboardOpened,true);
  const index=results.length;results.push(result);
  for(const name of ['login-window.png','dashboard-public.png'])await fs.copyFile(path.join(profile,name),path.join(output,'client-'+index+'-'+name));
 }
 const proof={at:new Date().toISOString(),passed:true,publicOrigin:location.origin,packagedClients:2,independentProfiles:true,embeddedElectron:true,externalNodeRemovedFromClientPath:true,originalFrontendFilesVerified:reference.files.length,originalLoginFirst:true,originalDashboardOpened:true,individualAccounts:true,clientCertificatesRequired:false,manualDeviceAuthorization:false,windowsTrustChanged:false,businessWrites:false,physicalSecondComputerTested:false,operationalAccountsOrDataTransferred:false,clients:results};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(proof,null,2));await fs.writeFile(path.join(location.directory,'packaged-login-location.json'),JSON.stringify({directory:output,profiles,passed:true},null,2));console.log(JSON.stringify(proof));
}finally{
 for(const child of children)if(child.exitCode===null)child.kill();
 if(created){await pool.query('UPDATE lab_users SET active=false WHERE id=ANY($1::uuid[])',[ids]);await pool.query('UPDATE shared_memberships SET active=false WHERE user_id=ANY($1::uuid[])',[ids]);await pool.query('DELETE FROM shared_sessions WHERE token_hash IN (SELECT token_hash FROM d1_principals WHERE actor_id=ANY($1::uuid[]))',[ids]);await pool.query('UPDATE d1_principals SET active=false WHERE actor_id=ANY($1::uuid[])',[ids]);}
 for(const profile of profiles)await fs.unlink(path.join(profile,'synthetic-fixture.json')).catch(()=>{});
 await pool.end();
}
