// Preload de TESTE. Nega todo TCP fora dos três destinos loopback autorizados.
// Não modifica firewall/rede Windows nem processos já existentes (incluindo 8080).
const net=require('node:net');
const allowedHosts=new Set(['127.0.0.1','localhost','::1']);
const allowedPorts=new Set([55436,18087,8080,18083,18086]);
if(process.env.RUY_D1_ALLOW_TESTS==='1')for(const port of [18080,18090,18091,18092,18443])allowedPorts.add(port);
if(process.env.RUY_D1_ALLOW_TESTS==='1'&&/^[a-f0-9]{16}$/.test(process.env.RUY_D1_RESTART_FIXTURE||''))allowedPorts.add(55437);
const audit={blocked:0};globalThis.__ruyLabNetworkAudit=audit;
function allowed(host,port){return allowedHosts.has(host)&&allowedPorts.has(Number(port));}
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const options=net._normalizeArgs(Array.isArray(args[0])?args[0]:args)[0];
 if(!options.path&&!allowed(options.host||'localhost',options.port)){
  audit.blocked++;throw Object.assign(Error('TEST_OFFLINE: saída externa bloqueada.'),{code:'ENETUNREACH'});
 }
 return originalConnect.apply(this,args);
};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,options){
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(!allowed(u.hostname,u.port|| (u.protocol==='https:'?443:80))){audit.blocked++;return Promise.reject(Object.assign(Error('TEST_OFFLINE: fetch externo bloqueado.'),{code:'ENETUNREACH'}));}
 return originalFetch(input,options);
};
