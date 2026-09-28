import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Pencil, Users, Search, ArrowLeft, Building2, Target } from 'lucide-react';
import SectorForm from '@/components/rh/SectorForm';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import {
  employeesOfSector, employeeAdmissionLabel, employeeDisplayName, employeeStatusLabel,
  employeeStatusStyle, filterSectorEmployees, sectorEmployeeSummary, sectorFunctionSummary,
} from '@/lib/sectorUtils';

const STATUS_FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'ativos', label: 'Ativos' },
  { key: 'afastados', label: 'Afastados' },
  { key: 'desligados', label: 'Desligados' },
];

export default function Setores() {
  const navigate = useNavigate();
  const [sectors, setSectors] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // Setor aberto na visão detalhada. Guarda o ID, não o objeto: se o setor for
  // renomeado/alterado, o detalhe continua apontando para o registro certo.
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');

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

  // Tudo abaixo é DERIVADO. Nada é guardado: trocar o setor de um colaborador
  // ou salvar o setor reflete na tela sem nenhum passo de sincronização.
  const selected = useMemo(
    () => sectors.find((s) => s.id === selectedId) || null,
    [sectors, selectedId],
  );
  const setorColaboradores = useMemo(
    () => (selected ? employeesOfSector(employees, selected) : []),
    [employees, selected],
  );
  const contadores = useMemo(() => sectorEmployeeSummary(setorColaboradores), [setorColaboradores]);
  const funcoes = useMemo(() => sectorFunctionSummary(setorColaboradores), [setorColaboradores]);
  const visiveis = useMemo(
    () => filterSectorEmployees(setorColaboradores, { search, statusFilter }),
    [setorColaboradores, search, statusFilter],
  );

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

  if (selected) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" className="gap-2 -ml-2" onClick={() => { setSelectedId(null); setSearch(''); setStatusFilter('todos'); }}>
          <ArrowLeft className="w-4 h-4" /> Voltar para os setores
        </Button>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Setor</p>
            <h1 className="text-2xl font-semibold tracking-tight">{selected.name}</h1>
            <p className="text-sm text-slate-500">
              {contadores.total} colaborador(es) · {contadores.ativos} ativo(s) · {contadores.afastados} afastado(s) · {contadores.desligados} desligado(s)
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { setEditing(selected); setFormOpen(true); }}><Pencil className="w-4 h-4" /> Editar setor</Button>
            <Button variant="ghost" onClick={() => toggleStatus(selected)}>{selected.status === 'ativo' ? 'Desativar' : 'Ativar'}</Button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Building2 className="w-4 h-4 text-amber-600" /> Sobre o setor</h2>
            <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">{selected.description || 'Não informado'}</p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Target className="w-4 h-4 text-amber-600" /> Função na empresa</h2>
            {/* Setor antigo, cadastrado antes de `role_purpose` existir, cai aqui:
                mostramos "Não informado" em vez de inventar um texto. O campo
                continua editável em "Editar setor". */}
            <p className="mt-2 text-sm text-slate-600 whitespace-pre-line">
              {selected.role_purpose || 'Não informado'}
            </p>
          </section>
        </div>

        {funcoes.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Funções neste setor</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {funcoes.map((f) => (
                <li key={f.nome} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{f.nome} — {f.total}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">Colaboradores do setor</h2>
            <div className="flex flex-wrap gap-1">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} type="button" onClick={() => setStatusFilter(f.key)} aria-pressed={statusFilter === f.key}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${statusFilter === f.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, apelido ou função..." aria-label="Buscar colaborador no setor" />
          </div>

          {visiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              {setorColaboradores.length === 0
                ? 'Nenhum colaborador vinculado a este setor.'
                : 'Nenhum colaborador encontrado com os filtros atuais.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[620px]">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>{['Nome', 'Função', 'Status', 'Entrada'].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {visiveis.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <button type="button" title={e.name} onClick={() => navigate(`/funcionarios/${e.id}`)}
                          className="text-left font-medium text-slate-800 hover:underline">
                          {employeeDisplayName(e)}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{e.function || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${employeeStatusStyle(e.status)}`}>
                          {employeeStatusLabel(e.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{employeeAdmissionLabel(e.admission_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <SectorForm open={formOpen} onOpenChange={setFormOpen} editing={editing} onSaved={load} employees={employees} />
      </div>
    );
  }

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
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-amber-300 transition-colors">
              {/* O CARD INTEIRO é clicável e abre o detalhe do setor. Mantemos
                  os botões Editar/Desativar como ações separadas, para um
                  clique acidental não salvar nada. */}
              <button
                type="button"
                onClick={() => setSelectedId(s.id)}
                className="w-full text-left cursor-pointer"
                aria-label={`Ver detalhes do setor ${s.name}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{s.name}</p>
                    {s.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{s.description}</p>}
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${s.status === 'ativo' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {s.status === 'ativo' ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>Responsável: {s.responsible_name || '—'}</p>
                  <p>Colaboradores: {count}</p>
                </div>
                <p className="mt-3 text-xs font-medium text-amber-700">Ver detalhes do setor →</p>
              </button>
              <div className="flex gap-2 mt-2">
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