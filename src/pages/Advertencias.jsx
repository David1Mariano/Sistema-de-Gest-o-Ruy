import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, AlertTriangle } from 'lucide-react';
import WarningForm from '@/components/rh/WarningForm';
import { formatBR } from '@/lib/timeUtils';
import { WARNING_CATEGORIES, WARNING_STATUS, rangeFor, inRange } from '@/lib/rhUtils';

export default function Advertencias() {
  const [warnings, setWarnings] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [period, setPeriod] = useState('mes');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [w, emps] = await Promise.all([
        base44.entities.Warning.list('-date', 500),
        base44.entities.Employee.list('-created_date', 500),
      ]);
      setWarnings(w); setEmployees(emps);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const range = useMemo(() => rangeFor(period), [period]);
  const filtered = useMemo(() => warnings.filter((w) => {
    if (!inRange(w.date, range)) return false;
    if (catFilter && w.category !== catFilter) return false;
    if (statusFilter && w.status !== statusFilter) return false;
    return true;
  }), [warnings, range, catFilter, statusFilter]);

  const selectCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ocorrências Disciplinares</h1>
          <p className="text-sm text-slate-500">Registro de advertências e ocorrências — sem aplicação automática de punições</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Nova ocorrência</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[{ k: 'hoje', l: 'Hoje' }, { k: 'semana', l: 'Semana' }, { k: 'mes', l: 'Mês' }].map((p) => (
            <button key={p.k} onClick={() => setPeriod(p.k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{p.l}</button>
          ))}
        </div>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className={selectCls}>
          <option value="">Todas as categorias</option>{Object.entries(WARNING_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os status</option>{Object.entries(WARNING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {loading ? <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div> : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400 rounded-xl border border-slate-200 bg-white"><AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhuma ocorrência no período.</p></div>
        ) : filtered.map((w) => (
          <div key={w.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">{w.employee_name}</span>
                  <span className="text-xs text-slate-400">{formatBR(w.date)}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1">{w.description || '—'}</p>
                {w.observation && <p className="text-xs text-slate-400 mt-1">{w.observation}</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-600 border-slate-200">{WARNING_CATEGORIES[w.category] || w.category}</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${WARNING_STATUS[w.status]?.style || ''}`}>{WARNING_STATUS[w.status]?.label || w.status}</span>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-50">
              <span className="text-xs text-slate-400">Responsável: {w.responsible_user || '—'}</span>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(w); setFormOpen(true); }}>Editar</Button>
            </div>
          </div>
        ))}
      </div>

      <WarningForm open={formOpen} onOpenChange={setFormOpen} employees={employees} onSaved={load} editing={editing} />
    </div>
  );
}