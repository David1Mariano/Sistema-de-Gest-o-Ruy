import { base44 } from '@/api/base44Client';
import { computeMetrics, deriveStatus, logAudit } from './pontoUtils';
import { currentUserName } from './useCurrentUser';
import { nowTime } from './timeUtils';

const PUNCH_FIELDS = {
  entrada: 'entry_time',
  almoco: 'lunch_start',
  retorno: 'lunch_end',
  saida: 'exit_time',
};

export const PUNCH_LABELS = {
  entrada: 'Entrada',
  almoco: 'Saída para almoço',
  retorno: 'Retorno do almoço',
  saida: 'Saída final',
};

export async function findScheduleFor(employeeId, date) {
  const list = await base44.entities.Schedule.filter({ employee_id: employeeId, date, status: 'ativo' }, 'start_time', 5);
  return list[0] || null;
}

export async function registerPunch(employee, date, punchType, opts = {}) {
  const field = PUNCH_FIELDS[punchType];
  if (!field) throw new Error('Tipo de registro inválido');
  const tolerance = opts.tolerance ?? 5;
  const responsible = opts.responsible || currentUserName();
  const origin = opts.origin || 'registro_gerente';
  const now = nowTime();
  const schedule = await findScheduleFor(employee.id, date);
  const existing = (await base44.entities.TimeRecord.filter({ employee_id: employee.id, date }, '-created_date', 5))[0];

  const base = existing || {
    employee_id: employee.id, employee_name: employee.name, date,
    sector: employee.sector || '', unit: employee.unit || '',
    entry_time: '', lunch_start: '', lunch_end: '', exit_time: '',
  };
  const oldVal = base[field] || '';
  const updated = { ...base, [field]: now, responsible_user: responsible, origin, observation: base.observation || '' };
  updated.expected_start = schedule?.start_time || '';
  updated.expected_end = schedule?.end_time || '';
  const m = computeMetrics(updated, schedule, tolerance);
  updated.late_minutes = m.late_minutes;
  updated.early_exit_minutes = m.early_exit_minutes;
  updated.worked_minutes = m.worked_minutes;
  updated.expected_minutes = m.expected_minutes;
  updated.break_minutes = m.break_minutes;
  updated.status = deriveStatus(updated, schedule, tolerance);

  let saved;
  if (existing?.id) {
    saved = await base44.entities.TimeRecord.update(existing.id, updated);
    await logAudit({ entity_type: 'TimeRecord', entity_id: existing.id, action: 'alteracao', field, old_value: oldVal, new_value: now, responsible_user: responsible });
  } else {
    saved = await base44.entities.TimeRecord.create(updated);
    await logAudit({ entity_type: 'TimeRecord', entity_id: saved.id, action: 'criacao', field, new_value: now, responsible_user: responsible });
  }
  return { saved, time: now };
}

// Marca falta/falta justificada/folga — usa a entidade Absence (RH), nunca banco separado
export async function markAbsence(row, type, opts = {}) {
  const responsible = opts.responsible || currentUserName();
  const observation = opts.observation || '';
  const created = await base44.entities.Absence.create({
    employee_id: row.employee_id, employee_name: row.employee_name,
    date: row.schedule?.date || row.record?.date, type,
    status: 'ativo', observation, responsible_user: responsible,
    schedule_id: row.schedule?.id || '',
  });
  if (row.schedule?.id) {
    const patch = { absence_marked: true };
    if (type === 'folga') patch.day_type = 'folga';
    await base44.entities.Schedule.update(row.schedule.id, patch);
    await logAudit({ entity_type: 'Schedule', entity_id: row.schedule.id, action: 'registro_falta', field: 'ausencia', old_value: row.status, new_value: type, reason: observation, responsible_user: responsible });
  }
  await logAudit({ entity_type: 'Absence', entity_id: created.id, action: 'registro_falta', new_value: type, reason: observation, responsible_user: responsible });
  return created;
}

// Ajuste manual de um campo do ponto — nunca substitui silenciosamente; grava auditoria
export async function adjustRecord(record, field, newValue, opts = {}) {
  const responsible = opts.responsible || currentUserName();
  const reason = opts.reason || '';
  const observation = opts.observation || '';
  const tolerance = opts.tolerance ?? 5;
  const oldVal = record[field] || '';
  const updated = { ...record, [field]: newValue, observation: observation || record.observation || '', origin: 'ajuste_admin', responsible_user: responsible };
  const schedule = record.schedule_id ? (await base44.entities.Schedule.get(record.schedule_id).catch(() => null)) : null;
  const m = computeMetrics(updated, schedule, tolerance);
  Object.assign(updated, {
    late_minutes: m.late_minutes, early_exit_minutes: m.early_exit_minutes,
    worked_minutes: m.worked_minutes, expected_minutes: m.expected_minutes, break_minutes: m.break_minutes,
    status: deriveStatus(updated, schedule, tolerance),
  });
  const saved = await base44.entities.TimeRecord.update(record.id, updated);
  await logAudit({ entity_type: 'TimeRecord', entity_id: record.id, action: 'alteracao', field, old_value: oldVal, new_value: newValue, reason, responsible_user: responsible });
  return saved;
}