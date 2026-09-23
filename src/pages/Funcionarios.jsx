import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Pencil, Trash2, Users, Eye, Wallet } from 'lucide-react';
import { Image } from '@/components/ui/image';
import EmployeeForm from '@/components/rh/EmployeeForm';
import { SangriaDialog } from '@/components/financeiro/SangriaPanel';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { EMPLOYEE_STATUS, tenure } from '@/lib/rhUtils';

const SANGRIA_ALLOWED = ['fabielle', 'patrick', 'luiz carlos neto', 'jocinei', 'gracielle', 'adriano', 'kamila'];
const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const canSangria = (name) => SANGRIA_ALLOWED.some(k => norm(name).startsWith(k));

export default function Funcionarios() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [functionFilter, setFunctionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sangriaOpen, setSangriaOpen] = useState(false);
  const [sangriaResp, setSangriaResp] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [list, secs, rls] = await Promise.all([
        base44.entities.Employee.list('-created_date', 500),
        base44.entities.Sector.list('-created_date', 200),
        base44.entities.JobRole.list('-created_date', 200),
      ]);
      setEmployees(list); setSectors(secs); setRoles(rls);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const functions = useMemo(() => [...new Set(employees.map((e) => e.function).filter(Boolean))], [employees]);

  const filtered = useMemo(() => employees.filter((e) => {
    const q = search.toLowerCase();
    const matchSearch = [e.name, e.social_name, e.sector, e.function, e.unit].join(' ').toLowerCase().includes(q);
    const matchSector = !sectorFilter || e.sector === sectorFilter;
    const matchFunc = !functionFilter || e.function === functionFilter;
    const matchStatus = statusFilter ? e.status === statusFilter : e.status !== 'inativo';
    return matchSearch && matchSector && matchFunc && matchStatus;
  }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' })), [employees, search, sectorFilter, functionFilter, statusFilter]);

  const onEdit = (e) => { setEditing(e); setFormOpen(true); };
  const onNew = () => { setEditing(null); setFormOpen(true); };

  const onDelete = async (e) => {
    if (!confirm(`Inativar o cadastro de ${e.name}? (exclusão lógica)`)) return;
    await base44.entities.Employee.update(e.id, { status: 'desligado' });
    await logAudit({ entity_type: 'Employee', entity_id: e.id, action: 'exclusao_logica', old_value: e.status, new_value: 'desligado', responsible_user: currentUserName() });
    load();
  };

  const selectCls = 'h-9 rounded-md border border-input bg-background px-3 text-sm';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Colaboradores</h1>
          <p className="text-sm text-slate-500">Cadastro único de colaboradores — base do RH, Ponto e Escalas</p>
        </div>
        <Button onClick={onNew} className="gap-2">
          <Plus className="w-4 h-4" /> Novo colaborador
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Buscar por nome, apelido..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os setores</option>
          {sectors.filter((s) => s.status === 'ativo').map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          {employees.filter((e) => e.sector && !sectors.some((s) => s.name === e.sector)).map((e) => <option key={e.sector} value={e.sector}>{e.sector}</option>)}
        </select>
        <select value={functionFilter} onChange={(e) => setFunctionFilter(e.target.value)} className={selectCls}>
          <option value="">Todas as funções</option>
          {functions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">Todos os status</option>
          {Object.entries(EMPLOYEE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum colaborador encontrado.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Colaborador</th>
                  <th className="text-left font-medium px-4 py-3">Função</th>
                  <th className="text-left font-medium px-4 py-3">Setor</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Horário</th>
                  <th className="text-left font-medium px-4 py-3 hidden md:table-cell">Entrada</th>
                  <th className="text-left font-medium px-4 py-3 hidden lg:table-cell">Telefone</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => {
                  const st = EMPLOYEE_STATUS[e.status] || EMPLOYEE_STATUS.inativo;
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate(`/funcionarios/${e.id}`)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                            {e.photo_url
                              ? <Image src={e.photo_url} alt="" className="w-full h-full" fittingType="fill" />
                              : <span className="text-sm font-medium text-slate-500">{(e.name || '?').charAt(0).toUpperCase()}</span>}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 truncate">{e.name}</p>
                            {e.social_name && <p className="text-xs text-slate-400 truncate">"{e.social_name}"</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{e.function || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{e.sector || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">
                        {e.default_start_time ? `${e.default_start_time}–${e.default_end_time || ''}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{e.admission_date ? tenure(e.admission_date) : '—'}</td>
                      <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">{e.phone || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${st.style}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                        <div className="inline-flex gap-1">
                          <button onClick={() => navigate(`/funcionarios/${e.id}`)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500" title="Ver ficha">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => onEdit(e)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500" title="Editar">
                            <Pencil className="w-4 h-4" />
                          </button>
                          {canSangria(e.name) && (
                            <button onClick={() => { setSangriaResp(e.name); setSangriaOpen(true); }} className="p-1.5 rounded-md hover:bg-amber-50 text-amber-600" title="Registrar sangria">
                              <Wallet className="w-4 h-4" />
                            </button>
                          )}
                          <button onClick={() => onDelete(e)} className="p-1.5 rounded-md hover:bg-rose-50 text-rose-500" title="Desligar">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EmployeeForm open={formOpen} onOpenChange={setFormOpen} employee={editing} onSaved={load} sectors={sectors} roles={roles} />
      <SangriaDialog open={sangriaOpen} presetResponsible={sangriaResp} onClose={() => setSangriaOpen(false)} onSaved={async () => {}} />
    </div>
  );
}