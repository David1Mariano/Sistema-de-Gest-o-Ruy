import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createD1Transport} from '../../lab/d1/http-transport.mjs';
import {request,setSession,getSession} from '../../lab/d1/client.mjs';
import {validateAttachment,attachmentHash} from '../../server/d1-lab/attachment-contract.mjs';
import {allowedDownload} from '../../desktop/policy.mjs';
import {validateEnvelope} from '../../server/d1-lab/sync-contract.mjs';

test('A2 adaptation: exact D1 origin, credentials, CSRF and no fallback',async()=>{
 const seen=[],call=createD1Transport({fetchImpl:async(...args)=>{seen.push(args);return new Response('{}');}});
 await call('/login',{login:'FICTICIO@example.invalid',password:'FICTICIO synthetic only'});
 await call('/logout',{},'FICTICIO-CSRF');assert.equal(seen[0][0],'/api/d1/login');assert.equal(seen[1][1].headers['X-CSRF-Token'],'FICTICIO-CSRF');assert.equal(seen[1][1].credentials,'same-origin');assert.equal(seen[1][1].redirect,'error');
 await assert.rejects(call('/domain/command',{operationId:randomUUID()}),e=>e.outcome==='not_sent'&&e.code==='CSRF_REQUIRED');assert.equal(seen.length,2);
});
test('A2 adaptation: routes cannot escape D1 or select cloud',async()=>{
 let count=0;const call=createD1Transport({fetchImpl:()=>{count++;}});
 for(const route of ['https://example.invalid','//cloud.invalid/x','/../logout','/%2e%2e/logout','/a\\b','/me#secret','/ me','/%2fcloud'])await assert.rejects(call(route));assert.equal(count,0);
});
for(const status of [401,403,409,402,500,503])test('A2 adaptation: HTTP '+status+' preserves status/outcome/UUID without retry',async()=>{
 const operationId=randomUUID();let attempts=0;const call=createD1Transport({fetchImpl:async()=>{attempts++;return new Response(JSON.stringify({error:'FICTICIO rejection',code:'FICTICIO_CODE'}),{status});}});
 await assert.rejects(call('/domain/command',{operationId},'FICTICIO'),e=>e.status===status&&e.operationId===operationId&&e.code==='FICTICIO_CODE'&&e.outcome===(status<500?'rejected':'unknown'));assert.equal(attempts,1);
});
test('A2 adaptation: deadline covers stalled fetch and response body, including ignored abort',async()=>{
 for(const fetchImpl of [()=>new Promise(()=>{}),async()=>({status:200,ok:true,json:()=>new Promise(()=>{})})]){
  const call=createD1Transport({fetchImpl,timeoutMs:20});await assert.rejects(call('/domain/command',{operationId:randomUUID()},'FICTICIO'),e=>e.code==='TIMEOUT'&&e.outcome==='unknown');
 }
 let sent=false;await assert.rejects(createD1Transport({timeoutMs:0,fetchImpl:()=>{sent=true;}})('/logout',{},'FICTICIO'),e=>e.outcome==='not_sent');assert.equal(sent,false);
});
test('A2 adaptation: invalid success response is unknown; malformed 401 remains 401',async()=>{
 for(const status of [200,401])await assert.rejects(createD1Transport({fetchImpl:async()=>new Response('not json',{status})})('/logout',{},'FICTICIO'),e=>e.status===(status===401?401:503)&&e.outcome===(status===401?'rejected':'unknown'));
});
test('D1 existing session is invalidated on 401 without a second login mechanism',async()=>{
 const original=globalThis.fetch,dispatch=globalThis.dispatchEvent;const events=[];
 try{globalThis.dispatchEvent=e=>{events.push(e.type);};setSession({user:{id:randomUUID(),role:'admin'},csrf:'FICTICIO'});globalThis.fetch=async()=>new Response('invalid JSON',{status:401});await assert.rejects(request('/me'),e=>e.status===401);assert.equal(getSession(),null);assert.deepEqual(events,['d1-session-expired']);}
 finally{setSession(null);globalThis.fetch=original;globalThis.dispatchEvent=dispatch;}
});
test('A2 adaptation: real isolated HTTP lost reply retains unknown outcome and performs one write',async()=>{
 let writes=0;const server=http.createServer((req,res)=>{writes++;res.destroy();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const call=createD1Transport({fetchImpl:(url,opts)=>fetch('http://127.0.0.1:'+server.address().port+url,opts),timeoutMs:1000});await assert.rejects(call('/domain/command',{operationId:randomUUID()},'FICTICIO'),e=>e.outcome==='unknown');assert.equal(writes,1);}
 finally{await new Promise(r=>server.close(r));}
});
test('A4 checks reused against existing D1: MIME, extension, hash, base64 and bounded bytes',()=>{
 const fixture=(bytes,filename,mediaType)=>({id:randomUUID(),operationId:randomUUID(),recordId:randomUUID(),recordVersion:1,entity:'Employee',filename,mediaType,sha256:attachmentHash(bytes),bytes:bytes.toString('base64')});
 const bytes=Buffer.from('FICTICIO synthetic contract');const valid=fixture(bytes,'FICTICIO-check.txt','text/plain');assert.deepEqual(validateAttachment(valid),bytes);
 for(const patch of [{filename:'../FICTICIO-check.txt'},{filename:'FICTICIO-check.pdf'},{mediaType:'application/pdf'},{sha256:'0'.repeat(64)},{bytes:valid.bytes+'\n'},{recordVersion:0},{entity:'DeliveryOrder'},{url:'https://example.invalid'}])assert.throws(()=>validateAttachment({...valid,...patch}),e=>e.status===400);
 assert.throws(()=>validateAttachment(fixture(Buffer.from('FICTICIO '+'x'.repeat(524288)),'FICTICIO-large.txt','text/plain')));
 for(const [hex,name,type] of [['255044462d','FICTICIO-file.pdf','application/pdf'],['89504e470d0a1a0a','FICTICIO-file.png','image/png'],['ffd8ff','FICTICIO-file.jpg','image/jpeg'],['524946460000000057454250','FICTICIO-file.webp','image/webp']])assert.deepEqual(validateAttachment(fixture(Buffer.from(hex,'hex'),name,type)),Buffer.from(hex,'hex'));
});
test('A4 compatibility: no parallel signed download or bearer URL accepted in Electron',()=>{
 const id=randomUUID();assert.equal(allowedDownload('http://127.0.0.1:18087/api/d1/attachments/'+id+'/download'),true);
 for(const url of ['http://127.0.0.1:8080/api/anexos/'+id,'ruy-anexo://'+id,'https://example.invalid/file?token=FICTICIO','http://127.0.0.1:18087/api/d1/attachments/'+id+'/download?token=FICTICIO'])assert.equal(allowedDownload(url),false);
});
test('Delivery contract remains disabled in the actual RC3 envelope',()=>{
 assert.throws(()=>validateEnvelope({protocol:'D1LAB/1',operationId:randomUUID(),actorId:randomUUID(),deviceId:randomUUID(),workspaceId:randomUUID(),changes:[{entity:'DeliveryOrder',id:randomUUID(),baseVersion:null,data:{name:'FICTICIO order'}}]}),e=>e.status===400);
});
