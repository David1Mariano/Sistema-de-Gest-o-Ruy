// Optional post-approval local TLS probe. Never reads user data, credentials,
// modifies trust stores, follows redirects or disables certificate validation.
import fs from 'node:fs/promises';import https from 'node:https';import tls from 'node:tls';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
const host='api.ruycaldodecana.com.br',port=Number(args['--port']||18726),caFile=args['--ca'];
if(!caFile||!Number.isInteger(port)||port<1024||port>65535)throw Error('PUBLIC_ORIGIN_CA_AND_APPROVED_LOCAL_PORT_REQUIRED');
const ca=await fs.readFile(caFile);if(ca.includes(Buffer.from('PRIVATE KEY')))throw Error('PUBLIC_CA_ONLY');
const result=await new Promise((resolve,reject)=>{
 const req=https.request({hostname:'127.0.0.1',port,servername:host,path:'/api/local/d1/connection',method:'GET',ca,minVersion:'TLSv1.2',rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>tls.checkServerIdentity(host,cert),headers:{Host:host,'X-Ruy-Sync-Contract':'RUY-SHARED-LAB/1','X-Forwarded-Proto':'https','CF-Connecting-IP':'127.0.0.1'}},res=>{const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>8192)res.destroy(Error('PUBLIC_METADATA_LIMIT'));else chunks.push(b);});res.on('error',reject);res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks));resolve({status:res.statusCode,originCertificateValidated:true,expectedSan:host,available:value.available===true,consultationOnly:value.consultationOnly===true,operationalDataRead:false});}catch{reject(Error('INVALID_ORIGIN_RESPONSE'));}});});req.setTimeout(10000,()=>req.destroy(Error('ORIGIN_TIMEOUT')));req.on('error',reject);req.end();
});console.log(JSON.stringify(result));if(result.status!==200||!result.consultationOnly)process.exitCode=2;
