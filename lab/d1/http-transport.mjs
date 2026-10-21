// D1 same-origin only. Adapted from Agent 2's timeout/outcome checks;
// durable intentions and idempotency remain in the existing client/server.
export function createD1Transport({fetchImpl=(...args)=>globalThis.fetch(...args),timeoutMs=30000}={}){
 return async function call(route,body,csrf){
  const write=body!==undefined&&body!==null,operationId=body?.operationId;
  let sent=false,response,serialized;
  const failure=(message,code,status=503)=>Object.assign(Error(message),{code,status,operationId,outcome:write?(response?.status>=400&&response.status<500?'rejected':sent?'unknown':'not_sent'):'not_applicable'});
  try{
   if(typeof route!=='string'||!route.startsWith('/')||route.includes('#')||[...route].some(ch=>ch.charCodeAt(0)<=32||ch==='\\'))throw Error();
   const path=decodeURIComponent(route.split('?')[0]);
   if(path.includes('//')||path.split('/').some(p=>p==='.'||p==='..'))throw Error();
   if(write&&(!body||typeof body!=='object'||Array.isArray(body)))throw Error();
   serialized=write?JSON.stringify(body):undefined;
  }catch{throw failure('Requisição local inválida.','INVALID_REQUEST',400);}
  const publicAccount=/^\/account\/(register|resend|verify|reset-request|reset|bootstrap)$/.test(route);
  if(write&&route!=='/login'&&!publicAccount&&!csrf)throw failure('Sessão local sem CSRF; entre novamente.','CSRF_REQUIRED',403);
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw failure('Prazo esgotado antes do envio.','TIMEOUT');
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(failure('Servidor local não respondeu no prazo. Confira a fila antes de reenviar.','TIMEOUT',response?.status>=400?response.status:503));controller.abort();},timeoutMs);});
  const task=(async()=>{
   try{
    sent=true;response=await fetchImpl('/api/d1'+route,{method:write?'POST':'GET',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:write?{'Content-Type':'application/json','X-CSRF-Token':csrf||''}:{},body:serialized});
   }catch{throw failure('Falha de conexão local; confira a fila antes de reenviar.','NETWORK');}
   let value;
   try{value=await response.json();}catch{throw failure('Resposta local inválida; confira a fila.','INVALID_RESPONSE',response.status>=400?response.status:503);}
   if(!value||typeof value!=='object'||Array.isArray(value))throw failure('Resposta local inválida.','INVALID_RESPONSE',response.status>=400?response.status:503);
   if(!response.ok)throw failure(value.error||'Falha local.',value.code||'HTTP_ERROR',response.status);
   return value;
  })();
  try{return await Promise.race([task,deadline]);}finally{clearTimeout(timer);}
 };
}
