import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Briefcase, Trash2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import JobRoleForm from '@/components/rh/JobRoleForm';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { employeesUsingRole, roleDeleteBlocker, roleDeletePatch } from '@/lib/roleUtils';

export default function Funcoes() {
  const [roles, setRoles] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [removingBusy, setRemovingBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [rls, secs, emps] = await Promise.all([
        base44.entities.JobRole.list('-created_date', 300),
        base44.entities.Sector.list('-created_date', 200),
        // Precisamos dos colaboradores para saber se a função está em uso.
        base44.entities.Employee.list('-created_date', 500),
      ]);
      setRoles(rls); setSectors(secs); setEmployees(emps);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (r) => {
    const next = r.status === 'ativo' ? 'inativo' : 'ativo';
    await base44.entities.JobRole.update(r.id, { status: next });
    await logAudit({ entity_type: 'JobRole', entity_id: r.id, action: 'alteracao', field: 'status', old_value: r.status, new_value: next, responsible_user: currentUserName() });
    load();
  };

  // Botão "Excluir": desativação LÓGICA (o `status` já existe na entity).
  // Se há colaborador usando a função, bloqueia e explica — nada é alterado
  // em cascata e o cadastro do colaborador fica intacto.
  const blocker = removing ? roleDeleteBlocker(removing, employees) : null;
  const confirmRemove = async () => {
    if (!removing || blocker) return;
    setRemovingBusy(true);
    setRemoveError('');
    try {
      const patch = roleDeletePatch(removing);
      await base44.entities.JobRole.update(removing.id, patch);
      await logAudit({
        entity_type: 'JobRole', entity_id: removing.id, action: 'exclusao_logica',
        old_value: removing.name, new_value: `status=${patch.status}`,
        reason: 'Função desativada pela tela de Funções.', responsible_user: currentUserName(),
      });
      setRemoving(null);
      await load();
    } catch (err) {
      setRemoveError(err?.message || 'Não foi possível desativar a função. Tente novamente.');
    } finally { setRemovingBusy(false); }
  };

  const abrirExclusao = (r) => { setRemoveError(''); setRemoving(r); };
  const acaoExcluir = (r) => (
    <button
      type="button"
      onClick={() => abrirExclusao(r)}
      title={`Excluir função ${r.name}`}
      aria-label={`Excluir função ${r.name}`}
      className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );

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
                        <button type="button" onClick={() => { setEditing(r); setFormOpen(true); }} title={`Editar função ${r.name}`} aria-label={`Editar função ${r.name}`} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                        {acaoExcluir(r)}
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
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => { setEditing(r); setFormOpen(true); }} title={`Editar função ${r.name}`} aria-label={`Editar função ${r.name}`} className="p-1 rounded hover:bg-slate-100 text-slate-500"><Pencil className="w-3.5 h-3.5" /></button>
                      {acaoExcluir(r)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <JobRoleForm open={formOpen} onOpenChange={setFormOpen} editing={editing} onSaved={load} sectors={sectors} />

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => { if (!open && !removingBusy) { setRemoving(null); setRemoveError(''); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir função?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing
                ? `Tem certeza que deseja excluir a função "${removing.name}"? A função deixa de aparecer para novos vínculos, mas o histórico continua.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {blocker && (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {blocker}
              {removing && (
                <span className="block mt-1 text-xs">
                  Vinculados: {employeesUsingRole(employees, removing).map((e) => e.name).join(', ')}
                </span>
              )}
            </p>
          )}
          {removeError && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{removeError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              disabled={removingBusy || Boolean(blocker)}
              className="bg-red-600 hover:bg-red-700"
            >
              {removingBusy ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}