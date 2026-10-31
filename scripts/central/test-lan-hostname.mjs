import assert from 'node:assert/strict';
import https from 'node:https';
// Resolve only inside this test to loopback. No hosts/DNS/adapter edits and no
// listeners on the LAN. The production client uses normal Windows resolution.
export async function testLanHostname({port,ca}){
 const request=name=>new Promise((resolve,reject)=>{
  const r=https.get('https://'+name+':'+port+'/api/local/d1/connection',{ca,rejectUnauthorized:true,lookup:(_host,options,callback)=>options.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4),headers:{'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);
 });
 assert.equal(await request('ADM-RUY'),200);
 await assert.rejects(request('wrong.ficticio.example.invalid'),e=>e.code==='ERR_TLS_CERT_ALTNAME_INVALID');
 return {passed:true,tlsHostname:'ADM-RUY',wrongHostnameRejected:true,privateFixtureCA:true,clientCertificate:false,lookupOverriddenInTestOnly:true,physicalLanTest:false};
}
