import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, Wallet, Pencil } from 'lucide-react';
import ValeForm from '@/components/rh/ValeForm';
import { formatBR } from '@/lib/timeUtils';
import { VALE_STATUS, rangeFor, inRange, brl } from '@/lib/rhUtils';

export default function Vales() {
  const [vales, setVales] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [period, setPeriod] = useState('mes');
  const [sectorFilter, setSectorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [val, emps] = await Promise.all([
        base44.entities.Vale.list('-date', 500),
        base44.entities.Employee.list('-created_date', 500),
      ]);
      setVales(val); setEmployees(emps);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const range = useMemo(() => rangeFor(period), [period]);
  const sectors = useMemo(() => [...new Set(employees.map((e) => e.sector).filter(Boolean))], [employees]);

  const filtered = useMemo(() => vales.filter((v) => {
    if (!inRange(v.date, range)) return false;
    if (statusFilter && v.status !== statusFilter) return false;
    if (empFilter && v.employee_id !== empFilter) return false;
    if (sectorFilter) { const e = employees.find((x) => x.id === v.employee_id); if (!e || e.sector !== sectorFilter) return false; }
    return true;
  }), [vales, range, statusFilter, empFilter, sectorFilter, employees]);

  const totalGeral = filtered.reduce((s, v) => s + (v.amount || 0), 0);
  const totalPendente = filtered.filter((v) => v.status === 'pendente').reduce((s, v) => s + (v.amount || 0), 0);
  const porColaborador = useMemo(() => {
    const map = {};
    filtered.forEach((v) => { map[v.employee_name] = (map[v.employee_name] || 0) + (v.amount || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const selectCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vales</h1>
          <p className="text-sm text-slate-500">Controle de vales e adiantamentos</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Novo vale</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total no período</p><p className="text-xl font-semibold text-slate-900 mt-1">{brl(totalGeral)}</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-xs text-amber-700">Pendentes</p><p className="text-xl font-semibold text-amber-700 mt-1">{brl(totalPendente)}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Colaboradores com vale</p><p className="text-xl font-semibold text-slate-900 mt-1">{porColaborador.length}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[{ k: 'hoje', l: 'Hoje' }, { k: 'semana', l: 'Semana' }, { k: 'mes', l: 'Mês' }].map((p) => (
            <button key={p.k} onClick={() => setPeriod(p.k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{p.l}</button>
          ))}
        </div>
        <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os funcionários</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os setores</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os status</option>{Object.entries(VALE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div> : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400"><Wallet className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum vale no período.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Funcionário</th>
                  <th className="text-left font-medium px-4 py-3">Data</th>
                  <th className="text-left font-medium px-4 py-3">Valor</th>
                  <th className="text-left font-medium px-4 py-3">Motivo</th>
                  <th className="text-left font-medium px-4 py-3">Autorizou</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{v.employee_name}</td>
                    <td className="px-4 py-3 text-slate-600">{formatBR(v.date)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{brl(v.amount)}</td>
                    <td className="px-4 py-3 text-slate-600">{v.motive || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{v.authorized_by || '—'}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${VALE_STATUS[v.status]?.style || ''}`}>{VALE_STATUS[v.status]?.label || v.status}</span></td>
                    <td className="px-4 py-3"><button onClick={() => { setEditing(v); setFormOpen(true); }} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {porColaborador.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-800 mb-3">Total por colaborador</h3>
          <div className="space-y-1.5">
            {porColaborador.map(([name, total]) => (
              <div key={name} className="flex justify-between text-sm border-b border-slate-50 py-1.5">
                <span className="text-slate-700">{name}</span><span className="font-medium text-slate-900">{brl(total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ValeForm open={formOpen} onOpenChange={setFormOpen} employees={employees} onSaved={load} editing={editing} />
    </div>
  );
}