import {startCentral} from './bootstrap.mjs';
let runtime,stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;clearInterval(heartbeat);try{await runtime?.stop();process.exitCode=0;}catch{process.exitCode=2;}if(process.connected)process.disconnect();};
process.on('message',m=>{if(m?.type==='shutdown')void stop();});
process.on('disconnect',()=>void stop());process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
let checking=false;const heartbeat=setInterval(async()=>{if(!runtime||checking||stopping)return;checking=true;try{process.send?.({type:'health',ok:await runtime.health()});}catch{process.send?.({type:'health',ok:false});}finally{checking=false;}},2000);
try{runtime=await startCentral(process.argv[2]);if(stopping)await runtime.stop();else process.send?.({type:'ready',apiPort:runtime.apiPort,tlsPort:runtime.tlsPort,configSha256:runtime.configSha256});}catch{clearInterval(heartbeat);process.send?.({type:'failed',code:'BOOTSTRAP_REFUSED'});process.exitCode=2;process.disconnect?.();}
