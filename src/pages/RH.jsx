import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { todayISO, formatBR } from '@/lib/timeUtils';
import { EMPLOYEE_STATUS, rangeFor, inRange, brl } from '@/lib/rhUtils';
import StatCard from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Users, UserCheck, CalendarOff, FileX2, Clock, UserX, Wallet, AlertTriangle, UserPlus, AlertCircle, ArrowRight,
} from 'lucide-react';

export default function RH() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [vales, setVales] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState('hoje');
  const [custom, setCustom] = useState({ start: todayISO(), end: todayISO() });
  const [sectorFilter, setSectorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const today = todayISO();

  const load = async () => {
    setLoading(true);
    try {
      const [emp, sch, abs, val, war, docs] = await Promise.all([
        base44.entities.Employee.list('-created_date', 500),
        base44.entities.Schedule.filter({ date: today }, '-created_date', 500),
        base44.entities.Absence.list('-created_date', 500),
        base44.entities.Vale.list('-created_date', 500),
        base44.entities.Warning.list('-created_date', 500),
        base44.entities.EmployeeDocument.list('-created_date', 500),
      ]);
      setEmployees(emp); setSchedules(sch); setAbsences(abs); setVales(val); setWarnings(war); setDocuments(docs);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [today]);

  const range = useMemo(() => rangeFor(period, custom), [period, custom]);

  const filteredEmp = useMemo(() => employees.filter((e) =>
    (!sectorFilter || e.sector === sectorFilter) && (!statusFilter || e.status === statusFilter)
  ), [employees, sectorFilter, statusFilter]);

  const stats = useMemo(() => {
    const active = filteredEmp.filter((e) => ['ativo', 'em_experiencia'].includes(e.status));
    const workingToday = schedules.filter((s) => s.day_type === 'trabalho' && s.status === 'ativo' && filteredEmp.some((e) => e.id === s.employee_id)).length;
    const offToday = schedules.filter((s) => s.day_type === 'folga' && filteredEmp.some((e) => e.id === s.employee_id)).length;
    const absToday = absences.filter((a) => a.date === today && ['falta', 'nao_justificada'].includes(a.type) && a.status === 'ativo' && filteredEmp.some((e) => e.id === a.employee_id)).length;
    const lateToday = absences.filter((a) => a.date === today && a.type === 'atraso' && a.status === 'ativo' && filteredEmp.some((e) => e.id === a.employee_id)).length;
    const away = filteredEmp.filter((e) => e.status === 'afastado').length;
    const valesPending = vales.filter((v) => v.status === 'pendente' && filteredEmp.some((e) => e.id === v.employee_id)).length;
    const [y, m] = today.split('-');
    const warnMonth = warnings.filter((w) => w.date?.startsWith(`${y}-${m}`) && filteredEmp.some((e) => e.id === w.employee_id)).length;
    const newMonth = filteredEmp.filter((e) => e.created_date?.startsWith(`${y}-${m}`)).length;
    return { total: filteredEmp.length, active: active.length, workingToday, offToday, absToday, lateToday, away, valesPending, warnMonth, newMonth };
  }, [filteredEmp, schedules, absences, vales, warnings, today]);

  // Atenção do RH
  const attention = useMemo(() => {
    const items = [];
    filteredEmp.forEach((e) => {
      const hasScheduleToday = schedules.some((s) => s.employee_id === e.id && s.date === today && s.status === 'ativo');
      if (['ativo', 'em_experiencia'].includes(e.status) && !hasScheduleToday && !['folga', 'ferias', 'afastado'].includes(e.status)) {
        items.push({ type: 'Sem horário cadastrado', employee: e, severity: 'amber' });
      }
      if (!e.sector) items.push({ type: 'Sem setor definido', employee: e, severity: 'amber' });
      if (!e.function) items.push({ type: 'Função não definida', employee: e, severity: 'amber' });
      // experiência próxima do fim (7 dias)
      if (e.experience_end) {
        const days = Math.ceil((new Date(e.experience_end + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
        if (days >= 0 && days <= 7) items.push({ type: `Experiência termina em ${days}d`, employee: e, severity: 'amber' });
      }
      // atraso recorrente (3+ no período)
      const lateCount = absences.filter((a) => a.employee_id === e.id && a.type === 'atraso' && a.status === 'ativo' && inRange(a.date, range)).length;
      if (lateCount >= 3) items.push({ type: `Atraso recorrente (${lateCount}x)`, employee: e, severity: 'rose' });
      // vale pendente
      if (vales.some((v) => v.employee_id === e.id && v.status === 'pendente')) items.push({ type: 'Vale pendente', employee: e, severity: 'amber' });
      // advertência pendente
      if (warnings.some((w) => w.employee_id === e.id && w.status === 'pendente')) items.push({ type: 'Advertência pendente', employee: e, severity: 'rose' });
      // documento faltando (sem nenhum documento cadastrado)
      if (!documents.some((d) => d.employee_id === e.id)) items.push({ type: 'Documento faltando', employee: e, severity: 'amber' });
    });
    // faltas do período
    absences.filter((a) => ['falta', 'nao_justificada'].includes(a.type) && a.status === 'ativo' && inRange(a.date, range)).forEach((a) => {
      const e = employees.find((x) => x.id === a.employee_id);
      if (e) items.push({ type: 'Falta registrada', employee: e, severity: 'rose', date: a.date });
    });
    return items;
  }, [filteredEmp, schedules, absences, vales, warnings, documents, range, employees, today]);

  const sectors = useMemo(() => [...new Set(employees.map((e) => e.sector).filter(Boolean))], [employees]);

  const periodOpts = [
    { k: 'hoje', label: 'Hoje' }, { k: 'semana', label: 'Esta semana' }, { k: 'mes', label: 'Este mês' }, { k: 'personalizado', label: 'Personalizado' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recursos Humanos</h1>
          <p className="text-sm text-slate-500">Central de gestão de colaboradores — RUY GESTÃO</p>
        </div>
        <Button onClick={() => navigate('/funcionarios')} className="gap-2">
          <Users className="w-4 h-4" /> Colaboradores
        </Button>
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {periodOpts.map((p) => (
            <button key={p.k} onClick={() => setPeriod(p.k)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${period === p.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {period === 'personalizado' && (
          <div className="flex items-center gap-1">
            <Input type="date" value={custom.start} onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))} className="h-8 w-auto text-xs" />
            <span className="text-slate-400 text-xs">até</span>
            <Input type="date" value={custom.end} onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))} className="h-8 w-auto text-xs" />
          </div>
        )}
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          <option value="">Todos os setores</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
          <option value="">Todos os status</option>
          {Object.entries(EMPLOYEE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-sm">Carregando indicadores...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard label="Colaboradores ativos" value={stats.active} icon={Users} tone="emerald" />
            <StatCard label="Trabalhando hoje" value={stats.workingToday} icon={UserCheck} tone="sky" />
            <StatCard label="De folga hoje" value={stats.offToday} icon={CalendarOff} tone="slate" />
            <StatCard label="Faltas hoje" value={stats.absToday} icon={FileX2} tone="rose" />
            <StatCard label="Atrasos hoje" value={stats.lateToday} icon={Clock} tone="amber" />
            <StatCard label="Afastados" value={stats.away} icon={UserX} tone="amber" />
            <StatCard label="Vales pendentes" value={stats.valesPending} icon={Wallet} tone="amber" hint={brl(vales.filter((v) => v.status === 'pendente').reduce((s, v) => s + (v.amount || 0), 0))} />
            <StatCard label="Advertências no mês" value={stats.warnMonth} icon={AlertTriangle} tone="rose" />
            <StatCard label="Novos no mês" value={stats.newMonth} icon={UserPlus} tone="violet" />
            <StatCard label="Total cadastrados" value={stats.total} icon={Users} tone="slate" />
          </div>

          {/* Atenção do RH */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <h2 className="font-semibold text-slate-800">Atenção do RH</h2>
              <span className="text-xs text-slate-500">({attention.length} ocorrências)</span>
            </div>
            {attention.length === 0 ? (
              <p className="text-sm text-slate-500 py-2">Nenhuma situação pendente. Tudo em dia! ✅</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {attention.slice(0, 50).map((a, i) => (
                  <button key={i} onClick={() => navigate(`/funcionarios/${a.employee.id}`)}
                    className="w-full flex items-center justify-between gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2 hover:border-amber-300 text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${a.severity === 'rose' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                      <span className="text-sm font-medium text-slate-800 truncate">{a.employee.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${a.severity === 'rose' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                        {a.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.date && <span className="text-xs text-slate-400">{formatBR(a.date)}</span>}
                      <ArrowRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Atalhos */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { to: '/setores', label: 'Setores', icon: Users },
              { to: '/funcoes', label: 'Funções', icon: UserCheck },
              { to: '/ocorrencias', label: 'Ocorrências', icon: FileX2 },
              { to: '/vales', label: 'Vales', icon: Wallet },
              { to: '/consumo', label: 'Consumo', icon: Clock },
              { to: '/advertencias', label: 'Advertências', icon: AlertTriangle },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.to} onClick={() => navigate(s.to)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-amber-300 hover:bg-amber-50/40 transition-colors text-left">
                  <Icon className="w-5 h-5 text-amber-500" />
                  <span className="text-sm font-medium text-slate-700">{s.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}