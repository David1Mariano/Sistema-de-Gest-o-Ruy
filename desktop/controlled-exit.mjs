export function stopOwnedWorker(worker,{timeoutMs=10000}={}){
 if(!worker)return Promise.resolve(true);
 return new Promise(resolve=>{
  let finished=false;
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);worker.removeListener('exit',exited);resolve(value);};
  const exited=()=>finish(true),timer=setTimeout(()=>finish(false),timeoutMs);
  worker.once('exit',exited);
  try{worker.postMessage({type:'shutdown'});}catch{finish(false);}
 });
}
export function waitForTask(task,{timeoutMs=10000}={}){
 if(!task)return Promise.resolve(true);
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>finish(false),timeoutMs);
  Promise.resolve(task).then(()=>finish(true),()=>finish(false));
 });
}
// Backups are not worker leases: never time them out into a synchronous modal.
// Keep the event loop available to drain pg_dump and finish the archive.
export async function finishBackupBeforeExit(task,onWait=()=>{}){
 if(!task)return;
 onWait();await task;
}
