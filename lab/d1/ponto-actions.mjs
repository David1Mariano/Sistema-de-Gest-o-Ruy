import {base44} from './client.mjs';
export {registerPunch,findScheduleFor,PUNCH_LABELS} from '../../src/lib/pontoActions.js';
// The server updates the corresponding schedule in the same transaction.
export function markAbsence(row,type,opts={}){
 return base44.entities.Absence.create({employee_id:row.employee_id,date:row.schedule?.date||row.record?.date,type,status:'ativo',observation:opts.observation||'',schedule_id:row.schedule?.id||''});
}
export function adjustRecord(record,field,newValue,opts={}){
 if(!['entry_time','lunch_start','lunch_end','exit_time'].includes(field))throw Error('Campo de ponto inválido.');
 return base44.entities.TimeRecord.update(record.id,{...record,[field]:newValue,adjustment_reason:opts.reason||'',observation:opts.observation||record.observation||''});
}
