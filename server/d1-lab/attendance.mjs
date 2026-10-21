import {fail,uuid} from './core.mjs';
import {isAttendance} from './attendance-contract.mjs';
export {isAttendance};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const minute=v=>{if(!v)return null;if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw fail(400,'Horário inválido.');return Number(v.slice(0,2))*60+Number(v.slice(3));};
export async function prepareAttendance({c,actor,body,old,data,save}){
 if(!uuid(data.employee_id))throw fail(400,'Colaborador obrigatório.');
 if(old&&old.employee_id!==data.employee_id)throw fail(409,'Não transferir um registro de jornada para outro colaborador.');
 const employee=(await c.query("SELECT data FROM d1_records WHERE id=$1 AND owner_id=$2 AND entity='Employee' AND coalesce(data->>'_deleted','false')<>'true' FOR SHARE",[data.employee_id,actor.id])).rows[0];
 if(!employee)throw fail(403,'Colaborador fora do escopo.');
 data.employee_name=employee.data.name;
 const rows=(await c.query('SELECT * FROM d2_catalog WHERE owner_id=$1 AND entity=$2 ORDER BY id',[actor.id,body.entity])).rows.map(r=>({row:r,data:JSON.parse(r.data.payload_json)}));
 if(body.entity==='StandardSchedule'){
  if(!Number.isInteger(data.weekday)||data.weekday<0||data.weekday>6)throw fail(400,'Dia da semana inválido.');
  if(rows.some(r=>r.row.id!==body.id&&r.data.employee_id===data.employee_id&&r.data.weekday===data.weekday))throw fail(409,'Escala padrão já registrada para esse dia.');
 }else if(!date(data.date))throw fail(400,'Data inválida.');
 if(old&&old.date&&old.date!==data.date)throw fail(409,'Data do registro não pode ser transferida.');
 if(['Schedule','StandardSchedule'].includes(body.entity)){
  data.status=data.status||'ativo';if(!['ativo','cancelado'].includes(data.status)||!['trabalho','compensacao','folga','ferias','afastamento'].includes(data.day_type))throw fail(400,'Situação da escala inválida.');
  const start=minute(data.start_time),end=minute(data.end_time),b1=minute(data.break_start),b2=minute(data.break_end);
  if(['trabalho','compensacao'].includes(data.day_type)&&(start===null||end===null||end<=start))throw fail(400,'Jornada deve ter início e fim válidos no mesmo dia.');
  if((b1===null)!==(b2===null)||b1!==null&&(start===null||end===null||b2<=b1||b1<start||b2>end))throw fail(400,'Intervalo fora da jornada.');
  if(body.entity==='Schedule'&&data.status==='ativo')for(const r of rows){const other=r.data;if(r.row.id===body.id||other.employee_id!==data.employee_id||other.date!==data.date||other.status!=='ativo')continue;const work=['trabalho','compensacao'].includes(data.day_type),otherWork=['trabalho','compensacao'].includes(other.day_type);if(!work||!otherWork||start<minute(other.end_time)&&minute(other.start_time)<end)throw fail(409,'Conflito de escala para o colaborador.');}
 }
 if(body.entity==='TimeRecord'){
  if(rows.some(r=>r.row.id!==body.id&&r.data.employee_id===data.employee_id&&r.data.date===data.date))throw fail(409,'Já existe ponto desse colaborador nesta data.');
  const schedules=(await c.query("SELECT id,data FROM d2_catalog WHERE owner_id=$1 AND entity='Schedule'",[actor.id])).rows.map(r=>({id:r.id,...JSON.parse(r.data.payload_json)})).filter(s=>s.employee_id===data.employee_id&&s.date===data.date&&s.status==='ativo');
  if(schedules.length>1&&!data.schedule_id)throw fail(409,'Selecione a escala correspondente ao ponto.');
  const schedule=data.schedule_id?schedules.find(s=>s.id===data.schedule_id):schedules[0];if(data.schedule_id&&!schedule)throw fail(409,'Escala não corresponde ao ponto.');
  if(schedule&&!['trabalho','compensacao'].includes(schedule.day_type))throw fail(409,'Ponto exige escala de trabalho.');
  const keys=['entry_time','lunch_start','lunch_end','exit_time'],values=keys.map(k=>minute(data[k]));const [entry,b1,b2,exit]=values;
  if(entry===null&&(b1!==null||b2!==null||exit!==null)||b2!==null&&b1===null||exit!==null&&b1!==null&&b2===null)throw fail(400,'Sequência de marcações incompleta.');
  const filled=values.filter(v=>v!==null);if(filled.some((v,i)=>i>0&&v<filled[i-1]))throw fail(400,'Marcações fora de ordem.');
  const changed=old&&keys.some(k=>old[k]&&old[k]!==data[k]);if(changed&&!String(data.adjustment_reason||'').trim())throw fail(400,'Ajuste de marcação exige justificativa.');
  const settings=(await c.query("SELECT data FROM d2_catalog WHERE owner_id=$1 AND entity='SystemSettings' ORDER BY updated_at DESC LIMIT 1",[actor.id])).rows[0]?.data;
  const tolerance=settings?.tolerance_minutes??5;if(!Number.isInteger(tolerance)||tolerance<0||tolerance>120)throw fail(409,'Configure a tolerância de jornada.');
  data.schedule_id=schedule?.id||'';data.expected_start=schedule?.start_time||'';data.expected_end=schedule?.end_time||'';
  const expectedStart=minute(data.expected_start),expectedEnd=minute(data.expected_end),plannedBreak=schedule?.break_start&&schedule?.break_end?minute(schedule.break_end)-minute(schedule.break_start):0;
  data.break_minutes=b1!==null&&b2!==null?b2-b1:0;data.worked_minutes=entry!==null&&exit!==null?exit-entry-data.break_minutes:0;data.expected_minutes=expectedStart!==null&&expectedEnd!==null?expectedEnd-expectedStart-plannedBreak:0;
  data.late_minutes=entry!==null&&expectedStart!==null?Math.max(0,entry-expectedStart-tolerance):0;data.early_exit_minutes=exit!==null&&expectedEnd!==null?Math.max(0,expectedEnd-exit-tolerance):0;
  data.status=exit!==null?'finalizado':b1!==null&&b2===null?'intervalo':entry!==null?(data.late_minutes?'atrasado':'presente'):'incompleto';data.responsible_user=actor.id;
 }
 if(body.entity==='Absence'){
  if(!['falta','atraso','saida_antecipada','ausencia_parcial','justificada','nao_justificada','folga'].includes(data.type)||!['ativo','cancelado'].includes(data.status))throw fail(400,'Ocorrência inválida.');
  if(data.schedule_id){const row=(await c.query("SELECT * FROM d2_catalog WHERE id=$1 AND owner_id=$2 AND entity='Schedule' FOR UPDATE",[data.schedule_id,actor.id])).rows[0];const schedule=row&&JSON.parse(row.data.payload_json);if(!schedule||schedule.employee_id!==data.employee_id||schedule.date!==data.date)throw fail(409,'Ocorrência não corresponde à escala.');await save('Schedule',row.id,{...schedule,absence_marked:data.status==='ativo'},row);}
  data.responsible_user=actor.id;
 }
 if(body.entity==='Warning'){if(!data.description?.trim()||!['pendente','tratada','cancelada'].includes(data.status))throw fail(400,'Advertência inválida.');data.responsible_user=actor.id;}
 return data;
}
