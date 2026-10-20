import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {createFixture} from './rc-fixture.mjs';
import {installation} from '../../server/d1-lab/environment.mjs';
import {createServer,origin} from '../../server/d1-lab/api.mjs';
import {hashPassword} from '../../server/d1-lab/core.mjs';
// Own ephemeral listener with canonical Host/Origin: no connection to an existing API.
export async function testDeliveryCsvApi({fixtureFactory=createFixture}={}){
 if(fixtureFactory!==createFixture)assert.equal(installation?.id,'i5r4-dev-20261020');else{assert.equal(process.env.RUY_D1_DELIVERY_LAB,'1');assert.equal(process.env.RUY_D1_RESTART_FIXTURE,'e5aaec701010f607');}
 const fixture=await fixtureFactory(),db=await fixture.database('local',['schema','entities','catalog','sync','operations','domain','attachments','business','delivery'].map(n=>'d1-lab/'+n+'.sql'));
 const actor=randomUUID(),device=randomUUID(),password=randomBytes(32).toString('hex'),server=createServer(db.pool,device);let session;
 try{
  await db.pool.query('INSERT INTO lab_device VALUES(true,$1)',[device]);await db.pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',await hashPassword(password)]);
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const call=(route,body,cookie=session?.cookie||'')=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/api/d1'+route,method:body?'POST':'GET',headers:{Host:new URL(origin).host,Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session?.csrf||''}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));res.on('error',reject);});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
  assert.equal((await call('/delivery/report.csv')).status,401);
  const login=await call('/login',{login:actor+'@example.invalid',password});assert.equal(login.status,200);session={cookie:login.headers.get('set-cookie').split(';')[0],csrf:(await login.json()).csrf};
  const customer=randomUUID(),menu=randomUUID();
  for(const [id,entity,data] of [[customer,'DeliveryCustomer',{name:'FICTICIO PRIVATE CUSTOMER',status:'ativo'}],[menu,'DeliveryMenuItem',{name:'FICTICIO =HYPERLINK PRIVATE ITEM',status:'ativo',unitCents:875}]])assert.equal((await call('/domain/command',{operationId:randomUUID(),entity,id,baseVersion:null,action:'save',data})).status,200);
  const order=randomUUID();assert.equal((await call('/domain/command',{operationId:randomUUID(),entity:'DeliveryOrder',id:order,baseVersion:null,action:'save',data:{date:'2026-10-19',provider:'own',fulfillment:'pickup',customerId:customer,driverId:'',items:[{id:randomUUID(),menuItemId:menu,quantityMilli:2500}],discountCents:0,deliveryCents:0,platformCents:0,paymentFeeCents:0}})).status,200);
  const response=await call('/delivery/report.csv');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/csv/);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('cache-control'),'no-store');
  const csv=await response.text();assert.ok(csv.includes(order));assert.ok(csv.includes('2188'));for(const value of ['PRIVATE','HYPERLINK',customer,menu,password])assert.equal(csv.includes(value),false);
  await db.pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actor]);assert.equal((await call('/delivery/report.csv')).status,403);await db.pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actor]);
  assert.equal((await call('/delivery/report.csv?token=FICTICIO')).status,404);await db.pool.query("UPDATE lab_sessions SET expires_at=now()-interval '1 second'");assert.equal((await call('/delivery/report.csv')).status,401);
  const report={checks:6,actualApi:true,dbPort:db.config.port,listener:'own-ephemeral',canonicalHost:new URL(origin).host,syntheticOnly:true,personalFieldsExported:false,operationalSyncEnabled:false};await fs.writeFile('logs/stage4-csv-api.json',JSON.stringify(report,null,2));console.log('PASS Delivery CSV API 6/6');return report;
 }finally{if(server.listening)await new Promise(r=>server.close(r));await fixture.close();}
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/test-delivery-csv-api.mjs'))await testDeliveryCsvApi();
