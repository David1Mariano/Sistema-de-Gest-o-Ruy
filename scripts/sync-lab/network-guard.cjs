const net=require('node:net');
const hosts=new Set(['127.0.0.1','localhost','::1']);
const ports=new Set([55435,18084,18085,18086,18083,8080]);
const permitted=(host,port)=>hosts.has(host)&&ports.has(Number(port));
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const options=net._normalizeArgs(Array.isArray(args[0])?args[0]:args)[0];
 if(!options.path&&!permitted(options.host||'localhost',options.port))throw Object.assign(Error('C2_TEST_OFFLINE'),{code:'ENETUNREACH'});
 return originalConnect.apply(this,args);
};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(!permitted(u.hostname,u.port||(u.protocol==='https:'?443:80)))return Promise.reject(Object.assign(Error('C2_TEST_OFFLINE'),{code:'ENETUNREACH'}));
 return originalFetch(input,options);
};
