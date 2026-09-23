import { isIncomplete } from '@/lib/pontoUtils';
import { AlertTriangle } from 'lucide-react';

export default function PontosIncompletos({ rows, onAdjust }) {
  const incomplete = rows
    .map((r) => {
      const rec = r.record || {
        entry_time: r.entry_time, lunch_start: r.lunch_start,
        lunch_end: r.lunch_end, exit_time: r.exit_time,
      };
      const issue = isIncomplete(rec);
      const escaladoSemRegistro = r.schedule && r.status === 'ausente';
      return { row: r, issue, escaladoSemRegistro };
    })
    .filter((x) => x.issue || x.escaladoSemRegistro);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-amber-700">
        <AlertTriangle className="w-4 h-4" />
        <p className="text-sm font-medium">Pontos incompletos — revisão administrativa</p>
      </div>

      {incomplete.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-6 text-sm text-center">
          Nenhum registro incompleto. Tudo certo!
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {incomplete.map(({ row, issue, escaladoSemRegistro }) => (
            <div key={row.employee_id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-slate-900">{row.employee_name}</p>
                <p className="text-xs text-amber-600">
                  {issue || 'Escalado sem registro de entrada'}
                </p>
              </div>
              <button
                onClick={() => onAdjust(row)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-800"
              >
                Corrigir
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}