import { fail } from './core.mjs';
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const minutes=value=>value?Number(value.slice(0,2))*60+Number(value.slice(3)):0;
export const JOURNEY_ENTITIES=new Set(['Schedule','StandardSchedule','TimeRecord']);
const fields={
 Schedule:['date','sector','function','unit','start_time','end_time','break_start','break_end','day_type','status','observation','substitute_id','substitute_name','absence_marked'],
 StandardSchedule:['weekday','start_time','end_time','break_start','break_end','day_type'],
 TimeRecord:['date','sector','unit','entry_time','lunch_start','lunch_end','exit_time','expected_start','expected_end','late_minutes','early_exit_minutes','worked_minutes','expected_minutes','break_minutes','status','responsible_user','origin','observation','schedule_id','correction_reason'],
};
const common=['id','created_date','updated_date','updated_at','employee_id','employee_name'];
const numeric=['weekday','late_minutes','early_exit_minutes','worked_minutes','expected_minutes','break_minutes'];
const workday=value=>['trabalho','compensacao'].includes(value);
function checkDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw fail(400,'Data inválida.');}
function ordered(values){let previous=-1;for(const value of values){if(!value)continue;if(!TIME.test(value))throw fail(400,'Horário inválido.');if(minutes(value)<previous)throw fail(400,'Horários fora de ordem.');previous=minutes(value);}}
export function journeyMetrics(record,schedule,tolerance){
 const expectedStart=schedule?.start_time||record.expected_start;
 const expectedEnd=schedule?.end_time||record.expected_end;
 const late=record.entry_time&&expectedStart?minutes(record.entry_time)-minutes(expectedStart):0;
 const early=record.exit_time&&expectedEnd?minutes(expectedEnd)-minutes(record.exit_time):0;
 const break_minutes=record.lunch_start&&record.lunch_end?minutes(record.lunch_end)-minutes(record.lunch_start):0;
 return{late_minutes:late>tolerance?late-tolerance:0,early_exit_minutes:early>tolerance?early-tolerance:0,break_minutes,
 worked_minutes:record.entry_time&&record.exit_time?minutes(record.exit_time)-minutes(record.entry_time)-break_minutes:0,
 expected_minutes:expectedStart&&expectedEnd?minutes(expectedEnd)-minutes(expectedStart)-break_minutes:0};
}
export function journeyStatus(record,schedule,tolerance){
 if(schedule?.day_type&&!workday(schedule.day_type))return'folga';
 if(!['entry_time','exit_time','lunch_start','lunch_end'].some(key=>record[key]))return schedule&&workday(schedule.day_type)?'ausente':'incompleto';
 if(record.lunch_start&&!record.lunch_end)return'intervalo';
 if(record.entry_time&&record.exit_time)return journeyMetrics(record,schedule,tolerance).late_minutes>0?'atrasado':'finalizado';
 if(record.entry_time)return journeyMetrics(record,schedule,tolerance).late_minutes>0?'atrasado':'presente';
 return'incompleto';
}
export async function guardJourney(client,entity,id,operation,data){
 if(!JOURNEY_ENTITIES.has(entity))return;
 if(operation==='delete')throw fail(403,'Exclusão do histórico de jornada não habilitada.');
 for(const [key,value]of Object.entries(data)){
  if(![...common,...fields[entity]].includes(key))throw fail(400,`Campo não permitido: ${key}`);
  if(typeof value==='string'&&value.length>10000)throw fail(400,'Campo muito longo.');
  if(value!=null&&typeof value!==(numeric.includes(key)?'number':key==='absence_marked'?'boolean':'string'))throw fail(400,`Formato inválido: ${key}`);
 }
 const employee=(await client.query("SELECT data FROM local_records WHERE entity='Employee' AND id=$1 AND NOT deleted",[data.employee_id])).rows[0];
 if(!employee)throw fail(409,'Colaborador inexistente ou excluído.');
 if(data.employee_name!==employee.data.name)throw fail(409,'Nome do colaborador desatualizado. Recarregue o cadastro.');
 const old=(await client.query('SELECT data FROM local_records WHERE entity=$1 AND id=$2',[entity,id])).rows[0]?.data;
 if(old&&old.employee_id!==data.employee_id){
  if(entity!=='Schedule'||data.substitute_id!==old.employee_id||data.substitute_name!==old.employee_name)throw fail(409,'Mudança de colaborador requer substituição explícita da escala.');
 }
 if(entity!=='StandardSchedule')checkDate(data.date);
 if(old&&entity==='TimeRecord'&&old.date!==data.date)throw fail(409,'Não é permitido transferir o ponto para outra data.');
 if(entity==='StandardSchedule'&&(!Number.isInteger(data.weekday)||data.weekday<0||data.weekday>6))throw fail(400,'Dia da semana inválido.');
 if(['Schedule','StandardSchedule'].includes(entity)){
  if(!['trabalho','folga','ferias','afastamento','compensacao'].includes(data.day_type))throw fail(400,'Tipo de jornada inválido.');
  if(entity==='Schedule'&&!['ativo','cancelado'].includes(data.status))throw fail(400,'Status inválido.');
  ordered([data.start_time,data.break_start,data.break_end,data.end_time]);
  if(workday(data.day_type)&&(!data.start_time||!data.end_time||minutes(data.end_time)<=minutes(data.start_time)))throw fail(400,'Jornada de trabalho requer entrada e saída válidas.');
  if(Boolean(data.break_start)!==Boolean(data.break_end))throw fail(400,'Intervalo requer início e fim.');
  if(data.break_start&&(!data.start_time||!data.end_time))throw fail(400,'Intervalo requer jornada completa.');
  if(entity==='StandardSchedule'){
   if((await client.query("SELECT 1 FROM local_records WHERE entity='StandardSchedule' AND NOT deleted AND id<>$1 AND data->>'employee_id'=$2 AND (data->>'weekday')::int=$3",[id,data.employee_id,data.weekday])).rowCount)throw fail(409,'Escala padrão já existe para este colaborador e dia.');
  }else{
   if(data.absence_marked && !(await client.query("SELECT 1 FROM local_records WHERE entity='Absence' AND NOT deleted AND data->>'employee_id'=$1 AND data->>'date'=$2 AND data->>'status'='ativo'",[data.employee_id,data.date])).rowCount)throw fail(409,'Marcação de ausência requer ocorrência vinculada.');
   const others=(await client.query("SELECT data FROM local_records WHERE entity='Schedule' AND NOT deleted AND id<>$1 AND data->>'employee_id'=$2 AND data->>'date'=$3 AND data->>'status'='ativo'",[id,data.employee_id,data.date])).rows;
   if(data.status==='ativo')for(const {data:other}of others){
    if(!workday(other.day_type)||!workday(data.day_type)||(minutes(data.start_time)<minutes(other.end_time)&&minutes(other.start_time)<minutes(data.end_time)))throw fail(409,'Conflito de escala para o colaborador nesta data.');
   }
   if(old&&(old.date!==data.date||old.employee_id!==data.employee_id||old.start_time!==data.start_time||old.end_time!==data.end_time||old.day_type!==data.day_type||data.status==='cancelado')){
    if((await client.query("SELECT 1 FROM local_records WHERE entity='TimeRecord' AND NOT deleted AND data->>'employee_id'=$1 AND data->>'date'=$2",[old.employee_id,old.date])).rowCount)throw fail(409,'Escala já possui ponto. Corrija os registros vinculados antes de alterar a jornada.');
   }
  }
  return;
 }
 // Point data is validated against schedules/settings read inside the same transaction.
 ordered([data.entry_time,data.lunch_start,data.lunch_end,data.exit_time]);
 if((data.lunch_start||data.lunch_end||data.exit_time)&&!data.entry_time)throw fail(400,'Registre a entrada antes dos demais horários.');
 if(data.lunch_end&&!data.lunch_start)throw fail(400,'Registre a saída para almoço antes do retorno.');
 if(data.exit_time&&data.lunch_start&&!data.lunch_end)throw fail(400,'Registre o retorno antes da saída final.');
 if(!['registro_gerente','registro_rapido','ajuste_admin'].includes(data.origin))throw fail(400,'Origem do registro inválida.');
 if((await client.query("SELECT 1 FROM local_records WHERE entity='TimeRecord' AND NOT deleted AND id<>$1 AND data->>'employee_id'=$2 AND data->>'date'=$3",[id,data.employee_id,data.date])).rowCount)throw fail(409,'Ponto já existe para o colaborador nesta data.');
 if(data.origin==='ajuste_admin'&&(!data.correction_reason?.trim()||data.correction_reason.length<3))throw fail(400,'Ajuste manual requer justificativa.');
 if(old&&data.origin!=='ajuste_admin')for(const key of ['entry_time','lunch_start','lunch_end','exit_time'])if(old[key]&&data[key]!==old[key])throw fail(409,'Horário já registrado. Utilize ajuste manual com justificativa.');
 const schedules=(await client.query("SELECT id,data FROM local_records WHERE entity='Schedule' AND NOT deleted AND data->>'employee_id'=$1 AND data->>'date'=$2 AND data->>'status'='ativo' ORDER BY data->>'start_time',id",[data.employee_id,data.date])).rows;
 const scheduled=data.schedule_id?schedules.find(row=>row.id===data.schedule_id):schedules[0];
 if(data.schedule_id&&!scheduled)throw fail(409,'Escala vinculada não corresponde ao colaborador e à data.');
 const schedule=scheduled?.data;
 if((data.expected_start||'')!==(schedule?.start_time||'')||(data.expected_end||'')!==(schedule?.end_time||''))throw fail(409,'Jornada prevista desatualizada. Recarregue a escala.');
 const settings=(await client.query("SELECT data FROM local_records WHERE entity='SystemSettings' AND NOT deleted ORDER BY id LIMIT 1")).rows[0]?.data;
 const tolerance=settings?.tolerance_minutes??5;
 const metrics=journeyMetrics(data,schedule,tolerance);
 for(const [key,value]of Object.entries(metrics))if(data[key]!==value)throw fail(400,`Indicador de jornada inconsistente: ${key}`);
 if(data.status!==journeyStatus(data,schedule,tolerance))throw fail(400,'Status de ponto inconsistente com a jornada.');
}
