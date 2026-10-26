// Scheduling only. Durable commands, receipts and cursors remain in the existing
// D1 PostgreSQL outbox; restarting this supervisor never manufactures commands.
export function createSyncSupervisor({synchronize,hasSession=()=>true,onState=()=>{},intervalMs=2000,maxRetryMs=30000}){
 if(typeof synchronize!=='function'||!Number.isFinite(intervalMs)||intervalMs<50||maxRetryMs<intervalMs)throw Error('Invalid synchronization supervisor');
 let timer,flight,stopped=true,woken=false,failures=0;
 let state={connection:'stopped',stale:true,pending:null,conflicts:null,lastSuccessAt:null};
 const publish=change=>{state={...state,...change};try{onState({...state});}catch{/* Status listeners never own synchronization. */}};
 const schedule=delay=>{if(!stopped){clearTimeout(timer);timer=setTimeout(run,delay);}};
 function run(){
  if(stopped)return Promise.resolve();if(flight){woken=true;return flight;}
  flight=(async()=>{
   if(!hasSession()){publish({connection:'authentication-required',stale:true});return;}
   publish({connection:'synchronizing'});
   try{
    const result=await synchronize();
    if(result.lastError)throw Error('CENTRAL_UNCONFIRMED');
    failures=0;const conflicts=Number(result.conflicts||0)+Number(result.rejected||0),pending=Number(result.pending||0)+Number(result.sending||0);
    publish({connection:conflicts?'conflict':pending?'pending':'online',stale:!!conflicts||!!pending,pending,conflicts,lastSuccessAt:result.lastSyncAt||new Date().toISOString()});
   }catch{failures++;publish({connection:'offline',stale:true});}
  })().finally(()=>{flight=null;if(!stopped){const delay=woken?0:Math.min(maxRetryMs,intervalMs*2**Math.min(failures,10));woken=false;schedule(delay);}});
  return flight;
 }
 return {start(){if(stopped){stopped=false;schedule(0);}},wake(){if(stopped)return;if(flight)woken=true;else schedule(0);},async stop(){stopped=true;clearTimeout(timer);await flight;publish({connection:'stopped',stale:true});},status:()=>({...state})};
}
