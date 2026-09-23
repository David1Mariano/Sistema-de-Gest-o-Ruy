import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, ShoppingBag, Pencil } from 'lucide-react';
import ConsumptionForm from '@/components/rh/ConsumptionForm';
import { formatBR } from '@/lib/timeUtils';
import { CONSUMPTION_STATUS, rangeFor, inRange, brl } from '@/lib/rhUtils';

export default function Consumo() {
  const [items, setItems] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [period, setPeriod] = useState('mes');
  const [statusFilter, setStatusFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [it, emps] = await Promise.all([
        base44.entities.Consumption.list('-date', 500),
        base44.entities.Employee.list('-created_date', 500),
      ]);
      setItems(it); setEmployees(emps);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const range = useMemo(() => rangeFor(period), [period]);
  const filtered = useMemo(() => items.filter((c) => {
    if (!inRange(c.date, range)) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (empFilter && c.employee_id !== empFilter) return false;
    return true;
  }), [items, range, statusFilter, empFilter]);

  const totalGeral = filtered.reduce((s, c) => s + (c.amount || 0), 0);
  const porColaborador = useMemo(() => {
    const map = {};
    filtered.forEach((c) => { map[c.employee_name] = (map[c.employee_name] || 0) + (c.amount || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const selectCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Consumo de Funcionários</h1>
          <p className="text-sm text-slate-500">Controle de consumo interno</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Novo consumo</Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Total no período</p><p className="text-xl font-semibold text-slate-900 mt-1">{brl(totalGeral)}</p></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Lançamentos</p><p className="text-xl font-semibold text-slate-900 mt-1">{filtered.length}</p></div>
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
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os status</option>{Object.entries(CONSUMPTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div> : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400"><ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum consumo no período.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Funcionário</th>
                  <th className="text-left font-medium px-4 py-3">Data</th>
                  <th className="text-left font-medium px-4 py-3">Produto</th>
                  <th className="text-left font-medium px-4 py-3">Qtd</th>
                  <th className="text-left font-medium px-4 py-3">Valor</th>
                  <th className="text-left font-medium px-4 py-3">Lançado por</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-left font-medium px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{c.employee_name}</td>
                    <td className="px-4 py-3 text-slate-600">{formatBR(c.date)}</td>
                    <td className="px-4 py-3 text-slate-600">{c.product}</td>
                    <td className="px-4 py-3 text-slate-600">{c.quantity}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{brl(c.amount)}</td>
                    <td className="px-4 py-3 text-slate-600">{c.registered_by || '—'}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${CONSUMPTION_STATUS[c.status]?.style || ''}`}>{CONSUMPTION_STATUS[c.status]?.label || c.status}</span></td>
                    <td className="px-4 py-3"><button onClick={() => { setEditing(c); setFormOpen(true); }} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {porColaborador.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="font-semibold text-slate-800 mb-3">Total acumulado por funcionário</h3>
          <div className="space-y-1.5">
            {porColaborador.map(([name, total]) => (
              <div key={name} className="flex justify-between text-sm border-b border-slate-50 py-1.5">
                <span className="text-slate-700">{name}</span><span className="font-medium text-slate-900">{brl(total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConsumptionForm open={formOpen} onOpenChange={setFormOpen} employees={employees} onSaved={load} editing={editing} />
    </div>
  );
}