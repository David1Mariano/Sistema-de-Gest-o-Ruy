import https from 'node:https';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {isIP} from 'node:net';
import {seal,unseal,validateHome,installation} from './environment.mjs';
import {uuid,fail} from './core.mjs';
export function validateTLS(value){
 const endpoint=new URL(value.endpoint);
 if(installation?.tlsPort&&endpoint.href!=='https://127.0.0.1:'+installation.tlsPort+'/')throw fail(403,'TLS endpoint outside installation namespace.');
 const privateIP=isIP(endpoint.hostname)===4&&(/^(10\.|192\.168\.)/.test(endpoint.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(endpoint.hostname));
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||endpoint.hostname!=='127.0.0.1'&&!(value.authorizedPrivateLab===true&&privateIP)||!endpoint.port||!uuid(value.actorId)||!uuid(value.deviceId)||!uuid(value.workspaceId)||!/^[a-f0-9]{64}$/.test(value.token||''))throw fail(400,'Invalid laboratory TLS provision.');
 const cert=new X509Certificate(value.cert),now=Date.now();
 if(now<Date.parse(cert.validFrom)||now>=Date.parse(cert.validTo)||!cert.checkPrivateKey(createPrivateKey(value.key)))throw fail(400,'Invalid or expired client certificate.');
 new X509Certificate(value.ca);return value;
}
export async function provisionTLS(pool,value){
 if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw fail(403,'Synthetic opt-in required.');
 await validateHome();validateTLS(value);
 const binding=(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[value.actorId])).rows[0];
 const actor=(await pool.query('SELECT active,role FROM lab_users WHERE id=$1',[value.actorId])).rows[0];
 const device=(await pool.query('SELECT id FROM lab_device WHERE singleton')).rows[0];
 if(!actor?.active||actor.role!=='admin'||device?.id!==value.deviceId||binding?.device_id!==value.deviceId||binding?.workspace_id!==value.workspaceId)throw fail(403,'TLS provision does not match authorized device.');
 await seal('sync-tls-'+value.actorId+'.dpapi',{...value,purpose:'D1_C2_MTLS_LAB_ONLY'});
 return {actorId:value.actorId,deviceId:value.deviceId,workspaceId:value.workspaceId,endpoint:value.endpoint,provisioned:true};
}
export function tlsRequest(value){
 validateTLS(value);
 return (token,route,body)=>new Promise((resolve,reject)=>{
  if(token!==value.token)return reject(fail(403,'TLS device credential mismatch.'));
  const target=new URL('/api/local/d1'+route,value.endpoint);
  const method=route.startsWith('/attachments/')&&body?'PUT':body?'POST':'GET';
  const request=https.request(target,{key:value.key,cert:value.cert,ca:value.ca,minVersion:'TLSv1.3',method,timeout:7000,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})}},response=>{
   let size=0;const chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024)response.destroy(Error('TLS response limit'));else chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>{try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(response.statusCode!==200)return reject(fail([400,403,409,413].includes(response.statusCode)?response.statusCode:503,'Laboratory TLS request refused.'));resolve(result);}catch{reject(fail(503,'Invalid TLS response.'));}});
  });
  request.on('timeout',()=>request.destroy(Error('TLS timeout')));request.on('error',reject);request.end(body?JSON.stringify(body):undefined);
 });
}
export async function provisionedRequest(binding){
 const value=await unseal('sync-tls-'+binding.actor+'.dpapi');
 if(value.purpose!=='D1_C2_MTLS_LAB_ONLY'||value.actorId!==binding.actor||value.deviceId!==binding.device_id||value.workspaceId!==binding.workspace_id)throw fail(403,'TLS binding mismatch.');
 return {token:value.token,request:tlsRequest(value)};
}
