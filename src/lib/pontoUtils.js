// Cálculos de jornada, status e auditoria para o módulo Ponto
import { base44 } from '@/api/base44Client';
import { timeToMinutes } from './timeUtils';

export function computeMetrics(record, schedule, tolerance = 5) {
  const expectedStart = schedule?.start_time || record.expected_start;
  const expectedEnd = schedule?.end_time || record.expected_end;
  const { entry_time, exit_time, lunch_start, lunch_end } = record;

  let late_minutes = 0;
  if (entry_time && expectedStart) {
    const d = timeToMinutes(entry_time) - timeToMinutes(expectedStart);
    if (d > tolerance) late_minutes = d - tolerance;
  }

  let early_exit_minutes = 0;
  if (exit_time && expectedEnd) {
    const d = timeToMinutes(expectedEnd) - timeToMinutes(exit_time);
    if (d > tolerance) early_exit_minutes = d - tolerance;
  }

  let break_minutes = 0;
  if (lunch_start && lunch_end) {
    break_minutes = timeToMinutes(lunch_end) - timeToMinutes(lunch_start);
  }

  let worked_minutes = 0;
  if (entry_time && exit_time) {
    worked_minutes = timeToMinutes(exit_time) - timeToMinutes(entry_time) - break_minutes;
  }

  let expected_minutes = 0;
  if (expectedStart && expectedEnd) {
    expected_minutes = timeToMinutes(expectedEnd) - timeToMinutes(expectedStart) - (break_minutes || 0);
  }

  return { late_minutes, early_exit_minutes, break_minutes, worked_minutes, expected_minutes };
}

// Status derivado: presente, atrasado, ausente, folga, intervalo, finalizado, incompleto
export function deriveStatus(record, schedule, tolerance = 5) {
  if (schedule && schedule.day_type && schedule.day_type !== 'trabalho' && schedule.day_type !== 'compensacao') {
    return 'folga';
  }
  const hasAny = record.entry_time || record.exit_time || record.lunch_start || record.lunch_end;
  if (!hasAny) {
    if (schedule && (schedule.day_type === 'trabalho' || schedule.day_type === 'compensacao')) {
      return 'ausente'; // possível ausência — não aplica falta definitiva
    }
    return 'incompleto';
  }
  if (record.lunch_start && !record.lunch_end) return 'intervalo';
  if (record.entry_time && record.exit_time) {
    const m = computeMetrics(record, schedule, tolerance);
    if (m.late_minutes > 0) return 'atrasado';
    return 'finalizado';
  }
  if (record.entry_time && !record.exit_time) {
    const m = computeMetrics(record, schedule, tolerance);
    if (m.late_minutes > 0) return 'atrasado';
    return 'presente';
  }
  return 'incompleto';
}

export const STATUS_LABELS = {
  presente: 'Presente',
  atrasado: 'Atrasado',
  ausente: 'Ausente',
  folga: 'Folga',
  intervalo: 'Intervalo',
  finalizado: 'Finalizado',
  incompleto: 'Incompleto',
};

export const STATUS_STYLES = {
  presente: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  atrasado: 'bg-amber-100 text-amber-700 border-amber-200',
  ausente: 'bg-rose-100 text-rose-700 border-rose-200',
  folga: 'bg-slate-100 text-slate-500 border-slate-200',
  intervalo: 'bg-sky-100 text-sky-700 border-sky-200',
  finalizado: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  incompleto: 'bg-amber-100 text-amber-700 border-amber-200',
};

export async function logAudit({ entity_type, entity_id, action, field, old_value, new_value, reason, responsible_user }) {
  try {
    await base44.entities.AuditLog.create({
      entity_type,
      entity_id: entity_id || '',
      action,
      field: field || '',
      old_value: old_value != null ? String(old_value) : '',
      new_value: new_value != null ? String(new_value) : '',
      reason: reason || '',
      responsible_user: responsible_user || '',
    });
  } catch (e) {
    // auditoria não deve quebrar o fluxo principal
  }
}

// Detecta registros incompletos
export function isIncomplete(record) {
  if (record.exit_time && !record.entry_time) return 'Saída sem entrada';
  if (record.lunch_start && !record.lunch_end) return 'Almoço sem retorno';
  if (record.lunch_end && !record.lunch_start) return 'Retorno sem saída para almoço';
  if (record.entry_time && record.lunch_start && record.lunch_end && !record.exit_time) return 'Entrada sem saída final';
  if (record.entry_time && record.exit_time && record.lunch_end && !record.lunch_start) return 'Jornada incompatível';
  return null;
}