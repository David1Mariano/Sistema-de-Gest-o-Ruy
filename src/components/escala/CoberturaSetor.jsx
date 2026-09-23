import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function CoberturaSetor({ schedules, coverageConfig }) {
  let minimums = {};
  try { minimums = JSON.parse(coverageConfig || '{}'); } catch { minimums = {}; }

  const working = schedules.filter((s) => s.day_type === 'trabalho' || s.day_type === 'compensacao');
  const bySector = {};
  working.forEach((s) => {
    const sec = s.sector || 'Sem setor';
    bySector[sec] = (bySector[sec] || 0) + 1;
  });
  const sectors = [...new Set([...Object.keys(bySector), ...Object.keys(minimums)])].sort();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sectors.map((sec) => {
        const escalados = bySector[sec] || 0;
        const necessario = minimums[sec] || 0;
        const ok = !necessario || escalados >= necessario;
        const falta = necessario - escalados;
        return (
          <div key={sec} className={`rounded-xl border p-4 ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className="font-semibold text-slate-800">{sec}</p>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-600">Necessários: <b>{necessario || '—'}</b></span>
              <span className="text-slate-600">Escalados: <b>{escalados}</b></span>
            </div>
            <div className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
              {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {ok ? 'Cobertura completa' : `Falta ${falta} colaborador(es)`}
            </div>
          </div>
        );
      })}
      {sectors.length === 0 && (
        <div className="col-span-full text-center text-slate-400 text-sm py-6">Nenhuma escala para esta data.</div>
      )}
    </div>
  );
}