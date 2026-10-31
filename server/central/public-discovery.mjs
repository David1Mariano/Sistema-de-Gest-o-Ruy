import {createPublicKey,sign,verify} from 'node:crypto';
import {isIP} from 'node:net';

// Deployment metadata is public. Only the server holds the Ed25519 signing key.
// Signing authenticates a future API-origin change independently of its DNS/TLS.
export function publicApiOrigin(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port&&!['443'].includes(u.port)||!u.hostname.includes('.')||isIP(u.hostname)||u.hostname.endsWith('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.localhost')||u.hostname==='localhost')throw Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
 return u.origin;
}
export function discoveryKey(value){
 if(typeof value!=='string'||! /^[A-Za-z0-9+/]{59}=$/.test(value))throw Error('PUBLIC_DISCOVERY_KEY_REQUIRED');
 const key=createPublicKey({key:Buffer.from(value,'base64'),format:'der',type:'spki'});
 if(key.asymmetricKeyType!=='ed25519'||key.export({format:'der',type:'spki'}).toString('base64')!==value)throw Error('PUBLIC_DISCOVERY_KEY_REQUIRED');
 return key;
}
function payload(d){
 return JSON.stringify({contract:d.contract,deploymentId:d.deploymentId,generation:d.generation,issuedAt:d.issuedAt,expiresAt:d.expiresAt,apiOrigin:d.apiOrigin});
}
function fields(d,{deploymentId,now=Date.now(),minimumGeneration=0}={}){
 if(d?.contract!=='RUY-PUBLIC-API/2'||! /^[a-f0-9-]{36}$/.test(d.deploymentId||'')||deploymentId&&d.deploymentId!==deploymentId)throw Error('DISCOVERY_DEPLOYMENT_REFUSED');
 if(!Number.isSafeInteger(d.generation)||d.generation<1||d.generation<minimumGeneration)throw Error('DISCOVERY_ROLLBACK_REFUSED');
 const issued=Date.parse(d.issuedAt),expires=Date.parse(d.expiresAt);
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+60000||expires<=now||expires<=issued||expires-issued>24*3600000||new Date(issued).toISOString()!==d.issuedAt||new Date(expires).toISOString()!==d.expiresAt)throw Error('DISCOVERY_EXPIRED_OR_INVALID');
 if(publicApiOrigin(d.apiOrigin)!==d.apiOrigin)throw Error('DISCOVERY_ORIGIN_REFUSED');
}
export function signedDiscovery({deploymentId,generation,apiOrigin,privateKey,now=Date.now(),validForMs=3600000}){
 const d={contract:'RUY-PUBLIC-API/2',deploymentId,generation,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+validForMs).toISOString(),apiOrigin:publicApiOrigin(apiOrigin)};
 fields(d,{now});return {...d,signature:sign(null,Buffer.from(payload(d)),privateKey).toString('base64')};
}
export function verifyDiscovery(d,{publicKey,deploymentId,minimumGeneration=0,now=Date.now()}){
 const expected=['apiOrigin','contract','deploymentId','expiresAt','generation','issuedAt','signature'];
 if(!d||JSON.stringify(Object.keys(d).sort())!==JSON.stringify(expected)||typeof d.signature!=='string'||! /^[A-Za-z0-9+/]{86}==$/.test(d.signature))throw Error('SIGNED_DISCOVERY_REQUIRED');
 fields(d,{deploymentId,minimumGeneration,now});
 if(!verify(null,Buffer.from(payload(d)),discoveryKey(publicKey),Buffer.from(d.signature,'base64')))throw Error('DISCOVERY_SIGNATURE_REFUSED');
 return {endpoint:d.apiOrigin,generation:d.generation,expiresAt:Date.parse(d.expiresAt)};
}
