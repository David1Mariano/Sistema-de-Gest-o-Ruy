// Preload de TESTE. Nega todo TCP fora dos três destinos loopback autorizados.
// Não modifica firewall/rede Windows nem processos já existentes (incluindo 8080).
const net=require('node:net');
const allowedHosts=new Set(['127.0.0.1','localhost','::1']);
const allowedPorts=new Set([55436,18087,8080,18083,18086]);
if(process.env.RUY_D1_ALLOW_TESTS==='1')for(const port of [18080,18090,18091,18092,18443])allowedPorts.add(port);
if(process.env.RUY_D1_ALLOW_TESTS==='1'&&/^[a-f0-9]{16}$/.test(process.env.RUY_D1_RESTART_FIXTURE||''))allowedPorts.add(55437);
if(process.env.RUY_D1_INSTALLATION){
 const ports={'windows-layout-20261021':[18144,55494,55463],'windows-candidate-20261021':[18143,55493,55463],'final-dev-20261021':[18133,55483,18583,18584,18585],'history-view-dev-20261020':[18123,55473,55463],'i5r4-dev-20261020':[18113,55453,18553,18554,18555],'i5r3-20261020':[18103,55443],'i5r3-peer-20261020':[18104,55444]}[process.env.RUY_D1_INSTALLATION];
 if(!ports||process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('INSTALLATION_CONFLICT');
 allowedPorts.clear();for(const port of ports)allowedPorts.add(port);
}
const audit={blocked:0};globalThis.__ruyLabNetworkAudit=audit;
const brevoEnabled=['windows-candidate-20261021','windows-layout-20261021','final-dev-20261021'].includes(process.env.RUY_D1_INSTALLATION)&&process.env.RUY_D1_BREVO_ENABLED==='1';
function allowed(host,port){return allowedHosts.has(host)&&allowedPorts.has(Number(port))||brevoEnabled&&host==='api.brevo.com'&&Number(port)===443;}
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
 const transactional=brevoEnabled&&u.origin==='https://api.brevo.com'&&u.pathname==='/v3/smtp/email'&&!u.search&&!u.hash&&!u.username&&!u.password&&options?.method==='POST'&&options?.redirect==='error';
 if(!(transactional||allowedHosts.has(u.hostname)&&allowedPorts.has(Number(u.port||(u.protocol==='https:'?443:80))))){audit.blocked++;return Promise.reject(Object.assign(Error('TEST_OFFLINE: fetch externo bloqueado.'),{code:'ENETUNREACH'}));}
 return originalFetch(input,options);
};
