import {fail,uuid} from './core.mjs';
import {historicalEntities} from './history-readonly.mjs';
import {catalogList} from './catalog.mjs';
import {list as entityList} from './entities.mjs';
import {domainList} from './domain.mjs';
import {operationalState} from './operations.mjs';
export const workspaceMasters=Object.freeze(['Employee','Sector','JobRole','ExpenseCategory','InventoryItem']);
export function createOperationalWorkspace({source,pool}){
 let activationApproved=false;
 if(!source?.verify||!source?.list||!source?.route||!pool)throw Error('WORKSPACE_DEPENDENCIES_REQUIRED');
 async function authorization(user){await source.list(user,'Employee');const row=(await pool.query('SELECT *,cutover_date::text AS cutover_date FROM d1_workspace WHERE singleton')).rows[0];if(!row||row.owner_id!==user.id||user.role!=='admin')throw fail(403,'Perfil operacional nao autorizado.');return row;}
 async function list(user,entity){await authorization(user);const historical=historicalEntities.includes(entity)?await source.list(user,entity):[];
  const working=['Employee','Sector','JobRole'].includes(entity)?await entityList(pool,user,entity):['ExpenseCategory','InventoryItem'].includes(entity)?await catalogList(pool,user,entity):entity==='AuditLog'?(await pool.query('SELECT id,action,operation_id,created_at FROM lab_audit WHERE actor=$1 ORDER BY id',[user.id])).rows.map(r=>({id:'d1-audit-'+r.id,entity_type:r.action.split(':')[0],entity_id:r.operation_id,action:r.action,created_date:r.created_at,responsible_user:user.id})):await domainList(pool,user,entity);
  if(workspaceMasters.includes(entity)){const sourceIds=new Set(historical.map(r=>r.id));if(historical.some(r=>!working.some(w=>w.id===r.id)))throw fail(503,'Cadastro importado incompleto.');return working.map(w=>({...w,_imported:sourceIds.has(w.id)}));}
  if(working.some(w=>historical.some(h=>h.id===w.id)))throw fail(503,'Identidade historica duplicada.');return [...historical,...working];
 }
 async function route(req,res,url,user,reply,body={}){
  const profile=await authorization(user);
  if(req.method==='POST'&&url.pathname!=='/api/d1/logout'){
   if(!profile.activation_approved)throw fail(403,'Ativacao operacional aguarda aprovacao expressa do responsavel.');
   if(['/api/d1/sync-now','/api/d1/reconciliation/apply'].includes(url.pathname))throw fail(403,'Sincronizacao entre computadores nao homologada neste perfil.');
   const d=body.data||body;for(const input of [d,...(Array.isArray(d.payments)?d.payments:[])])for(const key of ['date','payment_date','paid_date','reference_start','reference_end','issue_date'])if(input[key]&&String(input[key])<String(profile.cutover_date).slice(0,10))throw fail(409,'Lancamento anterior ao corte exige reconciliacao; historico preservado.');
   const id=body.id||url.pathname.match(/\/([a-f0-9-]{36})$/)?.[1];if(id&&!uuid(id))throw fail(400,'Identificador invalido.');if(id&&(await pool.query('SELECT 1 FROM d1_legacy_guard WHERE id=$1',[id])).rowCount)throw fail(403,'Registro historico protegido contra escrita.');return false;
  }
  if(req.method!=='GET')return false;
  if(url.pathname==='/api/d1/workspace/status'){reply(200,{operational:true,activationApproved:profile.activation_approved,cutoverDate:profile.cutover_date,records:profile.records,attachments:profile.attachments,historyReadOnly:true,syncEnabled:false});return true;}
  if(url.pathname.startsWith('/api/d1/migrated/attachments/'))return source.route(req,res,url,user,reply);
  const match=url.pathname.match(/^\/api\/d1\/(entities|catalog|domain)\/([A-Za-z]+)$/);
  if(match&&['Evaluation','EmployeeDocument'].includes(match[2])){reply(200,{records:[],readOnly:true,sourceEntityPresent:false});return true;}
  if(match&&historicalEntities.includes(match[2])){reply(200,{records:await list(user,match[2]),operationalWorkspace:true,readOnly:false});return true;}
  if(url.pathname==='/api/d1/operations/state'){const state=await operationalState(pool,user);reply(200,{...state,movements:[...await source.list(user,'StockMovement'),...state.movements],operationalSyncEnabled:false});return true;}
  return false;
 }
 return {workspace:true,get activationApproved(){return activationApproved;},verify:async()=>{await source.verify();const p=(await pool.query('SELECT *,cutover_date::text AS cutover_date FROM d1_workspace WHERE singleton')).rows[0];if(!p||p.records!==1186||p.attachments!==59)throw Error('WORKSPACE_NOT_RECONCILED');activationApproved=p.activation_approved;},list,route,close:source.close};
}
