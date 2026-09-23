import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { todayISO, startOfWeek, addDays, formatBR, weekdayOf, WEEKDAY_LABELS } from '@/lib/timeUtils';
import { useAllSchedules, generateWeekFromStandard } from '@/lib/escalaData';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Plus, Copy, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import EscalaDiaria from '@/components/escala/EscalaDiaria';
import EscalaSemanal from '@/components/escala/EscalaSemanal';
import EscalaMensal from '@/components/escala/EscalaMensal';
import CoberturaSetor from '@/components/escala/CoberturaSetor';
import EscalaPadrao from '@/components/escala/EscalaPadrao';
import CriarEscala from '@/components/escala/CriarEscala';
import DuplicarEscala from '@/components/escala/DuplicarEscala';
import SubstituirFuncionario from '@/components/escala/SubstituirFuncionario';

const VIEWS = [
  { key: 'diaria', label: 'Diária' },
  { key: 'semanal', label: 'Semanal' },
  { key: 'mensal', label: 'Mensal' },
];
const TABS = [
  { key: 'escala', label: 'Escalas' },
  { key: 'cobertura', label: 'Cobertura' },
  { key: 'padrao', label: 'Escala padrão' },
];

export default function Escalas() {
  const [view, setView] = useState('diaria');
  const [tab, setTab] = useState('escala');
  const [date, setDate] = useState(todayISO());
  const [weekStart, setWeekStart] = useState(startOfWeek(todayISO()));
  const [coverage, setCoverage] = useState('{}');
  const [createOpen, setCreateOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [subst, setSubst] = useState(null);

  const { schedules, loading, reload } = useAllSchedules();

  useEffect(() => {
    base44.entities.SystemSettings.list('-created_date', 1).then((s) => {
      if (s[0]?.coverage_config) setCoverage(s[0].coverage_config);
    });
  }, []);

  const daySchedules = useMemo(() => schedules.filter((s) => s.date === date), [schedules, date]);
  const existingForDate = daySchedules;
  const existingForWeek = useMemo(
    () => schedules.filter((s) => {
      const ws = startOfWeek(date);
      return s.date >= ws && s.date <= addDays(ws, 6);
    }),
    [schedules, date]
  );

  const shiftView = (delta) => {
    if (view === 'diaria') setDate(addDays(date, delta));
    if (view === 'semanal') setWeekStart(addDays(weekStart, delta * 7));
  };

  const handleGenerate = async () => {
    const ws = startOfWeek(addDays(todayISO(), 7));
    const count = await generateWeekFromStandard(ws, existingForWeek, currentUserName());
    alert(`${count} escalas geradas a partir da escala padrão para a semana de ${formatBR(ws)}.`);
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Escalas</h1>
          <p className="text-sm text-slate-500">Organização da equipe por dia, setor, horário e função</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDupOpen(true)} className="gap-2"><Copy className="w-4 h-4" /> Duplicar semana</Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> Adicionar</Button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {VIEWS.map((v) => (
            <button key={v.key} onClick={() => setView(v.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === v.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {v.label}
            </button>
          ))}
        </div>

        {view !== 'mensal' && (
          <div className="flex items-center gap-2">
            <button onClick={() => shiftView(-1)} className="p-1.5 rounded-md hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
            {view === 'diaria' ? (
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" />
            ) : (
              <span className="text-sm font-medium text-slate-700">
                {WEEKDAY_LABELS[weekdayOf(weekStart)]} {formatBR(weekStart)} – {formatBR(addDays(weekStart, 6))}
              </span>
            )}
            <button onClick={() => shiftView(1)} className="p-1.5 rounded-md hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
            {view === 'diaria' && <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>Hoje</Button>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-amber-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-sm">Carregando...</div>
      ) : tab === 'cobertura' ? (
        <CoberturaSetor schedules={daySchedules} coverageConfig={coverage} />
      ) : tab === 'padrao' ? (
        <EscalaPadrao onGenerate={handleGenerate} />
      ) : view === 'diaria' ? (
        <EscalaDiaria schedules={daySchedules} onSubstitute={setSubst} onAdd={() => setCreateOpen(true)} />
      ) : view === 'semanal' ? (
        <EscalaSemanal weekStart={weekStart} schedules={schedules} />
      ) : (
        <EscalaMensal schedules={schedules} />
      )}

      <CriarEscala open={createOpen} onOpenChange={setCreateOpen} date={date} existingForDate={existingForDate} onSaved={reload} />
      <DuplicarEscala open={dupOpen} onOpenChange={setDupOpen} existingForDest={existingForWeek} onDone={reload} />
      <SubstituirFuncionario open={!!subst} onOpenChange={(o) => !o && setSubst(null)} schedule={subst} allSchedules={schedules} onDone={reload} />
    </div>
  );
}