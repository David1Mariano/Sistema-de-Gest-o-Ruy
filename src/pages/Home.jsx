import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { todayISO, formatBR, WEEKDAY_FULL } from '@/lib/timeUtils';
import { buildDayRows, summarizeRows, usePontoData } from '@/lib/pontoData';
import StatCard from '@/components/shared/StatCard';
import { Users, UserCheck, UserX, Clock4, Coffee, CalendarDays, ArrowRight } from 'lucide-react';

export default function Home() {
  const date = todayISO();
  const { schedules, records, loading } = usePontoData(date);
  const [tolerance, setTolerance] = useState(5);

  useEffect(() => {
    base44.entities.SystemSettings.list('-created_date', 1).then((s) => {
      if (s[0]?.tolerance_minutes != null) setTolerance(s[0].tolerance_minutes);
    });
  }, []);

  const rows = useMemo(() => buildDayRows(schedules, records, tolerance), [schedules, records, tolerance]);
  const counts = useMemo(() => summarizeRows(rows), [rows]);
  const escalados = rows.filter((r) => r.schedule).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{WEEKDAY_FULL[new Date(date + 'T00:00:00').getDay()]}, {formatBR(date)}</p>
        <h1 className="text-2xl font-semibold tracking-tight mt-0.5">Painel operacional</h1>
      </div>

      {/* Equipe de hoje */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" /> Equipe de hoje
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Resumo da jornada do dia</p>
          </div>
          <Link to="/escalas" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900 hover:text-amber-600">
            Ver escala completa <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label="Escalados" value={escalados} icon={Users} tone="slate" />
              <StatCard label="Presentes" value={counts.presentes + counts.finalizado} icon={UserCheck} tone="emerald" />
              <StatCard label="Faltas" value={counts.ausentes} icon={UserX} tone="rose" />
              <StatCard label="Atrasos" value={counts.atrasados} icon={Clock4} tone="amber" />
              <StatCard label="Folgas" value={counts.folga} icon={Coffee} tone="sky" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/ponto" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-slate-900 text-white hover:bg-slate-800">
                <Clock4 className="w-4 h-4" /> Ir para o Ponto
              </Link>
              <Link to="/escalas" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">
                <CalendarDays className="w-4 h-4" /> Ver escala completa
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Atalhos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Link to="/rh" className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 hover:shadow-sm transition-shadow">
          <Users className="w-6 h-6 text-amber-500 mb-2" />
          <p className="font-semibold text-slate-800">Recursos Humanos</p>
          <p className="text-xs text-slate-500 mt-0.5">Central de colaboradores</p>
        </Link>
        <Link to="/funcionarios" className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-sm transition-shadow">
          <Users className="w-6 h-6 text-slate-400 mb-2" />
          <p className="font-semibold text-slate-800">Colaboradores</p>
          <p className="text-xs text-slate-500 mt-0.5">Cadastro único de colaboradores</p>
        </Link>
        <Link to="/relatorios" className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-sm transition-shadow">
          <CalendarDays className="w-6 h-6 text-slate-400 mb-2" />
          <p className="font-semibold text-slate-800">Relatórios</p>
          <p className="text-xs text-slate-500 mt-0.5">Frequência e ocorrências</p>
        </Link>
        <Link to="/configuracoes" className="rounded-xl border border-slate-200 bg-white p-5 hover:shadow-sm transition-shadow">
          <Clock4 className="w-6 h-6 text-slate-400 mb-2" />
          <p className="font-semibold text-slate-800">Configurações</p>
          <p className="text-xs text-slate-500 mt-0.5">Tolerância e cobertura</p>
        </Link>
      </div>
    </div>
  );
}