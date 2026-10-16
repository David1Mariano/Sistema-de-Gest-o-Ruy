// Recupera apenas os serviços privados fornecidos pelo processo principal.
export function createSupervisor({health,ensureDatabase,ensureApi,onState=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let flight=null,closed=false,exhausted=false;
 async function run(){
  for(let attempt=1;attempt<=3&&!closed;attempt++){
   try{await health();onState('healthy');return true;}
   catch(error){if(error.recoverable===false){exhausted=true;onState('blocked');return false;}}
   onState('recovering');
   try{
    await ensureDatabase();if(closed)return false;
    await ensureApi();if(closed)return false;
    await health();onState('healthy');return true;
   }catch(error){if(error.recoverable===false)break;}
   if(attempt<3&&!closed)await wait(attempt*1000);
  }
  exhausted=true;if(!closed)onState('error');return false;
 }
 const recover=()=>{
  if(closed||exhausted)return Promise.resolve(false);
  if(!flight)flight=run().finally(()=>{flight=null;});
  return flight;
 };
 return {recover,retry:()=>{exhausted=false;return recover();},close:()=>{closed=true;},isBusy:()=>!!flight};
}
