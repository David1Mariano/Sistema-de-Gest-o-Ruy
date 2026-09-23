import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Users } from 'lucide-react';
import SectorForm from '@/components/rh/SectorForm';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';

export default function Setores() {
  const [sectors, setSectors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [secs, emps] = await Promise.all([
        base44.entities.Sector.list('-created_date', 200),
        base44.entities.Employee.list('-created_date', 500),
      ]);
      setSectors(secs); setEmployees(emps);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (s) => {
    const next = s.status === 'ativo' ? 'inativo' : 'ativo';
    const count = employees.filter((e) => e.sector === s.name).length;
    if (next === 'inativo' && count > 0) {
      if (!confirm(`O setor "${s.name}" possui ${count} colaborador(es) vinculado(s). Desativar mesmo assim? (não exclui)`)) return;
    }
    await base44.entities.Sector.update(s.id, { status: next });
    await logAudit({ entity_type: 'Sector', entity_id: s.id, action: 'alteracao', field: 'status', old_value: s.status, new_value: next, responsible_user: currentUserName() });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Setores</h1>
          <p className="text-sm text-slate-500">Gerenciamento de setores da operação</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Novo setor</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading ? <div className="p-6 text-slate-400 text-sm">Carregando...</div> : sectors.length === 0 ? (
          <div className="col-span-full p-10 text-center text-slate-400"><Users className="w-8 h-8 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum setor cadastrado.</p></div>
        ) : sectors.map((s) => {
          const count = employees.filter((e) => e.sector === s.name).length;
          return (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800">{s.name}</p>
                  {s.description && <p className="text-xs text-slate-500 mt-0.5">{s.description}</p>}
                </div>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${s.status === 'ativo' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                  {s.status === 'ativo' ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                <p>Responsável: {s.responsible_name || '—'}</p>
                <p>Colaboradores: {count}</p>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" variant="outline" onClick={() => { setEditing(s); setFormOpen(true); }} className="gap-1.5"><Pencil className="w-3.5 h-3.5" /> Editar</Button>
                <Button size="sm" variant="ghost" onClick={() => toggleStatus(s)}>{s.status === 'ativo' ? 'Desativar' : 'Ativar'}</Button>
              </div>
            </div>
          );
        })}
      </div>

      <SectorForm open={formOpen} onOpenChange={setFormOpen} editing={editing} onSaved={load} employees={employees} />
    </div>
  );
}