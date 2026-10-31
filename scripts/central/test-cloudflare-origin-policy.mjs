import assert from 'node:assert/strict';
import {verifyHomologationTunnelConfig as verify,verifyConsultationTunnelConfig} from '../../server/central/cloudflare-origin-policy.mjs';
const ca='C:/Users/Pichau/AppData/Local/GestaoRuy/central-lab-79402bbf27e83425/test-ca.pem';
const base={ingress:[{hostname:'api.ruycaldodecana.com.br',service:'https://127.0.0.1:18716',originRequest:{originServerName:'ADM-RUY',caPool:ca,noTLSVerify:false}},{service:'http_status:404'}]};
const checks=[];
assert.equal(verify(base,ca).originTlsVerified,true);checks.push('exact-authorized-origin-accepted');
for(const [name,change] of [
 ['unverified-tls',c=>{c.ingress[0].originRequest.noTLSVerify=true;}],
 ['wrong-certificate-name',c=>{c.ingress[0].originRequest.originServerName='localhost';}],
 ['unapproved-ca',c=>{c.ingress[0].originRequest.caPool='C:/unapproved.pem';}],
 ['database-port',c=>{c.ingress[0].service='tcp://127.0.0.1:5432';}],
 ['other-api-private-data',c=>{c.ingress[0].service='https://127.0.0.1:18726';}],
 ['extra-service',c=>{c.ingress.splice(1,0,{hostname:'admin.example.invalid',service:'rdp://127.0.0.1:3389'});}],
 ['missing-fallback',c=>{c.ingress.pop();}],
 ['private-network-routing',c=>{c['warp-routing']={enabled:true};}]
]){const c=structuredClone(base);change(c);assert.throws(()=>verify(c,ca));checks.push(name+'-refused');}
const consultation=structuredClone(base);consultation.ingress[0].service='https://127.0.0.1:18726';consultation.ingress[0].originRequest.originServerName='api.ruycaldodecana.com.br';assert.equal(verifyConsultationTunnelConfig(consultation,ca).originTlsVerified,true);checks.push('consultation-exact-https-origin-accepted');assert.throws(()=>verify(consultation,ca));assert.throws(()=>verifyConsultationTunnelConfig(base,ca));checks.push('homologation-and-private-consultation-cannot-interchange-origins');
console.log(JSON.stringify({passed:true,checks,externalNetworkUsed:false,realDataRead:false}));
