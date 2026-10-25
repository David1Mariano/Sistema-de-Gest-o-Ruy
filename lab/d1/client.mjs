import {createD1Transport} from './http-transport.mjs';
import {catalogFields} from '../../server/d1-lab/catalog-contract.mjs';
import {createDomainAdapter,isDomain} from './domain-client.mjs';
let session=null,generation=0;
export function setSession(value){if(session?.user.id!==value?.user.id){generation++;cache.clear();audits.clear();domain.clear();}session=value;}
export function getSession(){return session;}
const transport=createD1Transport();
export async function request(route,body){
 if(body&&session?.operationalHistoryPreview&&route!=='/logout'&&!route.startsWith('/account/'))throw Error('Dados recuperados em conferência: alterações bloqueadas.');
 const started=generation;
 const changed=error=>Object.assign(Error('Sessao alterada; recarregue a consulta.'),{...error,status:401,d1SessionChanged:true,outcome:body?'unknown':'not_applicable'});
 try{
  const value=await transport(route,body,session?.csrf);
  if(started!==generation)throw changed();return value;
 }catch(error){
  if(started!==generation)throw changed(error);
  if(error.status===401&&session){setSession(null);globalThis.dispatchEvent?.(new Event('d1-session-expired'));}
  throw error;
 }
}

