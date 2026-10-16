import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {config,validateHome,unseal} from '../../server/d1-lab/environment.mjs';
import {config as centralConfig} from '../../server/sync-lab/environment.mjs';
import {pg,poolFor,hashPassword,digest} from '../../server/d1-lab/core.mjs';
import {save} from '../../server/d1-lab/entities.mjs';
import {catalogSave,catalogList} from '../../server/d1-lab/catalog.mjs';
import {synchronizeD1,syncStatus,centralOrigin} from '../../server/d1-lab/sync.mjs';
import {syncState} from '../../lab/d1/sync-state.mjs';
import {createStockItem} from '../../server/d1-lab/operations.mjs';
import {domainCommand,domainList,domainPreview} from '../../server/d1-lab/domain.mjs';
import {productionWitness} from './production-witness.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Opt-in necessário: reinicia somente laboratório D1.');
const exec=promisify(execFile),cli=fileURLToPath(new URL('../d1-lab.mjs',import.meta.url));
const control=(...args)=>exec(process.execPath,[cli,...args],{windowsHide:true,timeout:30000});
const marker=await validateHome(),localConfig=await config(),ownerConfig=await config(true);
let A=poolFor(localConfig),B,owner=new pg.Client(ownerConfig);await owner.connect();
const central=new pg.Client(await centralConfig('central',true));await central.connect();
const actorA=randomUUID(),actorB=randomUUID(),deviceB=randomUUID(),workspace=randomUUID(),suffix=randomUUID().slice(0,8);
const peerDatabase='ruy_d1_peer_'+randomBytes(8).toString('hex');
let tokenA,tokenB,checks=0;
const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};
const health=productionWitness;
const production=await health();
const command=data=>({operationId:randomUUID(),operation:'create',baseVersion:null,data});
const principalA={id:actorA,role:'admin'},principalB={id:actorB,role:'admin'};
const send=async(token,route,body)=>{
 const r=await fetch(centralOrigin+'/d1'+route,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const value=await r.json();if(!r.ok)throw Object.assign(Error('Resposta central de teste'),{status:r.status});return value;
};
const snapshot=async(pool,actor)=>({records:(await pool.query('SELECT * FROM d1_records WHERE owner_id=$1 ORDER BY id',[actor])).rows,queue:(await pool.query('SELECT q.* FROM d1_sync_queue q JOIN lab_outbox o USING(operation_id) WHERE o.actor=$1 ORDER BY operation_id',[actor])).rows,binding:(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[actor])).rows});
try{
 await check('guarda recusa rede externa e testemunha da produção é verificada',async()=>{await assert.rejects(fetch('https://example.invalid'),e=>e.code==='ENETUNREACH'||e.code==='ENOTFOUND'||e.cause?.code==='ENOTFOUND');if(!production.absentOnNewMachineLab)assert.equal(production.release,'20261015T155237724Z-d597121d');});
 const password=randomBytes(24).toString('hex');
 await A.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actorA,actorA+'@example.invalid',await hashPassword(password)]);
 await exec(process.execPath,[fileURLToPath(new URL('./provision-sync.mjs',import.meta.url)),actorA,workspace],{windowsHide:true,timeout:30000});
 tokenA=(await unseal('sync-'+actorA+'.dpapi')).token;
 await owner.query('CREATE DATABASE '+peerDatabase);
 const peerOwner=new pg.Client({...ownerConfig,database:peerDatabase});await peerOwner.connect();
 try{
  await peerOwner.query('BEGIN');
  for(const name of ['schema.sql','entities.sql','catalog.sql','sync.sql','operations.sql','domain.sql'])await peerOwner.query(await fs.readFile(new URL('../../server/d1-lab/'+name,import.meta.url),'utf8'));
  await peerOwner.query('INSERT INTO lab_device VALUES(true,$1)',[deviceB]);
  await peerOwner.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actorB,actorB+'@example.invalid',await hashPassword(randomBytes(24).toString('hex'))]);
  await peerOwner.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actorB,deviceB,workspace]);
  await peerOwner.query('REVOKE ALL ON DATABASE '+peerDatabase+' FROM PUBLIC');
  await peerOwner.query('GRANT CONNECT ON DATABASE '+peerDatabase+' TO ruy_d1_app');
  await peerOwner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO ruy_d1_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO ruy_d1_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ruy_d1_app; REVOKE UPDATE ON lab_outbox,lab_audit,d1_rh_history FROM ruy_d1_app');
  await peerOwner.query('COMMIT');
 }catch(e){await peerOwner.query('ROLLBACK');throw e;}finally{await peerOwner.end();}
 B=new pg.Pool({...localConfig,database:peerDatabase,max:5});B.on('error',()=>{});
 tokenB=randomBytes(32).toString('hex');await central.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(tokenB),deviceB,actorB,workspace]);
 const login=await fetch('http://127.0.0.1:18087/api/d1/login',{method:'POST',headers:{Origin:'http://127.0.0.1:18087','Content-Type':'application/json'},body:JSON.stringify({login:actorA+'@example.invalid',password})});assert.equal(login.status,200);
 const session={...await login.json(),cookie:login.headers.get('set-cookie').split(';')[0]};
 const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:18087/api/d1'+route,{method:body?'POST':'GET',headers:{Cookie:session.cookie,Origin:'http://127.0.0.1:18087','Content-Type':'application/json','X-CSRF-Token':session.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const sectorId=randomUUID(),roleId=randomUUID(),employeeId=randomUUID(),categoryId=randomUUID(),supplierId=randomUUID();
 const sectorName='FICTICIO Ponte setor '+suffix,roleName='FICTICIO Ponte função '+suffix;
 await check('API D1 gera sete cadastros reais na fila durável, sem envio automático',async()=>{
  for(const [entity,id,data] of [['Sector',sectorId,{name:sectorName,status:'ativo'}],['JobRole',roleId,{name:roleName,status:'ativo',sector_id:sectorId,sector_name:sectorName}]])assert.equal((await api('/entities/'+entity+'/'+id,command(data))).status,200);
  for(const [entity,id,data] of [['Employee',employeeId,{name:'FICTICIO Ponte colaborador '+suffix,status:'ativo',hire_type:'clt',admission_date:'2026-01-01',sector:sectorName,function:roleName,cpf:'FICTICIO DOC'}],['ExpenseCategory',categoryId,{name:'FICTICIO Ponte categoria '+suffix,status:'ativo',group:'operacao'}],['Supplier',supplierId,{name:'FICTICIO Ponte fornecedor '+suffix,status:'ativo'}],['InventoryItem',randomUUID(),{name:'FICTICIO Ponte produto '+suffix,status:'ativo',unit:'kg',minimum_stock:1}],['SystemSettings',randomUUID(),{company_name:'FICTICIO Ruy',tolerance_minutes:5,coverage_config:'{}'}]])assert.equal((await api('/catalog/'+entity+'/'+id,command(data))).status,200);
  assert.equal((await syncStatus(A,actorA)).pending,7);assert.equal((await central.query('SELECT 1 FROM d1_central_receipts WHERE actor_id=$1',[actorA])).rowCount,0);
 });
 await check('falha de internet mantém pendências e não mostra verde',async()=>{
  const status=await synchronizeD1(A,actorA,{request:async()=>{throw Error('FICTICIO offline');}});assert.equal(status.pending,7);assert.equal(syncState(status),'error');
 });
 await check('ACK perdido após COMMIT é reenviado com mesmo UUID sem duplicar',async()=>{
  const lost=await synchronizeD1(A,actorA,{request:async(...args)=>{await send(...args);throw Error('ACK perdido');}});assert.equal(lost.pending,7);
  assert.equal((await central.query('SELECT 1 FROM d1_central_receipts WHERE actor_id=$1',[actorA])).rowCount,1);
  const status=await synchronizeD1(A,actorA);assert.equal(status.pending,0);assert.equal(syncState(status),'unknown');
  assert.equal((await central.query('SELECT 1 FROM d1_central_receipts WHERE actor_id=$1',[actorA])).rowCount,7);
  assert.equal((await api('/pending')).body.total,0);
 });
 await check('A → central C2 → banco B preserva IDs, dados e não cria nova outbox',async()=>{
  const status=await synchronizeD1(B,actorB,{token:tokenB});assert.equal(syncState(status),'unknown');
  assert.equal((await B.query('SELECT count(*)::int n FROM d1_records WHERE owner_id=$1',[actorB])).rows[0].n,3);
  assert.equal((await B.query('SELECT 1 FROM lab_outbox')).rowCount,0);
  assert.equal((await catalogList(B,principalB,'Employee'))[0].id,employeeId);
 });
 await check('B → central → A aplica renomeação e vínculos como agregado transacional',async()=>{
  const renamed='FICTICIO Ponte renomeado '+suffix;
  await save(B,principalB,deviceB,'Sector',sectorId,{operationId:randomUUID(),operation:'update',baseVersion:1,data:{name:renamed},confirmRename:true,renameImpact:{colaboradores:1,funcoes:1}});
  assert.equal(syncState(await synchronizeD1(B,actorB,{token:tokenB})),'unknown');assert.equal(syncState(await synchronizeD1(A,actorA)),'unknown');
  assert.equal((await A.query('SELECT data FROM d1_records WHERE id=$1',[employeeId])).rows[0].data.sector,renamed);
  assert.equal((await A.query('SELECT data FROM d1_records WHERE id=$1',[roleId])).rows[0].data.sector_name,renamed);
  assert.equal((await A.query('SELECT 1 FROM lab_outbox WHERE actor=$1',[actorA])).rowCount,7);
 });
 await check('conflito simultâneo preserva proposta local e versão remota sem sobrescrita',async()=>{
  for(const [pool,actor,device,group] of [[A,principalA,marker.deviceId,'A'],[B,principalB,deviceB,'B']])await catalogSave(pool,actor,device,'ExpenseCategory',categoryId,{operationId:randomUUID(),operation:'update',baseVersion:1,data:{group}});
  assert.equal(syncState(await synchronizeD1(A,actorA)),'unknown');const conflicted=await synchronizeD1(B,actorB,{token:tokenB});assert.equal(syncState(conflicted),'error');assert.ok(conflicted.conflicts>0);
  assert.equal((await B.query('SELECT data FROM d2_catalog WHERE id=$1',[categoryId])).rows[0].data.group,'B');assert.equal((await B.query('SELECT data FROM d1_sync_shadow WHERE record_id=$1',[categoryId])).rows[0].data.group,'A');
 });
 await check('recibo adulterado não confirma e retry usa envelope congelado',async()=>{
  await catalogSave(A,principalA,marker.deviceId,'Supplier',supplierId,{operationId:randomUUID(),operation:'update',baseVersion:1,data:{observation:'FICTICIO recibo'}});
  const status=await synchronizeD1(A,actorA,{request:async(...args)=>({...await send(...args),operationId:randomUUID()})});assert.equal(status.pending,1);assert.equal(syncState(status),'error');
  assert.equal(syncState(await synchronizeD1(A,actorA)),'unknown');
 });
 await check('autorização central nega token inválido e identidade adulterada',async()=>{
  await assert.rejects(send('0'.repeat(64),'/changes?cursor=0'),e=>e.status===403);
  const row=(await A.query('SELECT envelope FROM d1_sync_queue q JOIN lab_outbox o USING(operation_id) WHERE o.actor=$1 LIMIT 1',[actorA])).rows[0];
  await assert.rejects(send(tokenA,'/push',{...row.envelope,actorId:randomUUID()}),e=>e.status===403);
  const otherToken=randomBytes(32).toString('hex');await central.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(otherToken),randomUUID(),randomUUID(),randomUUID()]);
  assert.equal((await send(otherToken,'/changes?cursor=0')).events.length,0);
  assert.equal((await api('/sync-now',{actorId:actorB})).status,400);
 });
 await check('crash real após recibo deixa lease/UUID duráveis, sem segundo efeito central',async()=>{
  await catalogSave(A,principalA,marker.deviceId,'Supplier',randomUUID(),command({name:'FICTICIO Crash ponte '+suffix,status:'ativo'}));
  await assert.rejects(exec(process.execPath,[fileURLToPath(new URL('./sync.mjs',import.meta.url)),actorA],{windowsHide:true,timeout:30000,env:{...process.env,RUY_D1_ALLOW_TESTS:'1',RUY_D1_SYNC_TEST_FAULT:'crash-after-receipt'}}),e=>e.code===77);
  assert.equal((await A.query("SELECT q.* FROM d1_sync_queue q JOIN lab_outbox o USING(operation_id) WHERE o.actor=$1 AND q.state='sending'",[actorA])).rowCount,1);
 });
 const beforeA=await snapshot(A,actorA),beforeB=await snapshot(B,actorB);
 await A.end();await B.end();await owner.end();A=null;B=null;owner=null;
 await control('stop-api');await control('stop-db');assert.deepEqual(await health(),production);await control('start-db');await control('start-api');
 A=poolFor(await config());B=new pg.Pool({...localConfig,database:peerDatabase,max:5});B.on('error',()=>{});
 await check('reinício PostgreSQL/API preserva dois dispositivos, fila, recibos e conflitos',async()=>{assert.deepEqual(await snapshot(A,actorA),beforeA);assert.deepEqual(await snapshot(B,actorB),beforeB);});
 await check('lease vencido retoma envio e mantém apenas um recibo por operação',async()=>{
  await A.query("UPDATE d1_sync_queue SET lease_until=now()-interval '1 second' WHERE state='sending' AND operation_id IN(SELECT operation_id FROM lab_outbox WHERE actor=$1)",[actorA]);
  assert.equal(syncState(await synchronizeD1(A,actorA)),'unknown');
  assert.equal((await central.query('SELECT 1 FROM d1_central_receipts WHERE actor_id=$1',[actorA])).rowCount,10);
 });
 await check('produção final preservada e sincronização operacional nunca ativada',async()=>{assert.deepEqual(await health(),production);assert.equal((await syncStatus(A,actorA)).operationalSyncEnabled,false);});
 await check('evento crítico chega ao outro dispositivo sem confirmar negócio nem duplicar saldo',async()=>{
  await createStockItem(A,principalA,marker.deviceId,{operationId:randomUUID(),itemId:randomUUID(),data:{name:'FICTICIO Estoque ponte '+suffix,status:'ativo',unit:'un',minimum_stock:0},initialMilli:1000,unitCents:100});
  const status=await synchronizeD1(A,actorA);assert.equal(status.pending,0);assert.equal(status.pendingBusiness,1);assert.equal(syncState(status),'pending');
  await synchronizeD1(B,actorB,{token:tokenB});
  assert.equal((await B.query('SELECT 1 FROM d1_operation_events WHERE owner_id=$1',[actorB])).rowCount,1);
  assert.equal((await B.query('SELECT 1 FROM d1_stock_balances WHERE owner_id=$1',[actorB])).rowCount,0);
 });
 await check('snapshots de produção e pagamento agregado sincronizam sem reaplicar baixa',async()=>{
  const raw=(await A.query("SELECT item_id FROM d1_stock_balances WHERE owner_id=$1",[actorA])).rows[0].item_id;
  const cmd=(entity,data,id=randomUUID(),baseVersion=null)=>({operationId:randomUUID(),entity,data,id,baseVersion,action:'save'});
  const product=(await domainCommand(A,principalA,marker.deviceId,cmd('ProductionProduct',{name:'FICTICIO Receita ponte '+suffix,status:'ativo',yield_quantity:1,yield_unit:'un',ingredients:[{inventory_item_id:raw,quantity:0.5}]}))).domainRecord;
  let daily=(await domainCommand(A,principalA,marker.deviceId,cmd('DailyProduction',{product_id:product.id,date:'2026-10-15',produced_quantity:1,loss_quantity:0,leftover_quantity:0,losses:[]}))).domainRecord;
  const p=await domainPreview(A,principalA,daily.id);
  const confirm={operationId:randomUUID(),entity:'DailyProduction',id:daily.id,baseVersion:1,action:'confirm',token:p.token};
  daily=(await domainCommand(A,principalA,marker.deviceId,confirm)).domainRecord;
  await domainCommand(A,principalA,marker.deviceId,cmd('FinancialExpense',{date:'2026-10-15',description:'FICTICIO Pagamento ponte',amount:25.01,status:'pago',beneficiary_type:'colaborador',beneficiary_id:employeeId}));
  const card=(await domainCommand(A,principalA,marker.deviceId,cmd('CardReceivable',{sale_date:'2026-10-15',expected_date:'2026-10-16',gross_amount:100,fee_amount:2,net_amount:98,status:'a_receber'}))).domainRecord;
  const title=(await domainList(A,principalA,'AccountsReceivable')).find(r=>r.id===card.accounts_receivable_id);
  await domainCommand(A,principalA,marker.deviceId,cmd('AccountsReceivable',{...title,status:'recebido',received_date:'2026-10-16'},title.id,title._version));
  const sent=await synchronizeD1(A,actorA);assert.equal(sent.pending,0);assert.equal(sent.rejected,0);
  await synchronizeD1(B,actorB,{token:tokenB});
  assert.equal((await domainList(B,principalB,'DailyProduction'))[0].local_status,'confirmado');
  assert.equal((await domainList(B,principalB,'EmployeePayment'))[0].net_amount,25.01);
  assert.equal((await domainList(B,principalB,'CardReceivable'))[0].status,'recebido');
  assert.equal((await domainList(B,principalB,'AccountsReceivable'))[0].net_amount,98);
  assert.equal((await B.query('SELECT 1 FROM d1_stock_balances WHERE owner_id=$1',[actorB])).rowCount,0);
  await assert.rejects(domainCommand(B,principalB,deviceB,{operationId:randomUUID(),entity:'DailyProduction',id:daily.id,baseVersion:daily._version,action:'cancel'}),e=>e.status===409);
  await domainCommand(A,principalA,marker.deviceId,{operationId:randomUUID(),entity:'DailyProduction',id:daily.id,baseVersion:daily._version,action:'cancel'});
  await synchronizeD1(A,actorA);await synchronizeD1(B,actorB,{token:tokenB});
  assert.equal((await domainList(B,principalB,'DailyProduction'))[0].local_status,'cancelado');
  assert.equal((await B.query('SELECT 1 FROM d1_stock_balances WHERE owner_id=$1',[actorB])).rowCount,0);
  assert.equal((await A.query('SELECT quantity_milli FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2',[actorA,raw])).rows[0].quantity_milli,'1000');
  // Same domain document edited independently on two devices must stay conflicted.
  const other=(await domainList(B,principalB,'ProductionProduct'))[0];
  await domainCommand(B,principalB,deviceB,cmd('ProductionProduct',{...other,instructions:'FICTICIO proposta B'},other.id,other._version));
  await domainCommand(A,principalA,marker.deviceId,cmd('ProductionProduct',{...product,instructions:'FICTICIO proposta A'},product.id,product._version));
  await synchronizeD1(A,actorA);const conflict=await synchronizeD1(B,actorB,{token:tokenB});assert.ok(conflict.conflicts>=1);
  assert.equal((await domainList(B,principalB,'ProductionProduct'))[0].instructions,'FICTICIO proposta B');
 });
 await check('RH A → C2 → B preserva vínculos de folha e autoria, sem duplicar despesa/estoque',async()=>{
  const cmd=(entity,data,id=randomUUID(),baseVersion=null)=>({operationId:randomUUID(),entity,data,id,baseVersion,action:'save'});
  let vale=(await domainCommand(A,principalA,marker.deviceId,cmd('Vale',{employee_id:employeeId,date:'2026-10-16',amount:30,type:'pix',status:'pendente',motive:'FICTICIO ponte RH'}))).domainRecord;
  let consumption=(await domainCommand(A,principalA,marker.deviceId,cmd('Consumption',{employee_id:employeeId,date:'2026-10-16',time:'12:10',product:'FICTICIO refeição ponte',quantity:1,amount:10,status:'registrado'}))).domainRecord;
  let payment=(await domainCommand(A,principalA,marker.deviceId,cmd('EmployeePayment',{employee_id:employeeId,payment_type:'salario',gross_amount:200,discount_amount:50,net_amount:150,payment_date:'2026-10-16',status:'pago'}))).domainRecord;
  vale=(await domainCommand(A,principalA,marker.deviceId,cmd('Vale',{status:'descontado',deduction_payment_id:payment.id,deduction_payment_version:payment._version},vale.id,vale._version))).domainRecord;
  payment=(await domainList(A,principalA,'EmployeePayment')).find(row=>row.id===payment.id);
  consumption=(await domainCommand(A,principalA,marker.deviceId,cmd('Consumption',{status:'cobrado',deduction_payment_id:payment.id,deduction_payment_version:payment._version},consumption.id,consumption._version))).domainRecord;
  await synchronizeD1(A,actorA,{request:async(...args)=>{await send(...args);throw Error('FICTICIO ACK RH perdido');}});
  assert.equal((await synchronizeD1(A,actorA)).pending,0);
  await synchronizeD1(B,actorB,{token:tokenB});
  const remoteVale=(await domainList(B,principalB,'Vale')).find(row=>row.id===vale.id);
  assert.equal(remoteVale.status,'descontado');assert.equal(remoteVale.employee_id,employeeId);assert.equal(remoteVale.deduction_payment_id,payment.id);
  assert.equal((await domainList(B,principalB,'Consumption')).find(row=>row.id===consumption.id).status,'cobrado');
  const remotePayment=(await domainList(B,principalB,'EmployeePayment')).find(row=>row.id===payment.id);
  assert.equal(remotePayment.rh_deductions.length,2);assert.equal(remotePayment.net_amount,150);
  assert.equal((await domainList(B,principalB,'FinancialExpense')).filter(row=>row.linked_payment_id===payment.id).length,1);
  assert.equal((await B.query('SELECT 1 FROM d1_stock_balances WHERE owner_id=$1',[actorB])).rowCount,0);
  const history=(await B.query('SELECT * FROM d1_rh_history WHERE owner_id=$1 AND record_id=$2 ORDER BY record_version',[actorB,vale.id])).rows;
  assert.equal(history.length,2);assert.ok(history.every(h=>h.actor_id===actorA&&h.device_id===marker.deviceId));
  await assert.rejects(domainCommand(B,principalB,deviceB,cmd('Vale',{status:'cancelado'},remoteVale.id,remoteVale._version)),e=>e.status===409);
  const receipts=(await central.query('SELECT count(*)::int n FROM d1_central_receipts WHERE actor_id=$1',[actorA])).rows[0].n;
  await synchronizeD1(A,actorA);await synchronizeD1(B,actorB,{token:tokenB});
  assert.equal((await central.query('SELECT count(*)::int n FROM d1_central_receipts WHERE actor_id=$1',[actorA])).rows[0].n,receipts);
 });
 await check('conflito RH preserva lançamento local e snapshot remoto para reconciliação',async()=>{
  const id=randomUUID(),base={employee_id:employeeId,date:'2026-10-16',type:'pix',amount:5,status:'pendente'};
  for(const [pool,principal,device,motive] of [[A,principalA,marker.deviceId,'FICTICIO proposta RH A'],[B,principalB,deviceB,'FICTICIO proposta RH B']])await domainCommand(pool,principal,device,{operationId:randomUUID(),entity:'Vale',id,baseVersion:null,action:'save',data:{...base,motive}});
  await synchronizeD1(A,actorA);const status=await synchronizeD1(B,actorB,{token:tokenB});assert.ok(status.conflicts>0);
  assert.equal((await domainList(B,principalB,'Vale')).find(row=>row.id===id).motive,'FICTICIO proposta RH B');
  assert.equal(JSON.parse((await B.query('SELECT data FROM d1_sync_shadow WHERE actor=$1 AND record_id=$2',[actorB,id])).rows[0].data.payload_json).motive,'FICTICIO proposta RH A');
  assert.deepEqual(await productionWitness(),production);
 });
 const result={checks,actorA,actorB,peerDatabase,central:'127.0.0.1:18086',operationalSyncEnabled:false,production,physicalComputers:false};
 await fs.writeFile('logs/d1-c2-bridge-evidence.json',JSON.stringify(result,null,2));console.log('D1_C2_BRIDGE_OK '+JSON.stringify(result));
}finally{await A?.end();await B?.end();await owner?.end();await central.end();}
