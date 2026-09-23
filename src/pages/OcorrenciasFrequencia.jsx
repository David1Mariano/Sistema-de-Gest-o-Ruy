import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, FileX2 } from 'lucide-react';
import AbsenceForm from '@/components/rh/AbsenceForm';
import { formatBR } from '@/lib/timeUtils';
import { ABSENCE_TYPES, rangeFor, inRange } from '@/lib/rhUtils';

export default function OcorrenciasFrequencia() {
  const [absences, setAbsences] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [period, setPeriod] = useState('mes');
  const [sectorFilter, setSectorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [abs, emps] = await Promise.all([
        base44.entities.Absence.list('-date', 500),
        base44.entities.Employee.list('-created_date', 500),
      ]);
      setAbsences(abs); setEmployees(emps);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const range = useMemo(() => rangeFor(period), [period]);
  const sectors = useMemo(() => [...new Set(employees.map((e) => e.sector).filter(Boolean))], [employees]);

  const filtered = useMemo(() => absences.filter((a) => {
    if (!inRange(a.date, range)) return false;
    if (typeFilter && a.type !== typeFilter) return false;
    if (sectorFilter) {
      const e = employees.find((x) => x.id === a.employee_id);
      if (!e || e.sector !== sectorFilter) return false;
    }
    return true;
  }), [absences, range, typeFilter, sectorFilter, employees]);

  const selectCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ocorrências de Frequência</h1>
          <p className="text-sm text-slate-500">Faltas, atrasos e ausências da equipe</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Registrar ocorrência</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[{ k: 'hoje', l: 'Hoje' }, { k: 'semana', l: 'Semana' }, { k: 'mes', l: 'Mês' }].map((p) => (
            <button key={p.k} onClick={() => setPeriod(p.k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{p.l}</button>
          ))}
        </div>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os setores</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os tipos</option>
          {Object.entries(ABSENCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div> : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400"><FileX2 className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhuma ocorrência no período.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Funcionário</th>
                  <th className="text-left font-medium px-4 py-3">Data</th>
                  <th className="text-left font-medium px-4 py-3">Tipo</th>
                  <th className="text-left font-medium px-4 py-3">Previsto</th>
                  <th className="text-left font-medium px-4 py-3">Realizado</th>
                  <th className="text-left font-medium px-4 py-3">Motivo</th>
                  <th className="text-left font-medium px-4 py-3">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{a.employee_name}</td>
                    <td className="px-4 py-3 text-slate-600">{formatBR(a.date)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${ABSENCE_TYPES[a.type]?.style || ''}`}>{ABSENCE_TYPES[a.type]?.label || a.type}</span></td>
                    <td className="px-4 py-3 text-slate-600">{a.expected_time || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{a.actual_time || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{a.reason || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{a.responsible_user || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AbsenceForm open={formOpen} onOpenChange={setFormOpen} employees={employees} onSaved={load} editing={editing} />
    </div>
  );
}