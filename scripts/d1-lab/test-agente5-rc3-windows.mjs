import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes,X509Certificate} from 'node:crypto';
import pg from 'pg';
import {config,validateHome,home,cluster,DB_PORT} from '../../server/d1-lab/environment.mjs';
import {digest} from '../../server/d1-lab/core.mjs';
import {provisionTLS} from '../../server/d1-lab/tls-provision.mjs';
import {createD1Central} from '../../server/sync-lab/d1-server.mjs';
import {createLocalServer} from '../../lab/c2-runtime/server/local/api.mjs';
import {createLabTransport} from '../../server/sync-lab/mtls-transport.mjs';
import {createFixture} from './rc-fixture.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||DB_PORT!==55437)throw Error('Only the disposable copied cluster is permitted.');
const marker=await validateHome();assert.equal(marker.restartFixture,process.env.RUY_D1_RESTART_FIXTURE);
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(55437,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const control=command=>new Promise((resolve,reject)=>{const child=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-l',path.join(home,'postgres.log'),'-o','-p 55437','-m','fast','-w','-t','300',command],{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Controlled clone operation failed.')));});
const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const close=server=>server?.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();
let started=false,pool,fixture,central,gateway,tls,child,done=false,exited;
try{
 await control('start');started=true;pool=new pg.Pool(await config(true));
 const directory=(await pool.query("SELECT current_setting('data_directory') AS directory")).rows[0].directory;assert.equal(path.resolve(directory).toLowerCase(),path.resolve(cluster).toLowerCase());
 for(const name of ['attachments','business']){
  const table=name==='attachments'?'d1_attachment_queue':'d1_business_local';
  if(!(await pool.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name)await pool.query(await fs.readFile(new URL('../../server/d1-lab/'+name+'.sql',import.meta.url),'utf8'));
 }
 // Additive preparation only inside this verified disposable clone.
 if(!(await pool.query("SELECT to_regclass('public.d1_local_reversals') AS name")).rows[0].name)await pool.query("CREATE TABLE d1_local_reversals(owner_id uuid NOT NULL,reference uuid NOT NULL,operation uuid NOT NULL,reason text NOT NULL,PRIMARY KEY(owner_id,reference),UNIQUE(operation))");
 if(!(await pool.query("SELECT to_regclass('public.d1_reconciliation') AS name")).rows[0].name)await pool.query("CREATE TABLE d1_reconciliation(id uuid PRIMARY KEY,actor uuid NOT NULL,plan_hash text NOT NULL,reason text NOT NULL,archive jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now())");
 await pool.query("ALTER TABLE d1_sync_queue DROP CONSTRAINT d1_sync_queue_state_check; ALTER TABLE d1_sync_queue ADD CHECK(state IN ('pending','sending','acknowledged','conflict','rejected','resolved'))");
 await pool.query('GRANT DELETE ON d1_records,d2_catalog,d1_operation_events,d1_stock_balances,d1_stock_movements,d1_financial_accounts,d1_financial_entries,d1_local_reversals,d1_sync_versions,d1_sync_shadow,d1_business_local TO ruy_d1_app');
 await pool.query('GRANT SELECT,INSERT ON d1_local_reversals,d1_reconciliation TO ruy_d1_app');
 assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='d1_attachment_cache' AND column_name='filename'")).rowCount,1);
 await pool.query('GRANT SELECT,INSERT,UPDATE ON d1_attachment_queue,d1_attachment_cache,d1_business_local TO ruy_d1_app');
 fixture=await createFixture();const C=await fixture.database('central',['sync-lab/d1-central.sql','sync-lab/attachments.sql','sync-lab/business.sql']);
 const serverCert=await fixture.certificate('server'),client=await fixture.certificate('client'),token=randomBytes(32).toString('hex'),workspace=randomUUID();
 central=createD1Central(C.pool,{attachments:true,business:true});await listen(central,18094);
 gateway=createLocalServer(C.pool,{origin:'http://127.0.0.1:18092',d1BridgeOrigin:'http://127.0.0.1:18094'});await listen(gateway,18092);
 const startTLS=async()=>{tls=createLabTransport({...serverCert,ca:client.cert,devices:[{fingerprint:new X509Certificate(client.cert).fingerprint256,token}]}).server;await listen(tls,18443);};await startTLS();
 const signal=path.join(fixture.home,'ui-ready.json'),evidence=path.join(fixture.home,'ui-evidence.json');
 const executable=process.env.RUY_A5_RC3_EXECUTABLE||path.resolve('desktop/node_modules/electron/dist/electron.exe');
 const args=[...(process.env.RUY_A5_RC3_EXECUTABLE?[]:[path.resolve('desktop')]),'--lab-smoke','--lab-employee-smoke','--lab-domain-smoke','--lab-attachments-smoke','--lab-rc3-smoke','--lab-attachment-ready='+signal,'--lab-evidence='+evidence];
 const appEnv={...process.env,RUY_D1_ALLOW_TESTS:'1',RUY_D1_TEST_API_PORT:'18091',RUY_D1_ATTACHMENTS_LAB:'1',RUY_D1_MTLS_LAB:'1'};delete appEnv.ELECTRON_RUN_AS_NODE;
 child=spawn(executable,args,{windowsHide:true,stdio:['pipe','ignore','pipe'],env:appEnv});
 child.stderr.on('data',bytes=>void fs.appendFile(path.join(fixture.home,'desktop-stderr.log'),bytes));
 exited=new Promise(resolve=>child.once('exit',code=>{done=true;resolve(code);}));child.once('error',()=>{done=true;});
 const exists=file=>fs.access(file).then(()=>true,()=>false);
 const wait=async file=>{for(let n=0;n<600;n++){if(await exists(file))return;if(done)throw Error('Windows acceptance exited early; inspect private evidence.');await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Windows acceptance handshake timeout.');};
 await wait(signal);const identity=JSON.parse(await fs.readFile(signal,'utf8'));assert.equal(identity.purpose,'A5_UI_SYNTHETIC_ONLY');assert.equal(identity.device,marker.deviceId);
 await pool.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[identity.actor,identity.device,workspace]);
 await C.pool.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),identity.device,identity.actor,workspace]);
 await provisionTLS(pool,{...client,ca:serverCert.cert,endpoint:'https://127.0.0.1:18443',actorId:identity.actor,deviceId:identity.device,workspaceId:workspace,token});
 await fs.writeFile(signal+'.provisioned','1',{flag:'wx'});
 await wait(signal+'.offline-request');await close(tls);await fs.writeFile(signal+'.offline-ready','1',{flag:'wx'});
 await wait(signal+'.online-request');await startTLS();await fs.writeFile(signal+'.online-ready','1',{flag:'wx'});
 assert.equal(await exited,0);
 const result=JSON.parse(await fs.readFile(evidence,'utf8'));assert.equal(result.attachments.remoteReceipt,true);assert.equal(result.attachments.viewerDenied,true);assert.equal(result.rc3.explicitReconciliationUI,true);assert.equal(result.rc3.financialReversalConfirmed,true);
 assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_attachment_objects')).rows[0].n,1);assert.equal((await C.pool.query('SELECT count(*)::int n FROM d1_attachment_audit')).rows[0].n,1);
 assert.equal((await C.pool.query('SELECT quantity FROM d1_business_stock WHERE workspace=$1',[workspace])).rows[0].quantity,'1000');
 const queue=(await pool.query('SELECT state FROM d1_attachment_queue WHERE actor=$1 AND id=$2',[identity.actor,result.attachments.id])).rows[0];assert.equal(queue.state,'acknowledged');
 await fs.writeFile('logs/agente5-rc3-windows.json',JSON.stringify({...result,physicalComputers:1,connectionLossSimulatedByOwnedTLSService:true,companyNetworkChanged:false,centralObjectCount:1,centralUploadAuditCount:1,centralStockMilli:1000},null,2));console.log('RC3_WINDOWS_ATTACHMENTS_OK');
}finally{
 if(child&&!done){child.stdin.end('shutdown\n');await exited;}
 await close(tls);await close(gateway);await close(central);if(pool)await pool.end();if(fixture)await fixture.close();if(started)await control('stop');
}
