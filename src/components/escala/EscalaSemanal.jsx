import { addDays, weekdayOf, WEEKDAY_LABELS, formatBR } from '@/lib/timeUtils';

const DAY_STYLE = {
  trabalho: 'text-emerald-700 bg-emerald-50',
  folga: 'text-slate-400 bg-slate-50',
  ferias: 'text-violet-700 bg-violet-50',
  afastamento: 'text-rose-600 bg-rose-50',
  compensacao: 'text-sky-700 bg-sky-50',
};

export default function EscalaSemanal({ weekStart, schedules }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekScheds = schedules.filter((s) => days.includes(s.date));
  const employees = [...new Map(weekScheds.map((s) => [s.employee_id, s.employee_name])).entries()];
  const byEmpDay = {};
  weekScheds.forEach((s) => {
    byEmpDay[`${s.employee_id}|${s.date}`] = s;
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full text-sm min-w-[820px]">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-3 sticky left-0 bg-slate-50">Funcionário</th>
            {days.map((d) => (
              <th key={d} className="text-left font-medium px-3 py-3">
                <div>{WEEKDAY_LABELS[weekdayOf(d)]}</div>
                <div className="text-slate-400 normal-case font-normal">{formatBR(d).slice(0, 5)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {employees.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Sem escalas nesta semana.</td></tr>
          )}
          {employees.map(([id, name]) => (
            <tr key={id} className="hover:bg-slate-50/60">
              <td className="px-4 py-2.5 font-medium text-slate-900 sticky left-0 bg-white">{name}</td>
              {days.map((d) => {
                const s = byEmpDay[`${id}|${d}`];
                return (
                  <td key={d} className="px-3 py-2.5">
                    {s ? (
                      <span className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${DAY_STYLE[s.day_type]}`}>
                        {s.day_type === 'trabalho' || s.day_type === 'compensacao'
                          ? `${s.start_time}–${s.end_time}`
                          : s.day_type}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}