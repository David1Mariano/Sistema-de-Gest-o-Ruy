import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { todayISO, addDays, minutesToTime } from '@/lib/timeUtils';
import { computeMetrics, isIncomplete } from '@/lib/pontoUtils';
import { Download, Landmark } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUserRole } from '@/lib/useUserRole';

export default function Relatorios() {
  const { isAdmin } = useUserRole();
  const [start, setStart] = useState(addDays(todayISO(), -30));
  const [end, setEnd] = useState(todayISO());
  const [fSector, setFSector] = useState('');
  const [fUnit, setFUnit] = useState('');
  const [fEmployee, setFEmployee] = useState('');
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [records, setRecords] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [emps, scheds, recs, abs] = await Promise.all([
        base44.entities.Employee.filter({ status: 'ativo' }, 'name', 500),
        base44.entities.Schedule.filter({ status: 'ativo' }, 'date', 500),
        base44.entities.TimeRecord.list('-date', 500),
        base44.entities.Absence.filter({ status: 'ativo' }, 'date', 500),
      ]);
      setEmployees(emps); setSchedules(scheds); setRecords(recs); setAbsences(abs);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const sectors = useMemo(() => [...new Set(employees.map((e) => e.sector).filter(Boolean))], [employees]);
  const units = useMemo(() => [...new Set(employees.map((e) => e.unit).filter(Boolean))], [employees]);

  const inRange = (d) => d >= start && d <= end;

  const summary = useMemo(() => {
    return employees
      .filter((e) => (!fSector || e.sector === fSector) && (!fUnit || e.unit === fUnit) && (!fEmployee || e.id === fEmployee))
      .map((e) => {
        const empScheds = schedules.filter((s) => s.employee_id === e.id && inRange(s.date) && (s.day_type === 'trabalho' || s.day_type === 'compensacao'));
        const empRecs = records.filter((r) => r.employee_id === e.id && inRange(r.date));
        const empAbs = absences.filter((a) => a.employee_id === e.id && inRange(a.date));
        const diasPrevistos = empScheds.length;
        let diasTrabalhados = 0, atrasos = 0, minAtraso = 0, antecipadas = 0, incompletos = 0;
        empRecs.forEach((r) => {
          const sched = empScheds.find((s) => s.date === r.date);
          if (r.entry_time && r.exit_time) diasTrabalhados += 1;
          const m = computeMetrics(r, sched, 0);
          if (m.late_minutes > 0) { atrasos += 1; minAtraso += m.late_minutes; }
          if (m.early_exit_minutes > 0) antecipadas += 1;
          if (isIncomplete(r)) incompletos += 1;
        });
        const faltas = empAbs.filter((a) => a.type === 'falta').length;
        return {
          employee: e, diasPrevistos, diasTrabalhados, faltas, atrasos,
          minAtraso, antecipadas, incompletos,
        };
      });
  }, [employees, schedules, records, absences, start, end, fSector, fUnit, fEmployee]);

  const totals = summary.reduce((acc, s) => ({
    diasPrevistos: acc.diasPrevistos + s.diasPrevistos,
    diasTrabalhados: acc.diasTrabalhados + s.diasTrabalhados,
    faltas: acc.faltas + s.faltas,
    atrasos: acc.atrasos + s.atrasos,
    minAtraso: acc.minAtraso + s.minAtraso,
    antecipadas: acc.antecipadas + s.antecipadas,
    incompletos: acc.incompletos + s.incompletos,
  }), { diasPrevistos: 0, diasTrabalhados: 0, faltas: 0, atrasos: 0, minAtraso: 0, antecipadas: 0, incompletos: 0 });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relatórios de Ponto</h1>
          <p className="text-sm text-slate-500">Frequência e ocorrências por colaborador</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <Link to="/relatorios/financeiro" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50"><Landmark className="w-4 h-4" /> Relatório financeiro</Link>}
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-slate-900 text-white hover:bg-slate-800">
            <Download className="w-4 h-4" /> Exportar / Imprimir
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Data inicial</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Data final</label>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Setor</label>
          <select value={fSector} onChange={(e) => setFSector(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">Todos</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Unidade</label>
          <select value={fUnit} onChange={(e) => setFUnit(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">Todas</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Funcionário</label>
          <select value={fEmployee} onChange={(e) => setFEmployee(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">Todos</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3">Funcionário</th>
                <th className="text-left font-medium px-4 py-3">Setor</th>
                <th className="text-right font-medium px-4 py-3">Dias prev.</th>
                <th className="text-right font-medium px-4 py-3">Trab.</th>
                <th className="text-right font-medium px-4 py-3">Faltas</th>
                <th className="text-right font-medium px-4 py-3">Atrasos</th>
                <th className="text-right font-medium px-4 py-3">Min. atraso</th>
                <th className="text-right font-medium px-4 py-3">Saídas antec.</th>
                <th className="text-right font-medium px-4 py-3">Incompletos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.map((s) => (
                <tr key={s.employee.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">{s.employee.name}</td>
                  <td className="px-4 py-3 text-slate-600">{s.employee.sector || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.diasPrevistos}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.diasTrabalhados}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-rose-600">{s.faltas}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{s.atrasos}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{minutesToTime(s.minAtraso) || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.antecipadas}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{s.incompletos}</td>
                </tr>
              ))}
              {summary.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Sem dados no período.</td></tr>}
            </tbody>
            {summary.length > 0 && (
              <tfoot className="bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <td className="px-4 py-3" colSpan={2}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.diasPrevistos}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.diasTrabalhados}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.faltas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.atrasos}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{minutesToTime(totals.minAtraso) || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.antecipadas}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.incompletos}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}