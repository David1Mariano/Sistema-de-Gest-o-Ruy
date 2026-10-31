import {startConsultation} from './consultation-bootstrap.mjs';
let running,timer,closing=false;
async function stop(){if(closing)return;closing=true;clearInterval(timer);try{await running?.stop();process.exit(0);}catch{process.exit(2);}}
process.on('message',m=>{if(m?.type==='shutdown')void stop();});process.on('disconnect',stop);process.on('SIGTERM',stop);process.on('SIGINT',stop);
try{running=await startConsultation(process.argv[2]);process.send?.({type:'ready',apiPort:running.apiPort,tlsPort:running.tlsPort});timer=setInterval(async()=>{try{process.send?.({type:'health',ok:await running.health()});}catch{process.send?.({type:'health',ok:false});}},3000);}catch(e){const code=/^[A-Z0-9_]{1,100}$/.test(e.code||'')?e.code:/^[A-Z0-9_]{1,100}$/.test(e.message||'')?e.message:'CONSULTATION_BOOTSTRAP_REFUSED';process.send?.({type:'failed',code});process.exit(2);}
