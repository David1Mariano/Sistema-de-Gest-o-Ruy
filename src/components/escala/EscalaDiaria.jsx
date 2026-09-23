import { UserX, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DAY_TYPE_LABELS = {
  trabalho: 'Trabalho', folga: 'Folga', ferias: 'Férias',
  afastamento: 'Afastamento', compensacao: 'Compensação',
};

const DAY_TYPE_STYLE = {
  trabalho: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  folga: 'bg-slate-100 text-slate-500 border-slate-200',
  ferias: 'bg-violet-50 text-violet-700 border-violet-200',
  afastamento: 'bg-rose-50 text-rose-700 border-rose-200',
  compensacao: 'bg-sky-50 text-sky-700 border-sky-200',
};

export default function EscalaDiaria({ schedules, onSubstitute, onAdd }) {
  const bySector = {};
  schedules.forEach((s) => {
    const sec = s.sector || 'Sem setor';
    (bySector[sec] = bySector[sec] || []).push(s);
  });
  const sectors = Object.keys(bySector).sort();

  if (schedules.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-400 mb-3">Nenhuma escala para esta data.</p>
        <Button onClick={onAdd} className="gap-2"><Plus className="w-4 h-4" /> Adicionar funcionário</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sectors.map((sec) => (
        <div key={sec} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800">{sec}</h3>
            <span className="text-xs text-slate-500">{bySector[sec].length} colaborador(es)</span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Funcionário</th>
                <th className="text-left font-medium px-4 py-2.5">Horário</th>
                <th className="text-left font-medium px-4 py-2.5">Função</th>
                <th className="text-left font-medium px-4 py-2.5">Tipo</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                <th className="text-right font-medium px-4 py-2.5">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bySector[sec].map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {s.employee_name}
                    {s.substitute_name && <span className="block text-xs text-sky-600">Substituído por {s.substitute_name}</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {s.day_type === 'trabalho' || s.day_type === 'compensacao' ? `${s.start_time || '—'} – ${s.end_time || '—'}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.function || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${DAY_TYPE_STYLE[s.day_type]}`}>
                      {DAY_TYPE_LABELS[s.day_type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {s.absence_marked ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                        <UserX className="w-3.5 h-3.5" /> Funcionário ausente
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-600 font-medium">Confirmado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.absence_marked && !s.substitute_id && (
                      <button onClick={() => onSubstitute(s)} className="px-2 py-1 rounded-md text-xs bg-sky-50 text-sky-600 hover:bg-sky-100">
                        Substituir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}