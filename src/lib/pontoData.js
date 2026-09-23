import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { deriveStatus, computeMetrics } from './pontoUtils';

// Carrega escalas e registros de ponto de uma data e mescla em linhas operacionais
export function usePontoData(date) {
  const [schedules, setSchedules] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      const [scheds, recs] = await Promise.all([
        base44.entities.Schedule.filter({ date, status: 'ativo' }, 'start_time', 500),
        base44.entities.TimeRecord.filter({ date }, '-created_date', 500),
      ]);
      setSchedules(scheds);
      setRecords(recs);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);
  return { schedules, records, loading, reload: load };
}

// Constrói linhas do dia mesclando escala + registro
export function buildDayRows(schedules, records, tolerance = 5) {
  const recByEmp = {};
  records.forEach((r) => { recByEmp[r.employee_id] = r; });
  const rows = [];
  const used = new Set();

  schedules.forEach((s) => {
    const rec = recByEmp[s.employee_id] || null;
    const base = rec || {
      employee_id: s.employee_id, employee_name: s.employee_name, date: s.date,
      entry_time: '', lunch_start: '', lunch_end: '', exit_time: '',
      origin: '', responsible_user: '', observation: '',
    };
    const status = deriveStatus(base, s, tolerance);
    const metrics = computeMetrics(base, s, tolerance);
    rows.push({
      schedule: s, record: rec,
      employee_id: s.employee_id, employee_name: s.employee_name,
      sector: s.sector, unit: s.unit,
      expected_start: s.start_time, expected_end: s.end_time,
      entry_time: base.entry_time, lunch_start: base.lunch_start,
      lunch_end: base.lunch_end, exit_time: base.exit_time,
      status, metrics,
    });
    used.add(s.employee_id);
  });

  records.forEach((r) => {
    if (used.has(r.employee_id)) return;
    const status = deriveStatus(r, null, tolerance);
    const metrics = computeMetrics(r, null, tolerance);
    rows.push({
      schedule: null, record: r,
      employee_id: r.employee_id, employee_name: r.employee_name,
      sector: r.sector, unit: r.unit,
      expected_start: r.expected_start || '', expected_end: r.expected_end || '',
      entry_time: r.entry_time, lunch_start: r.lunch_start,
      lunch_end: r.lunch_end, exit_time: r.exit_time,
      status, metrics,
    });
  });

  return rows;
}

export function summarizeRows(rows) {
  const counts = { escalados: 0, presentes: 0, ausentes: 0, folga: 0, atrasados: 0, intervalo: 0, finalizado: 0, incompleto: 0 };
  rows.forEach((r) => {
    if (r.schedule) counts.escalados += 1;
    if (r.status === 'presente') counts.presentes += 1;
    if (r.status === 'atrasado') counts.atrasados += 1;
    if (r.status === 'ausente') counts.ausentes += 1;
    if (r.status === 'folga') counts.folga += 1;
    if (r.status === 'intervalo') counts.intervalo += 1;
    if (r.status === 'finalizado') counts.finalizado += 1;
    if (r.status === 'incompleto') counts.incompleto += 1;
  });
  return counts;
}