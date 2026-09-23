import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from './pontoUtils';
import { currentUserName } from './useCurrentUser';
import { addDays, startOfWeek, timeToMinutes, weekdayOf } from './timeUtils';

export function useAllSchedules() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSchedules(await base44.entities.Schedule.filter({ status: 'ativo' }, 'date', 500));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { schedules, loading, reload: load };
}

export function useStandardSchedules() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await base44.entities.StandardSchedule.list('employee_name', 500));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { list, loading, reload: load };
}

// Detecta conflitos de escala antes de salvar
export function detectConflict(newSched, existing) {
  if (newSched.start_time && newSched.end_time &&
      timeToMinutes(newSched.end_time) <= timeToMinutes(newSched.start_time)) {
    return 'Horário de saída anterior ao horário de entrada';
  }
  const ns = timeToMinutes(newSched.start_time);
  const ne = timeToMinutes(newSched.end_time);
  for (const s of existing) {
    if (s.employee_id !== newSched.employee_id) continue;
    if (s.id === newSched.id) continue;
    if (newSched.day_type === 'trabalho' && s.day_type === 'folga') return 'Funcionário marcado como folga e trabalho simultaneamente';
    if (newSched.day_type === 'trabalho' && s.day_type === 'ferias') return 'Funcionário em férias escalado para trabalhar';
    if (newSched.day_type !== 'trabalho' || s.day_type !== 'trabalho') continue;
    const ss = timeToMinutes(s.start_time);
    const se = timeToMinutes(s.end_time);
    if (ns < se && ss < ne) return 'Funcionário escalado duas vezes no mesmo horário';
  }
  return null;
}

export async function createSchedule(data, existingForDate, responsible) {
  const conflict = detectConflict(data, existingForDate);
  if (conflict) throw new Error(conflict);
  const created = await base44.entities.Schedule.create({ ...data, status: 'ativo' });
  await logAudit({ entity_type: 'Schedule', entity_id: created.id, action: 'criacao_escala', new_value: `${data.date} ${data.start_time}-${data.end_time}`, responsible_user: responsible || currentUserName() });
  return created;
}

export async function updateSchedule(id, patch, before, reason, responsible) {
  const updated = await base44.entities.Schedule.update(id, patch);
  const changes = Object.entries(patch).map(([k, v]) => `${k}: ${before[k] || ''} → ${v}`).join('; ');
  await logAudit({ entity_type: 'Schedule', entity_id: id, action: 'alteracao_escala', field: Object.keys(patch).join(','), old_value: JSON.stringify(before), new_value: JSON.stringify(patch), reason: reason || changes, responsible_user: responsible || currentUserName() });
  return updated;
}

export async function cancelSchedule(id, responsible) {
  const updated = await base44.entities.Schedule.update(id, { status: 'cancelado' });
  await logAudit({ entity_type: 'Schedule', entity_id: id, action: 'exclusao_logica', old_value: 'ativo', new_value: 'cancelado', responsible_user: responsible || currentUserName() });
  return updated;
}

// Duplicar semana: origem -> destino (não substitui existente sem confirmação)
export async function duplicateWeek(srcStart, dstStart, existingForDest, responsible) {
  const srcDays = Array.from({ length: 7 }, (_, i) => addDays(srcStart, i));
  const all = await base44.entities.Schedule.filter({ status: 'ativo' }, 'date', 500);
  const src = all.filter((s) => srcDays.includes(s.date));
  const created = [];
  for (const s of src) {
    const offset = weekdayOf(s.date) - weekdayOf(srcStart);
    const newDate = addDays(dstStart, offset);
    const conflict = detectConflict({ ...s, date: newDate }, existingForDest.filter((e) => e.date === newDate));
    if (conflict) continue; // pula conflitantes
    created.push(await base44.entities.Schedule.create({
      employee_id: s.employee_id, employee_name: s.employee_name, date: newDate,
      sector: s.sector, function: s.function, unit: s.unit,
      start_time: s.start_time, end_time: s.end_time,
      break_start: s.break_start, break_end: s.break_end, day_type: s.day_type,
      status: 'ativo', observation: s.observation || '',
    }));
  }
  await logAudit({ entity_type: 'Schedule', action: 'criacao_escala', field: 'duplicacao', old_value: srcStart, new_value: `${dstStart} (${created.length} escalas)`, responsible_user: responsible || currentUserName() });
  return created.length;
}

// Gera escalas de uma semana a partir da escala padrão de cada funcionário
export async function generateWeekFromStandard(weekStart, existingForWeek, responsible) {
  const standards = await base44.entities.StandardSchedule.list('employee_name', 500);
  const created = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const wd = weekdayOf(date);
    for (const st of standards.filter((s) => s.weekday === wd)) {
      const conflict = detectConflict({ ...st, date, day_type: st.day_type, start_time: st.start_time, end_time: st.end_time, employee_id: st.employee_id }, existingForWeek.filter((e) => e.date === date));
      if (conflict) continue;
      created.push(await base44.entities.Schedule.create({
        employee_id: st.employee_id, employee_name: st.employee_name, date,
        sector: '', function: '', unit: '',
        start_time: st.start_time, end_time: st.end_time,
        break_start: st.break_start, break_end: st.break_end, day_type: st.day_type,
        status: 'ativo', observation: 'Gerada pela escala padrão',
      }));
    }
  }
  await logAudit({ entity_type: 'Schedule', action: 'criacao_escala', field: 'geracao_padrao', new_value: `${weekStart} (${created.length} escalas)`, responsible_user: responsible || currentUserName() });
  return created.length;
}

export async function saveStandardSchedule(employee, weekday, data) {
  const existing = (await base44.entities.StandardSchedule.filter({ employee_id: employee.id, weekday }, 'weekday', 5))[0];
  if (existing) {
    return base44.entities.StandardSchedule.update(existing.id, { ...data });
  }
  return base44.entities.StandardSchedule.create({ employee_id: employee.id, employee_name: employee.name, weekday, ...data });
}