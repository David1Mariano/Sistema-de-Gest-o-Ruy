import StatCard from '@/components/shared/StatCard';
import { Users, UserCheck, UserX, Coffee, Clock4, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function PontoDashboard({ counts, escalados }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5">
        <p className="text-xs uppercase tracking-wider text-slate-400">Presença do dia</p>
        <p className="mt-1 text-lg font-medium">
          <span className="text-2xl font-semibold text-white">{escalados}</span> escalados
          <span className="mx-2 text-slate-500">|</span>
          <span className="text-2xl font-semibold text-emerald-400">{counts.presentes + counts.finalizado}</span> presentes
          <span className="mx-2 text-slate-500">|</span>
          <span className="text-2xl font-semibold text-rose-400">{counts.ausentes}</span> faltas
          <span className="mx-2 text-slate-500">|</span>
          <span className="text-2xl font-semibold text-amber-400">{counts.atrasados}</span> atrasos
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Escalados hoje" value={escalados} icon={Users} tone="slate" />
        <StatCard label="Presentes" value={counts.presentes} icon={UserCheck} tone="emerald" />
        <StatCard label="Atrasados" value={counts.atrasados} icon={Clock4} tone="amber" />
        <StatCard label="Ausentes" value={counts.ausentes} icon={UserX} tone="rose" />
        <StatCard label="Em intervalo" value={counts.intervalo} icon={Coffee} tone="sky" />
        <StatCard label="Jornada encerrada" value={counts.finalizado} icon={CheckCircle2} tone="emerald" />
        <StatCard label="De folga" value={counts.folga} icon={Users} tone="slate" />
        <StatCard label="Registros incompletos" value={counts.incompleto} icon={AlertTriangle} tone="amber" />
      </div>
    </div>
  );
}