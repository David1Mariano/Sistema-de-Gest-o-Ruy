const net=require('node:net');
const ports=new Set([55435,55436,18083,18084,18085,18086,18087,8080]);
const allowed=(host,port)=>['127.0.0.1','localhost','::1'].includes(host)&&ports.has(Number(port));
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const o=net._normalizeArgs(Array.isArray(args[0])?args[0]:args)[0];if(!o.path&&!allowed(o.host||'localhost',o.port))throw Object.assign(Error('BRIDGE_OFFLINE_GUARD'),{code:'ENETUNREACH'});return originalConnect.apply(this,args);};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed(u.hostname,u.port||(u.protocol==='https:'?443:80)))return Promise.reject(Object.assign(Error('BRIDGE_OFFLINE_GUARD'),{code:'ENETUNREACH'}));return originalFetch(input,options);};
