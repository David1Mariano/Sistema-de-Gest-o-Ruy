import { employeeDeleteRelationsByEntity } from '../../src/lib/employeeDelete.js';
import { fail } from './core.mjs';
import { guardRH } from './rh.mjs';

export const C2_ENTITIES = new Set(['Employee','Sector','JobRole','SystemSettings']);
export const EMPLOYEE_FIELDS = ['name','social_name','birth_date','cpf','rg','phone','whatsapp','address','neighborhood','city','state','emergency_contact','emergency_phone','photo_url','sector','function','unit','hire_type','status','admission_date','default_start_time','default_end_time','work_days','day_off','salary','vale_value','responsible','experience_start','experience_end','pix_key','bank','observations','uniforms_delivered'];
const common=['id','created_date','updated_date','updated_at'];
export function validateC2(entity,data) {
  if (!C2_ENTITIES.has(entity)) return;
  const fields=entity === 'Employee' ? EMPLOYEE_FIELDS : entity === 'SystemSettings' ? ['company_name','tolerance_minutes','coverage_config'] : entity === 'Sector' ? ['name','status','description'] : ['name','sector','status','description'];
  for(const [key,value] of Object.entries(data)) {
    if(![...common,...fields].includes(key)) throw fail(400,`Campo não permitido: ${key}`);
    if(typeof value === 'string' && value.length > 10000) throw fail(400,'Campo muito longo.');
    if(value != null && typeof value !== 'string' && typeof value !== 'number') throw fail(400,'Formato de campo inválido.');
    if(value != null && !['salary','vale_value','tolerance_minutes'].includes(key) && typeof value!=='string')throw fail(400,`Campo textual inválido: ${key}`);
  }
  if(entity === 'Employee') {
    if(typeof data.name !== 'string' || !data.name.trim()) throw fail(400,'Nome obrigatório.');
    if(!['ativo','em_experiencia','folga','ferias','afastado','desligado','inativo'].includes(data.status)) throw fail(400,'Status inválido.');
    if(data.hire_type && !['clt','pj','diarista','estagio','autonomo','outros'].includes(data.hire_type)) throw fail(400,'Contratação inválida.');
    for(const key of ['salary','vale_value']) if(data[key] != null && (!Number.isFinite(data[key]) || data[key] < 0)) throw fail(400,'Valor monetário inválido.');
    for(const key of ['birth_date','admission_date','experience_start','experience_end']) if(data[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(data[key]) || Number.isNaN(new Date(data[key]).getTime()) || new Date(data[key]).toISOString().slice(0,10) !== data[key])) throw fail(400,'Data inválida.');
    for(const key of ['default_start_time','default_end_time']) if(data[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data[key])) throw fail(400,'Horário inválido.');
    // Preserve legacy references, but do not upload or pretend remote files are locally available.
    if(data.photo_url && !/^(https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(data.photo_url)) throw fail(400,'Referência de foto inválida.');
  }
  if(entity === 'SystemSettings') {
    if(typeof data.company_name!=='string'||!data.company_name.trim()||data.company_name.length>200||/sb_secret_|service_role|bearer\s|eyJ[a-zA-Z0-9_-]+\./i.test(data.company_name))throw fail(400,'Nome da empresa inválido; segredos não são parâmetros comuns.');
    if(!Number.isInteger(data.tolerance_minutes) || data.tolerance_minutes < 0 || data.tolerance_minutes > 1440) throw fail(400,'Tolerância inválida.');
    let coverage;
    try { coverage=JSON.parse(data.coverage_config); } catch { throw fail(400,'Cobertura deve ser JSON válido.'); }
    if(!coverage || Array.isArray(coverage) || typeof coverage !== 'object' || Object.values(coverage).some(value=>!Number.isInteger(value)||value<0||value>10000)) throw fail(400,'Cobertura inválida.');
  }
  if(['Sector','JobRole'].includes(entity) && (!data.name?.trim() || !['ativo','inativo'].includes(data.status))) throw fail(400,'Nome/status de referência inválido.');
}
export async function dependencies(client,id) {
  const result=[];
  for(const relation of employeeDeleteRelationsByEntity()) {
    const predicates=relation.fields.map((field,index)=>`data->>$${index+3}=$2`).join(' OR ');
    const count=Number((await client.query(`SELECT count(*) FROM local_records WHERE entity=$1 AND (${predicates})`,[relation.entity,id,...relation.fields])).rows[0].count);
    if(count) result.push({entity:relation.entity,count,label:relation.labels.join(' e ')});
  }
  return {blocked:result.length>0,total:result.reduce((sum,item)=>sum+item.count,0),resumo:result,dependencies:Object.fromEntries(result.map(item=>[item.entity,item.count])),remoteHistoryAvailable:false};
}
export async function guardC2(client,entity,id,operation,payload,confirmation) {
  await guardRH(client,entity,id,operation,payload);
  if(operation!=='delete') {
    const relation=employeeDeleteRelationsByEntity().find(item=>item.entity===entity);
    for(const field of relation?.fields||[]) {
      if(field==='beneficiary_id' && !['colaborador','employee'].includes(payload.beneficiary_type))continue;
      if(payload[field] && !(await client.query("SELECT 1 FROM local_records WHERE entity='Employee' AND id=$1 AND NOT deleted",[payload[field]])).rowCount)throw fail(409,'Vínculo com funcionário local inexistente ou excluído.');
    }
  }
  if(!C2_ENTITIES.has(entity)) return;
  if(operation === 'delete') {
    if(entity !== 'Employee') throw fail(403,'Exclusão desta configuração não habilitada.');
    if(confirmation !== 'EXCLUIR') throw fail(400,'Confirme EXCLUIR.');
    const deps=await dependencies(client,id);
    if(deps.blocked) throw Object.assign(fail(409,'Funcionário possui vínculos; use inativação.'),{code:'DEPENDENCIES_FOUND',...deps});
    if(!(await client.query("SELECT 1 FROM local_pending WHERE entity='Employee' AND record_id=$1 AND operation='create'",[id])).rowCount) throw fail(409,'Origem não comprovada como cadastro local; exclusão bloqueada.');
  } else {
    validateC2(entity,payload);
    if(entity === 'SystemSettings' && operation === 'create' && (await client.query("SELECT 1 FROM local_records WHERE entity='SystemSettings' AND NOT deleted")).rowCount) throw fail(409,'Configuração global já existe. Recarregue antes de editar.');
    if(entity === 'Employee') {
      const old=(await client.query("SELECT data FROM local_records WHERE entity='Employee' AND id=$1",[id])).rows[0]?.data;
      for(const [field,reference] of [['sector','Sector'],['function','JobRole']]) {
        if(payload[field] && payload[field] !== old?.[field]) {
          const found=await client.query("SELECT 1 FROM local_records WHERE entity=$1 AND NOT deleted AND data->>'name'=$2 AND data->>'status'='ativo'",[reference,payload[field]]);
          if(!found.rowCount) throw fail(400,`${field}: referência ativa não encontrada.`);
        }
      }
    }
  }
}
