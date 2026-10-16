import { fail } from './core.mjs';
import { guardJourney, JOURNEY_ENTITIES } from './rh-jornada.mjs';
export const RH_ENTITIES = new Set(['Absence', 'Warning', 'Evaluation']);
const fields = {
  Absence: ['date','type','expected_time','actual_time','minutes','reason','observation','status','schedule_id'],
  Warning: ['date','category','description','status','observation','attachment_url'],
  Evaluation: ['date','period','score','notes','evaluator'],
};
const shared = ['id','created_date','updated_date','updated_at','employee_id','employee_name','sector','responsible_user'];
export async function guardRH(client, entity, id, operation, data) {
  if (['EmployeePayment','Vale','Consumption','EmployeeDocument'].includes(entity)) throw fail(403, 'Alterações deste recurso ainda não estão disponíveis. É necessário um comando transacional validado.');
  if (JOURNEY_ENTITIES.has(entity)) return guardJourney(client,entity,id,operation,data);
  if (!RH_ENTITIES.has(entity)) return;
  if (operation === 'delete') throw fail(403, 'Exclusão de histórico de RH não habilitada. Use o status de cancelamento quando disponível.');
  for (const [key,value] of Object.entries(data)) {
    if (![...shared,...fields[entity]].includes(key)) throw fail(400, `Campo não permitido: ${key}`);
    if (value != null && !['string','number'].includes(typeof value)) throw fail(400,'Formato inválido.');
    if (typeof value === 'string' && value.length > 10000) throw fail(400,'Campo muito longo.');
    if (value != null && !['minutes','score'].includes(key) && typeof value !== 'string') throw fail(400,'Campo textual inválido.');
  }
  if (typeof data.employee_id !== 'string' || !data.employee_id) throw fail(400,'Colaborador obrigatório.');
  const employee = (await client.query("SELECT data FROM local_records WHERE entity='Employee' AND id=$1 AND NOT deleted",[data.employee_id])).rows[0];
  if (!employee) throw fail(409,'Colaborador inexistente ou excluído.');
  if (data.employee_name !== employee.data.name) throw fail(409,'Nome do colaborador desatualizado. Recarregue o cadastro.');
  const old = (await client.query('SELECT data FROM local_records WHERE entity=$1 AND id=$2',[entity,id])).rows[0]?.data;
  if (old && old.employee_id !== data.employee_id) throw fail(409,'Não é permitido transferir o histórico para outro colaborador.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || Number.isNaN(Date.parse(data.date)) || new Date(data.date).toISOString().slice(0,10) !== data.date) throw fail(400,'Data inválida.');
  if (entity === 'Absence') {
    if(data.schedule_id && !(await client.query("SELECT 1 FROM local_records WHERE entity='Schedule' AND id=$1 AND NOT deleted AND data->>'employee_id'=$2 AND data->>'date'=$3",[data.schedule_id,data.employee_id,data.date])).rowCount)throw fail(409,'Escala vinculada não corresponde à ocorrência.');
    if (!['falta','atraso','saida_antecipada','ausencia_parcial','justificada','nao_justificada','folga'].includes(data.type)) throw fail(400,'Tipo de ocorrência inválido.');
    if (!['ativo','cancelado'].includes(data.status)) throw fail(400,'Status inválido.');
    if (!Number.isInteger(data.minutes) || data.minutes < 0 || data.minutes > 1440) throw fail(400,'Minutos inválidos.');
    for (const key of ['expected_time','actual_time']) if (data[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(data[key])) throw fail(400,'Horário inválido.');
  }
  if (entity === 'Warning') {
    if (!['pendente','tratada','cancelada'].includes(data.status)) throw fail(400,'Status inválido.');
    if (!['atraso_recorrente','falta','descumprimento','comportamento','falha_operacional','outros'].includes(data.category)) throw fail(400,'Categoria inválida.');
    if (data.attachment_url) throw fail(400,'Anexos de advertências ainda não estão disponíveis.');
  }
  if (entity === 'Evaluation' && data.score != null && (!Number.isFinite(data.score) || data.score < 0 || data.score > 10)) throw fail(400,'Nota deve estar entre zero e dez.');
}
