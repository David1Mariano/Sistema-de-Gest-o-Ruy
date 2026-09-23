import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Briefcase } from 'lucide-react';
import JobRoleForm from '@/components/rh/JobRoleForm';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';

export default function Funcoes() {
  const [roles, setRoles] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [rls, secs] = await Promise.all([
        base44.entities.JobRole.list('-created_date', 300),
        base44.entities.Sector.list('-created_date', 200),
      ]);
      setRoles(rls); setSectors(secs);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (r) => {
    const next = r.status === 'ativo' ? 'inativo' : 'ativo';
    await base44.entities.JobRole.update(r.id, { status: next });
    await logAudit({ entity_type: 'JobRole', entity_id: r.id, action: 'alteracao', field: 'status', old_value: r.status, new_value: next, responsible_user: currentUserName() });
    load();
  };

  const grouped = sectors.map((s) => ({ sector: s, roles: roles.filter((r) => r.sector_name === s.name) }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Funções</h1>
          <p className="text-sm text-slate-500">Cadastro padronizado de funções por setor</p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Nova função</Button>
      </div>

      {loading ? <div className="p-6 text-slate-400 text-sm">Carregando...</div> : (
        <div className="space-y-4">
          {grouped.map(({ sector, roles: rs }) => (
            <div key={sector.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-semibold text-slate-800 mb-3">{sector.name}</h3>
              {rs.length === 0 ? <p className="text-sm text-slate-400">Nenhuma função neste setor.</p> : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {rs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-slate-700">{r.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${r.status === 'ativo' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                        <button onClick={() => { setEditing(r); setFormOpen(true); }} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {roles.filter((r) => !sectors.some((s) => s.name === r.sector_name)).length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-semibold text-slate-800 mb-3">Sem setor</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {roles.filter((r) => !sectors.some((s) => s.name === r.sector_name)).map((r) => (
                  <div key={r.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-700">{r.name}</span>
                    <button onClick={() => { setEditing(r); setFormOpen(true); }} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <JobRoleForm open={formOpen} onOpenChange={setFormOpen} editing={editing} onSaved={load} sectors={sectors} />
    </div>
  );
}