import {test} from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {config,validateHome} from '../../server/d1-lab/environment.mjs';
import {poolFor,seedSynthetic} from '../../server/d1-lab/core.mjs';
import {catalogSave} from '../../server/d1-lab/catalog.mjs';
import {save} from '../../server/d1-lab/entities.mjs';
import {base44,setSession} from '../../lab/d1/client.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
test('Cadastros offline: permissões, contratos oficiais, fila, dados pessoais, versões e rollback',async()=>{
 const pool=poolFor(await config()),marker=await validateHome(),originalFetch=globalThis.fetch;
 const server=createServer(pool,marker.deviceId);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 // Use this test's pool instead of an unrelated historical API on port 18087.
 const nativeFetch=(url,options={})=>new Promise((resolve,reject)=>{const target=new URL(url);const req=http.request({host:'127.0.0.1',port:server.address().port,path:target.pathname+target.search,method:options.method||'GET',headers:{...options.headers,Host:new URL(origin).host}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(options.body);});
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 globalThis.dispatchEvent=()=>true;
 try{
  const accounts=await seedSynthetic(pool),sessions=[];
  for(const a of accounts){const r=await nativeFetch(origin+'/api/d1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:a.login,password:a.password})});assert.equal(r.status,200);sessions.push({...await r.json(),cookie:r.headers.get('set-cookie').split(';')[0]});}
  const [admin,writer,viewer]=sessions;
  const call=async(entity,id,body,s=admin)=>{
   const r=await nativeFetch(origin+'/api/d1/catalog/'+entity+(id?'/'+id:''),{method:body?'POST':'GET',headers:{Cookie:s.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
  };
  const cmd=data=>({operationId:randomUUID(),operation:'create',baseVersion:null,data});
  const suffix=randomUUID().slice(0,8),categoryId=randomUUID(),category=cmd({name:'FICTICIO Categoria '+suffix,status:'ativo',group:'operacao'});
  assert.equal((await call('ExpenseCategory',categoryId,category)).status,200);
  assert.equal((await call('ExpenseCategory',categoryId,category)).body.replay,true);
  assert.equal((await call('ExpenseCategory',randomUUID(),category,viewer)).status,403);
  assert.equal((await call('ExpenseCategory','',null,writer)).body.records.length,0);
  assert.equal((await call('ExpenseCategory',categoryId,{operationId:randomUUID(),operation:'update',baseVersion:99,data:{name:'FICTICIO Velho'}})).status,409);
  const supplierId=randomUUID(),supplier=cmd({name:'FICTICIO Fornecedor '+suffix,status:'ativo'});
  assert.equal((await call('Supplier',supplierId,supplier)).status,200);
  const item=cmd({name:'FICTICIO Produto '+suffix,status:'ativo',unit:'kg',minimum_stock:1,preferred_supplier_id:supplierId,preferred_supplier_name:supplier.data.name});
  assert.equal((await call('InventoryItem',randomUUID(),item)).status,200);
  assert.equal((await call('InventoryItem',randomUUID(),{...item,operationId:randomUUID(),data:{...item.data,current_stock:100}})).status,400);
  assert.equal((await call('SystemSettings',randomUUID(),cmd({tolerance_minutes:5,coverage_config:'{}',company_name:'FICTICIO Ruy'}),writer)).status,403);
  assert.equal((await call('SystemSettings',randomUUID(),cmd({tolerance_minutes:5,coverage_config:'{}',company_name:'FICTICIO Ruy'}))).status,200);
  const sectorId=randomUUID(),sectorName='FICTICIO Setor privado '+suffix;
  await save(pool,admin.user,marker.deviceId,'Sector',sectorId,cmd({name:sectorName,status:'ativo'}));
  const employeeId=randomUUID(),employee=cmd({name:'FICTICIO Colaborador '+suffix,status:'ativo',hire_type:'clt',admission_date:'2026-01-02',sector:sectorName,cpf:'FICTICIO DOCUMENTO',salary:1234.56});
  assert.equal((await call('Employee',employeeId,employee,writer)).status,403);
  assert.equal((await call('Employee',employeeId,employee)).status,200);
  assert.equal((await call('Employee','',null)).body.records[0].salary,1234.56);
  const failed=cmd({name:'FICTICIO Rollback '+suffix,status:'ativo'}),failedId=randomUUID();
  await assert.rejects(catalogSave(pool,admin.user,marker.deviceId,'Supplier',failedId,failed,()=>{throw Error('FICTICIO falha transacional');}));
  assert.equal((await pool.query('SELECT 1 FROM d2_catalog WHERE id=$1',[failedId])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM lab_outbox WHERE operation_id=$1',[failed.operationId])).rowCount,0);
  // ACK perdido: o cliente reenvia mesmo ID e não persiste CPF/payload no browser.
  setSession(admin);globalThis.fetch=async(url,options={})=>nativeFetch(origin+url,{...options,headers:{...options.headers,Cookie:admin.cookie,Origin:origin}});
  const normal=globalThis.fetch,data={...employee.data,name:'FICTICIO ACK '+suffix};let lostId;
  globalThis.fetch=async(...args)=>{const r=await normal(...args);lostId=(await r.clone().json()).record.id;throw Error('ACK perdido sintético');};
  await assert.rejects(base44.entities.Employee.create(data));
  assert.equal(store.size,1);assert.equal([...store.values()][0].includes('FICTICIO DOCUMENTO'),false);assert.equal([...store.values()][0].includes('1234.56'),false);
  globalThis.fetch=normal;assert.equal((await base44.entities.Employee.create(data)).id,lostId);assert.equal(store.size,0);
  // Revogação/rebaixamento no servidor: não vaza CPF/salário nem pelo endpoint legado.
  await pool.query("UPDATE lab_users SET role='writer' WHERE id=$1",[admin.user.id]);
  const projected=await call('Employee','',null);assert.equal(projected.body.records[0].salary,undefined);assert.equal(projected.body.records[0].cpf,undefined);
  const legacy=await nativeFetch(origin+'/api/d1/entities/Employee',{headers:{Cookie:admin.cookie}});const legacyRows=await legacy.json();assert.equal(legacyRows.records[0].cpf,undefined);
  assert.equal((await call('Employee',randomUUID(),employee)).status,403);
  const rename={operationId:randomUUID(),operation:'update',baseVersion:1,data:{name:'FICTICIO Setor novo '+suffix},confirmRename:true,renameImpact:{colaboradores:2,funcoes:0}};
  const cascaded=await save(pool,admin.user,marker.deviceId,'Sector',sectorId,rename);
  assert.equal(cascaded.cascata.length,2);assert.ok(cascaded.cascata.every(r=>r.record.salary===undefined&&r.record.cpf===undefined));
  const replay=await save(pool,admin.user,marker.deviceId,'Sector',sectorId,rename);
  assert.ok(replay.cascata.every(r=>r.record.salary===undefined));
 }finally{setSession(null);globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));await pool.end();}
});
