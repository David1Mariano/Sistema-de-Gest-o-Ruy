import { useState } from 'react';
import { MONTH_LABELS } from '@/lib/timeUtils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function EscalaMensal({ schedules }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

  const countFor = (date) => schedules.filter((s) => s.date === date && (s.day_type === 'trabalho' || s.day_type === 'compensacao')).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">{MONTH_LABELS[month]}/{year}</h3>
        <div className="flex gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1.5 rounded-md hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))} className="px-3 py-1 rounded-md text-xs bg-slate-100 hover:bg-slate-200">Hoje</button>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1.5 rounded-md hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-400 mb-1">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => (
            <div key={i} className={`min-h-[64px] rounded-lg border p-1.5 text-xs ${
              !date ? 'border-transparent' : 'border-slate-200 hover:bg-slate-50'
            }`}>
              {date && (
                <>
                  <div className="font-medium text-slate-600">{Number(date.slice(-2))}</div>
                  <div className="mt-1">
                    {countFor(date) > 0 ? (
                      <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">{countFor(date)} escalados</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}