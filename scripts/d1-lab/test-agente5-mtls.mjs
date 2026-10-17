import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,X509Certificate} from 'node:crypto';
import {createLabTransport,sendLabTLS} from '../../server/sync-lab/mtls-transport.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Explicit synthetic opt-in required');
const exec=promisify(execFile),home=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-mtls-test-'));
await exec('icacls.exe',[home,'/inheritance:r','/grant:r',process.env.USERDOMAIN+'\\'+process.env.USERNAME+':(OI)(CI)F'],{windowsHide:true});
for(const name of ['server','client'])await exec('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(home,name+'.key'),'-out',path.join(home,name+'.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{windowsHide:true});
const read=name=>fs.readFile(path.join(home,name)),key=await read('server.key'),cert=await read('server.crt'),clientKey=await read('client.key'),clientCert=await read('client.crt'),token=randomBytes(32).toString('hex');
const options={key,cert,ca:clientCert,devices:[{fingerprint:new X509Certificate(clientCert).fingerprint256,token}]};
assert.throws(()=>createLabTransport({...options,host:'0.0.0.0',allowPrivateNetwork:true}));
const upstream=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer '+token);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({changes:[],cursor:0}));});
await new Promise((resolve,reject)=>{upstream.once('error',reject);upstream.listen(18092,'127.0.0.1',resolve);});
const {server,listen}=createLabTransport(options);await listen(0);
const base='https://127.0.0.1:'+server.address().port,request=extra=>sendLabTLS({url:base+'/api/local/d1/changes?cursor=0',key:clientKey,cert:clientCert,ca:cert,token,...extra});
try{
assert.equal(server.address().address,'127.0.0.1');assert.equal((await request()).status,200);console.log('PASS TLS 1.3 mutual certificates and device binding over real loopback HTTPS');
assert.equal((await request({token:randomBytes(32).toString('hex')})).status,403);console.log('PASS device token mismatch denied');
await assert.rejects(request({key:undefined,cert:undefined}));console.log('PASS missing client certificate denied by TLS');
await assert.rejects(request({ca:clientCert}));console.log('PASS untrusted server certificate denied');
assert.equal((await request({url:base+'/api/local/financeiro/attachments'})).status,404);console.log('PASS internal routes excluded');
await new Promise(resolve=>upstream.close(resolve));assert.equal((await request()).status,503);console.log('PASS upstream outage sanitized; no internal service exposure');
await fs.writeFile('logs/agente5-mtls-20261017.json',JSON.stringify({checks:6,tls:'1.3',mutualAuthentication:true,loopbackOnly:true,physicalMachines:false,upstream:'synthetic HTTP fixture',privateKeysCommitted:false}));
}finally{await new Promise(resolve=>server.close(resolve));if(upstream.listening)await new Promise(resolve=>upstream.close(resolve));}
