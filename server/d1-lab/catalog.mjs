import {assertActiveIntent} from './core.mjs';
import {catalogFields,projectEmployee} from './catalog-contract.mjs';
import {transaction,fail,digest,uuid} from './core.mjs';
import {record} from './entities.mjs';
import {sectorKey} from '../../src/lib/sectorUtils.js';
import {deleteEmployee} from './employee-delete.mjs';

function table(entity){return entity==='Employee'?'d1_records':'d2_catalog';}
export async function catalogList(pool,user,entity){
 if(!catalogFields[entity])throw fail(403,'Cadastro não habilitado.');
 const {rows}=await pool.query(`SELECT * FROM ${table(entity)} WHERE owner_id=$1 AND entity=$2 ORDER BY created_at DESC,id`,[user.id,entity]);
 return rows.filter(r=>r.data._deleted!=='true').map(r=>entity==='Employee'?projectEmployee(record(r),user.role):record(r));
}
export async function catalogSave(pool,user,deviceId,entity,id,body,hook=async()=>{},context){
 if(entity==='Employee'&&body.operation==='delete')return deleteEmployee(pool,user,deviceId,id,body,hook);
 if(!catalogFields[entity]||!uuid(id)||!uuid(body.operationId)||!['create','update'].includes(body.operation))throw fail(400,'Comando de cadastro inválido.');
 const {operation,operationId,baseVersion,data}=body;
 if(operation==='create'?baseVersion!=null:!Number.isSafeInteger(baseVersion)||baseVersion<1)throw fail(400,'Versão inválida.');
 if(!data||Array.isArray(data)||Object.keys(data).some(k=>!catalogFields[entity].includes(k))||Object.values(data).some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number')||Object.values(data).some(v=>typeof v==='string'&&v.length>4000))throw fail(400,'Campos de cadastro inválidos.');
 for(const [k,v] of Object.entries(data))if(typeof v==='number'&&(!Number.isFinite(v)||v<0||v>1e9))throw fail(400,'Valor numérico inválido: '+k);
 const numeric=['minimum_stock','tolerance_minutes','salary','vale_value'];
 if(Object.entries(data).some(([k,v])=>numeric.includes(k)?v!==null&&typeof v!=='number':v!==null&&typeof v!=='string'))throw fail(400,'Tipo de campo inválido.');
 // Nenhuma senha, anexo ou URL remota pode entrar por este contrato.
 if(data.photo_url)throw fail(400,'Anexos privados exigem transporte separado.');
 const payloadHash=digest(JSON.stringify({entity,id,operation,baseVersion:baseVersion??null,data:Object.fromEntries(Object.entries(data).sort()),...(context?{context}:{})}));
 return transaction(pool,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.id]);
  const actor=(await c.query('SELECT * FROM lab_users WHERE id=$1 AND active FOR SHARE',[user.id])).rows[0];
  if(!actor)throw fail(401,'Sessão revogada.');
  if(!['admin','writer'].includes(actor.role)||(['Employee','SystemSettings'].includes(entity)&&actor.role!=='admin'))throw fail(403,'Cadastro exige permissão administrativa local.');
  const prior=(await c.query('SELECT * FROM lab_outbox WHERE operation_id=$1',[operationId])).rows[0];
  if(prior){await assertActiveIntent(c,prior.operation_id);if(prior.actor!==actor.id||prior.payload_hash!==payloadHash)throw fail(409,'Operação reutilizada com outro conteúdo.');return {...prior.result,replay:true};}
  const current=(await c.query(`SELECT * FROM ${table(entity)} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
  if(current?.data._deleted==='true')throw fail(409,'Colaborador excluído; identidade preservada.');
  if(current&&(current.owner_id!==actor.id||current.entity!==entity))throw fail(403,'Registro fora do escopo.');
  if(operation==='create'?!!current:!current||Number(current.version)!==baseVersion)throw fail(409,'Conflito de versão; recarregue o cadastro.');
  const merged={...(current?.data||{}),...data};
  if(entity!=='SystemSettings'&&(typeof merged.name!=='string'||!merged.name.startsWith('FICTICIO ')||merged.name.length>120))throw fail(400,'Somente nomes FICTICIO no laboratório.');
  if(entity==='SystemSettings'){
   if(!Number.isInteger(merged.tolerance_minutes)||merged.tolerance_minutes<0||merged.tolerance_minutes>120||typeof merged.coverage_config!=='string')throw fail(400,'Configuração inválida.');
   try{const coverage=JSON.parse(merged.coverage_config);if(!coverage||typeof coverage!=='object'||Array.isArray(coverage))throw Error();}catch{throw fail(400,'Cobertura deve conter objeto JSON.');}
  }else if(entity==='Employee'){
   if(!['ativo','em_experiencia','folga','ferias','afastado','desligado','inativo'].includes(merged.status)||!['clt','pj','diarista','estagio','autonomo','outros'].includes(merged.hire_type)||!/^\d{4}-\d{2}-\d{2}$/.test(merged.admission_date||''))throw fail(400,'Dados funcionais obrigatórios inválidos.');
   const admission=new Date(merged.admission_date+'T00:00:00Z');
   if(!Number.isFinite(admission.getTime())||admission.toISOString().slice(0,10)!==merged.admission_date)throw fail(400,'Data de admissão inválida.');
   // Dados pessoais só sintéticos: documentos/banco não são importados.
   for(const field of ['cpf','rg','pix_key','bank'])if(merged[field]&&!/^FICTICIO(?: |$)/.test(String(merged[field])))throw fail(400,'Documento de laboratório deve ser FICTICIO.');
   if(merged.sector){
    const sectors=(await c.query("SELECT data FROM d1_records WHERE owner_id=$1 AND entity='Sector'",[actor.id])).rows;
    if(!sectors.some(r=>r.data.status==='ativo'&&r.data.name===merged.sector))throw fail(409,'Setor ativo obrigatório.');
   }
   if(merged.function){
    const roles=(await c.query("SELECT data FROM d1_records WHERE owner_id=$1 AND entity='JobRole'",[actor.id])).rows;
    if(!roles.some(r=>r.data.status==='ativo'&&r.data.name===merged.function&&(!r.data.sector_name||r.data.sector_name===merged.sector)))throw fail(409,'Função ativa e setor compatível obrigatórios.');
   }
  }else if(!['ativo','inativo'].includes(merged.status))throw fail(400,'Status obrigatório.');
  if(entity==='InventoryItem'&&(typeof merged.unit!=='string'||!merged.unit.trim()||typeof merged.minimum_stock!=='number'||!Number.isFinite(merged.minimum_stock)))throw fail(400,'Unidade e estoque mínimo obrigatórios.');
  if(entity==='InventoryItem'&&merged.preferred_supplier_id){
   const supplier=(await c.query("SELECT data FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity='Supplier'",[merged.preferred_supplier_id,actor.id])).rows[0];
   if(!supplier||supplier.data.name!==merged.preferred_supplier_name||supplier.data.status!=='ativo')throw fail(409,'Fornecedor ativo e nome compatível obrigatórios.');
  }
  const nameKey=entity==='SystemSettings'?'singleton':sectorKey(merged.name);
  const row=operation==='create'?(await c.query(`INSERT INTO ${table(entity)}(id,owner_id,entity,data,name_key) VALUES($1,$2,$3,$4,$5) RETURNING *`,[id,actor.id,entity,merged,nameKey])).rows[0]:(await c.query(`UPDATE ${table(entity)} SET data=$2,name_key=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[id,merged,nameKey])).rows[0];
  const result={record:record(row),operationId,replay:false};
  await c.query('INSERT INTO lab_outbox(operation_id,device_id,actor,entity,record_id,operation,base_version,record_version,payload_hash,payload,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[operationId,deviceId,actor.id,entity,id,operation,baseVersion??null,row.version,payloadHash,merged,result]);
  await c.query('INSERT INTO lab_audit(actor,action,operation_id) VALUES($1,$2,$3)',[actor.id,entity+':'+operation,operationId]);
  await hook(c);return result;
 });
}
export async function catalogRoute(pool,user,deviceId,req,url,body){
 const match=url.pathname.match(/^\/api\/d1\/catalog\/([A-Za-z]+)(?:\/([0-9a-f-]+))?$/);
 if(!match)return null;
 return req.method==='GET'?{records:await catalogList(pool,user,match[1])}:catalogSave(pool,user,deviceId,match[1],match[2],body);
}