const cache=new Map(),audits=new Map();
const allowed={Sector:['name','description','role_purpose','responsible_name','status'],JobRole:['name','sector_id','sector_name','status'],...catalogFields};
const route=entity=>(catalogFields[entity]?'/catalog/':'/entities/')+entity;
const signal=error=>{error.d1Shown=true;globalThis.dispatchEvent(new CustomEvent('d1-error',{detail:error.message}));throw error;};
const domain=createDomainAdapter({request,getSession,signal,committed:result=>{for(const item of [{record:result.record},...(result.cascata||[])])audits.set(item.record.id,{id:result.operationId,serverCommitted:true});}});
export const localDomain=domain;
async function performMutation(entity,id,data,operation,options={}){
 if(!allowed[entity])return signal(Error('Entidade somente de consulta no laboratório.'));
 if(!['admin','writer'].includes(session?.user.role))return signal(Error('Sessão com permissão somente de consulta.'));
 if(['Employee','SystemSettings'].includes(entity)&&session?.user.role!=='admin')return signal(Error('Cadastro exige administrador local.'));
 const clean=Object.fromEntries(Object.entries(data).filter(([k])=>allowed[entity].includes(k)));
 const storageKey='ruy-d1-command:'+session.user.id+':'+entity+':'+(id||'create');
 const prior=JSON.parse(localStorage.getItem(storageKey)||'null');
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({operation,data:clean,confirmation:options.confirmation,confirmRename:options.confirmRename===true,renameImpact:options.confirmRename===true?options.renameImpact:null}))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 // Preserve pre-upgrade create/update intentions and their UUID after a lost
 // response. A legacy fingerprint is valid only for the same operation kind.
 const legacyFingerprint=prior&&prior.body.operation===operation&&operation!=='delete'?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({data:clean,confirmRename:options.confirmRename===true,renameImpact:options.confirmRename===true?options.renameImpact:null}))))).map(b=>b.toString(16).padStart(2,'0')).join(''):null;
 if(prior&&prior.fingerprint!==fingerprint&&prior.fingerprint!==legacyFingerprint)return signal(Error('Existe tentativa sem confirmação para este formulário. Reenvie os mesmos campos antes de alterá-los.'));
 // ETAPA D1.1: `confirmRename`/`renameImpact` saem do corpo do comando (não do
 // `data`), então o hash de replay do servidor muda junto com a confirmação e um
 // command antigo não confirmado não pode ser reaproveitado como confirmado.
 const confirm=operation==='update'&&options.confirmRename===true?{confirmRename:true,renameImpact:options.renameImpact}:undefined;
 const command=prior?{...prior,body:{...prior.body,data:clean}}:{id:id||crypto.randomUUID(),fingerprint,body:{operationId:crypto.randomUUID(),operation,baseVersion:operation==='create'?null:options.baseVersion??cache.get(entity+':'+id)?._version,data:clean,...confirm,...(operation==='delete'?{confirmation:options.confirmation}:{})}};
 if(operation!=='create'&&!command.body.baseVersion)return signal(Error('Recarregue o registro antes de editar.'));
 // O transporte de dados pessoais não guarda o payload no browser. Após falha,
 // o mesmo formulário reconstituído deve coincidir com o hash antes do reenvio.
 localStorage.setItem(storageKey,JSON.stringify(entity==='Employee'?{...command,body:{...command.body,data:undefined}}:command));
 try{
  const result=await request(route(entity)+'/'+command.id,command.body);
  cache.set(entity+':'+command.id,result.record);audits.set(command.id,{id:result.operationId,serverCommitted:true});localStorage.removeItem(storageKey);
  // Cascata da renomeação (D1.1): os vínculos alterados no servidor voltam no
  // resultado; cacheamos para uma edição seguinte já usar a versão nova.
  for(const item of result.cascata||[])cache.set(item.entity+':'+item.record.id,item.record);
  globalThis.dispatchEvent(new Event('d1-changed'));return result.record;
 }catch(e){if(!e.d1SessionChanged&&e.status>=400&&e.status<500&&![408,429].includes(e.status))localStorage.removeItem(storageKey);return signal(e);}
}
async function mutate(...args){
 try{return await performMutation(...args);}catch(error){
  // Inclui falhas de storage/UUID anteriores ao fetch; não pode falhar em silêncio.
  if(!error.d1Shown)signal(error);
  throw error;
 }
}
export function entityClient(entity){return {
 async list(sort='-created_date',limit=1000){if(!['-created_date','name'].includes(sort))throw Error('Ordenação fora do contrato D1.');if(entity==='StockMovement')return (await request('/operations/state')).movements.slice(0,limit);let {records}=await request(route(entity));if(entity==='InventoryItem'){const state=await request('/operations/state');records=records.map(r=>{const b=state.balances.find(b=>b.item_id===r.id);return r._historical?r:{...r,current_stock:Number(b?.quantity_milli??0)/1000,average_cost:Number(b?.average_cents??0)/100,last_cost:Number(b?.last_cents??0)/100,_stockVersion:Number(b?.version??0)};});}for(const r of records)cache.set(entity+':'+r.id,r);return (sort==='name'?[...records].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')):records).slice(0,limit);},
 async filter(query,sort='-created_date',limit=1000){return (await this.list(sort,100000)).filter(r=>Object.entries(query).every(([k,v])=>r[k]===v)).slice(0,limit);},
 async get(id){return (await this.list('-created_date',100000)).find(r=>r.id===id)||null;},
 create:data=>mutate(entity,null,data,'create'),
 update:(id,data,options)=>mutate(entity,id,data,'update',options),
 delete:(id,options)=>entity==='Employee'?mutate(entity,id,{},'delete',options):signal(Error('Exclusão não habilitada para esta entidade.')),
 subscribe(fn){globalThis.addEventListener('d1-changed',fn);return()=>globalThis.removeEventListener('d1-changed',fn);},
};}
export const base44={localDomain:domain,integrations:{Core:{UploadFile:async()=>signal(Error('Anexos privados ainda não homologados no laboratório.'))}},entities:new Proxy({},{get(_,entity){
 if((session?.operationalHistoryPreview||session?.operationalWorkspace)&&['Absence','Warning','Evaluation','EmployeeDocument','Schedule','TimeRecord'].includes(entity))return domain.entity(entity);
 if(isDomain(entity)||entity==='RecipeIngredient')return domain.entity(entity);
 if(entity==='AuditLog')return {...(session?.operationalHistoryPreview||session?.operationalWorkspace?domain.entity(entity):{}),create:async data=>{const receipt=audits.get(data.entity_id);if(!receipt)throw Error('Auditoria exige gravação transacional confirmada.');return receipt;}};
 if(!['Sector','JobRole','StockMovement',...Object.keys(catalogFields)].includes(entity))throw Error('Módulo fora do laboratório D1.');
 return entityClient(entity);
}})};
