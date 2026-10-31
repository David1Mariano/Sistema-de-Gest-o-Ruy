import {randomBytes} from 'node:crypto';
import {fail,uuid} from './core.mjs';
import {syncFields} from './sync-contract.mjs';
import {sharedCapabilities} from '../sync-lab/shared-policy.mjs';
import {isDomain} from './domain-contract.mjs';
import {validateAttachment,attachmentHash,attachmentFilename} from './attachment-contract.mjs';
import {expenseObligations} from './expense-obligations.mjs';
const readOnlyHistorical=new Set(['AuditLog','StockMovement']);
// The transport lives in the main process. This client never starts PostgreSQL,
// creates a company, imports history or impersonates a workspace owner.
export function createSharedClient({request,deviceId,userSessionMode=false,clientId,intervalMs=2000,now=()=>Date.now()}){
 if(typeof request!=='function'||!userSessionMode&&!uuid(deviceId))throw Error('SHARED_DEVICE_REQUIRED');
 let session=null,records=new Map(),files=new Map(),head=0,business=null,lastSuccessAt=null,connection='signed-out',flight=null,timer,closed=false,generation=0,consultationOnly=false,operationalEnabled=false,restrictions=null;
 const conflicts=new Set();
 const capabilities=()=>consultationOnly?{...sharedCapabilities,mode:'private-consultation',operationalEnabled:false,payrollPayments:false,stockConsumption:false,manualFinancialCommands:false,manualFinancialReversal:false,deliveryReceipts:false}:operationalEnabled?{...sharedCapabilities,mode:'controlled-central',operationalEnabled:true}:sharedCapabilities;
 const clear=()=>{generation++;session=null;records.clear();files.clear();conflicts.clear();business=null;head=0;lastSuccessAt=null;connection='signed-out';consultationOnly=false;};
 const remote=async(route,body,method)=>{
  if(session&&Date.parse(session.expiresAt)<=now()){clear();throw fail(401,'Sessão central expirada.');}
  try{return await request(route,body,session?.token,method);}
  catch(error){if(error.status===401)clear();else if(!error.status||error.status>=500)connection='offline';throw error;}
 };
 async function refresh(){
  if(!session||closed)return;
  if(flight)return flight;
  const started=generation;
  flight=(async()=>{const snapshot=await remote('/state');
   if(started!==generation)return;
   if(!snapshot.complete||snapshot.business?.complete===false||!Number.isSafeInteger(snapshot.head)||!Array.isArray(snapshot.records))throw fail(503,'Consulta central incompleta.');
   records=new Map(snapshot.records.map(r=>[r.id,r]));head=snapshot.head;business=snapshot.business||null;consultationOnly=snapshot.consultationOnly===true;operationalEnabled=snapshot.operationalEnabled===true;restrictions=snapshot.operationalRestrictions||null;lastSuccessAt=new Date(now()).toISOString();connection='online';
  })().finally(()=>{flight=null;});return flight;
 }
 function authorized(){if(!session||Date.parse(session.expiresAt)<=now()){clear();throw fail(401,'Entre com sua conta central.');}return session;}
 function cached(){authorized();if(!lastSuccessAt||now()-Date.parse(lastSuccessAt)>300000)throw fail(503,'Consulta desatualizada. Reconecte ao servidor central.');}
 async function login(body){
  clear();const result=await request('/session/login',{email:body.login,password:body.password,...(userSessionMode&&clientId?{clientId}:{})});
  if((userSessionMode?!uuid(result.deviceId)||result.authentication!=='user-session':result.deviceId!==deviceId)||!uuid(result.userId)||!uuid(result.workspaceId)||!Number.isFinite(Date.parse(result.expiresAt)))throw fail(403,'Identidade central divergente.');
  if(userSessionMode)deviceId=result.deviceId;
  session={...result,csrf:randomBytes(32).toString('hex')};generation++;try{await refresh();}catch(error){clear();throw error;}
  return me();
 }
 function me(){const s=authorized();return {user:{id:s.userId,role:s.role,full_name:s.fullName},csrf:s.csrf,deviceId,workspaceId:s.workspaceId,sharedMode:true,sharedSyntheticOnly:!consultationOnly&&!operationalEnabled,operationalWorkspace:operationalEnabled,operationalActivationApproved:operationalEnabled,operationalRestrictions:restrictions,sharedCapabilities:capabilities(),consultationOnly,operationalHistoryPreview:consultationOnly};}
 function list(entity){cached();if(!syncFields[entity]&&!readOnlyHistorical.has(entity)||session.role!=='admin'&&!['Employee','Sector','JobRole'].includes(entity))throw fail(403,'Entidade não autorizada neste perfil compartilhado.');const values=[...records.values()].filter(r=>r.entity===entity&&r.data._deleted!=='true'&&(!operationalEnabled||!r.data._historical||['Employee','Sector','JobRole','InventoryItem','ExpenseCategory','AuditLog'].includes(entity))).map(r=>({...r.data,...(r.data.payload_json?JSON.parse(r.data.payload_json):{}),id:r.id,_version:r.version,...(entity==='FinancialAccount'?{current_balance:operationalEnabled&&restrictions?.financialOpeningPending?null:Number(business?.accounts?.find(a=>a.account==='account:'+r.id)?.balance||0)/100,opening_balance_unknown:operationalEnabled&&restrictions?.financialOpeningPending}:{})}));return entity==='AccountsPayable'&&operationalEnabled?expenseObligations(list('FinancialExpense'),values):values;}
 function archived(entity){cached();if(session.role!=='admin'||!['FinancialExpense','EmployeePayment','Vale','AccountsPayable'].includes(entity))throw fail(403,'Consulta histórica não autorizada.');return [...records.values()].filter(r=>r.entity===entity&&(r.data._historical||r.data.payload_json&&JSON.parse(r.data.payload_json)._historical)).map(r=>({...r.data,...(r.data.payload_json?JSON.parse(r.data.payload_json):{}),id:r.id,_version:r.version,_readOnly:true,_historical:true}));}
 async function mutate(entity,id,body){
  const s=authorized();if(s.role!=='admin')throw fail(403,'Escrita central exige administrador autorizado.');
  // No optimistic/local effect for financial, stock or payroll commands.
  if(connection!=='online')throw fail(503,'Sem conexão: alterações bloqueadas. Consulte os dados já recebidos.');
  if(!uuid(id)||!uuid(body.operationId)||!syncFields[entity]||!['create','update'].includes(body.operation))throw fail(400,'Comando compartilhado inválido.');
  const data=body.data;if(!data||Object.keys(data).some(k=>!syncFields[entity].includes(k)))throw fail(400,'Campos fora do contrato.');
  const receipt=await write('/catalog-command',{entity,id,operationId:body.operationId,operation:body.operation,baseVersion:body.baseVersion,data});
  // A lost read after a committed write must not be reported as a rolled-back write.
  try{await fresh();}catch{throw fail(503,'Resultado central pendente de conferência. Reenvie somente a mesma operação.');}
  return {record:list(entity).find(r=>r.id===id),operationId:receipt.operationId,serverCommitted:true,replay:receipt.replay===true};
 }
 async function fresh(){await flight?.catch(()=>{});return refresh();}
 async function write(route,body){if(consultationOnly)throw fail(405,'Dados importados em consulta: alterações bloqueadas.');try{const result=await remote(route,body);conflicts.delete(body.operationId);return result;}catch(error){if(error.status===409){conflicts.add(body.operationId);throw fail(409,'Conflito de versão ou obrigação duplicada. Recarregue e confira antes de reenviar.');}throw error;}}
 async function domain(body){authorized();if(session.role!=='admin')throw fail(403,'Administrador central obrigatório.');if(!isDomain(body?.entity))throw fail(403,'Este agregado ainda não foi homologado no modo compartilhado.');if(connection!=='online')throw fail(503,'Operações financeiras exigem conexão central.');const result=await write('/domain-command',body);try{await fresh();}catch{throw fail(503,'Resultado pendente de conferência. Preserve o identificador da operação.');}const record=list(body.entity).find(r=>r.id===body.id);return {record,domainRecord:record,operationId:result.operationId,serverCommitted:true,replay:result.replay===true};}
 function status(){authorized();return {shared:true,enabled:true,mode:consultationOnly?'shared-consultation':operationalEnabled?'shared-operational':'shared-laboratory',consultationOnly,connection,stale:connection!=='online',lastSyncAt:lastSuccessAt,cursor:head,operationalSyncEnabled:operationalEnabled,pending:0,sending:flight?1:0,conflicts:conflicts.size,rejected:0,criticalOffline:false,capabilities:capabilities()};}
 function state(){cached();if(session.role!=='admin')throw fail(403,'Consulta financeira restrita.');return business;}
 async function operation(body){const s=authorized();if(s.role!=='admin')throw fail(403,'Administrador central obrigatório.');if(connection!=='online')throw fail(503,'Operações críticas são proibidas sem conexão central.');const result=await write('/operation',body);try{await fresh();}catch{throw fail(503,'Operação aguardando conferência. Reenvie somente o mesmo identificador.');}return {...result,...(body.kind==='create-item'?{record:list('InventoryItem').find(r=>r.id===body.itemId)}:{}),businessConfirmed:true,serverCommitted:true};}
 async function attachmentList(recordId){authorized();if(!recordId)return {records:[...files.values()]};if(!uuid(recordId)||session.role!=='admin')throw fail(403,'Anexo não autorizado.');const value=await remote('/attachments?record='+recordId);for(const file of value.records)files.set(file.id,{...file,state:'acknowledged'});return {records:value.records.map(f=>({...f,state:'acknowledged'}))};}
 async function attachmentPut(body){authorized();if(consultationOnly)throw fail(405,'Anexos históricos são somente de consulta.');validateAttachment(body,{operational:operationalEnabled});const result=await remote('/attachments/'+body.id,body,'PUT');await attachmentList(body.recordId);try{await fresh();}catch{/* Receipt already proves durable upload; retry metadata reads separately. */}return result;}
 async function attachmentGet(id){authorized();if(!uuid(id))throw fail(400,'Identificador inválido.');const value=await remote('/attachments/'+id);const bytes=Buffer.from(value.bytes||'','base64');if(value.id!==id||!bytes.length||attachmentHash(bytes)!==value.sha256||!(operationalEnabled?attachmentFilename(value.filename):/^FICTICIO-[a-zA-Z0-9_-]+\.(pdf|png|jpg|webp|txt)$/.test(value.filename||'')))throw fail(503,'Integridade do anexo recusada.');return value;}
 return {login,me,list,archived,mutate,status,state,refresh,operation,domain,connection:()=>request('/connection'),query:route=>remote('/domain-query',{route}),account:(route,input)=>{if(consultationOnly)throw fail(405,'Contas e permissões permanecem no serviço de identidade existente.');return remote('/account',{route,input});},attachmentList,attachmentPut,attachmentGet,csrf:()=>authorized().csrf,
  start(){if(!timer)timer=setInterval(()=>{if(session)void refresh().catch(()=>{});},intervalMs);},
  async logout(){try{if(session)await remote('/session/logout',{});}finally{clear();}},
  async close(){closed=true;clearInterval(timer);await flight?.catch(()=>{});try{if(session)await request('/session/logout',{},session.token);}finally{clear();}},
 };
}
