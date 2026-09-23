import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Pencil } from 'lucide-react';
import { STATUS_LABELS, STATUS_STYLES } from '@/lib/pontoUtils';
import { minutesToTime } from '@/lib/timeUtils';

export default function PontoDia({ rows, onMarkAbsence, onAdjust }) {
  const [search, setSearch] = useState('');
  const filtered = rows.filter((r) =>
    `${r.employee_name} ${r.sector}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" placeholder="Buscar funcionário..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-3">Funcionário</th>
              <th className="text-left font-medium px-4 py-3">Setor</th>
              <th className="text-left font-medium px-4 py-3">Entrada</th>
              <th className="text-left font-medium px-4 py-3">Almoço</th>
              <th className="text-left font-medium px-4 py-3">Retorno</th>
              <th className="text-left font-medium px-4 py-3">Saída</th>
              <th className="text-left font-medium px-4 py-3">Atraso</th>
              <th className="text-left font-medium px-4 py-3">Status</th>
              <th className="text-right font-medium px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Nenhum registro para esta data.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.employee_id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-900">{r.employee_name}</td>
                <td className="px-4 py-3 text-slate-600">{r.sector || '—'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{r.entry_time || '—'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{r.lunch_start || '—'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{r.lunch_end || '—'}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700">{r.exit_time || '—'}</td>
                <td className="px-4 py-3 tabular-nums">
                  {r.metrics.late_minutes > 0 ? (
                    <span className="text-amber-600 font-medium">{minutesToTime(r.metrics.late_minutes)}</span>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap gap-1 justify-end items-center">
                    {r.status === 'ausente' && (
                      <>
                        <button onClick={() => onMarkAbsence(r, 'falta')} className="px-2 py-1 rounded-md text-xs bg-rose-50 text-rose-600 hover:bg-rose-100">Falta</button>
                        <button onClick={() => onMarkAbsence(r, 'falta_justificada')} className="px-2 py-1 rounded-md text-xs bg-amber-50 text-amber-600 hover:bg-amber-100">Justificada</button>
                        <button onClick={() => onMarkAbsence(r, 'folga')} className="px-2 py-1 rounded-md text-xs bg-slate-100 text-slate-600 hover:bg-slate-200">Folga</button>
                      </>
                    )}
                    <button onClick={() => onAdjust(r)} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200" title="Editar ponto">
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}