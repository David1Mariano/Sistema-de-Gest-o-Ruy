import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useStandardSchedules, saveStandardSchedule } from '@/lib/escalaData';
import { WEEKDAY_FULL } from '@/lib/timeUtils';
import { Save } from 'lucide-react';

const DAY_TYPES = [
  { value: 'trabalho', label: 'Trabalho' },
  { value: 'folga', label: 'Folga' },
  { value: 'ferias', label: 'Férias' },
  { value: 'afastamento', label: 'Afastamento' },
  { value: 'compensacao', label: 'Compensação' },
];

export default function EscalaPadrao({ onGenerate }) {
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState('');
  const { list, reload } = useStandardSchedules();
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Employee.filter({ status: 'ativo' }, 'name', 500).then(setEmployees);
  }, []);

  useEffect(() => {
    if (!selected) { setRows([]); return; }
    const empRows = list.filter((s) => s.employee_id === selected);
    const built = Array.from({ length: 7 }, (_, wd) => {
      const existing = empRows.find((r) => r.weekday === wd);
      return {
        weekday: wd,
        start_time: existing?.start_time || '',
        end_time: existing?.end_time || '',
        break_start: existing?.break_start || '',
        break_end: existing?.break_end || '',
        day_type: existing?.day_type || (wd === 0 ? 'folga' : 'trabalho'),
      };
    });
    setRows(built);
  }, [selected, list]);

  const setRow = (wd, k, v) => setRows((rs) => rs.map((r) => r.weekday === wd ? { ...r, [k]: v } : r));

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const emp = employees.find((e) => e.id === selected);
      for (const r of rows) {
        await saveStandardSchedule(emp, r.weekday, {
          start_time: r.start_time, end_time: r.end_time,
          break_start: r.break_start, break_end: r.break_end, day_type: r.day_type,
        });
      }
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escala padrão por colaborador</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-sm">
            <Label>Funcionário</Label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Selecione...</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {selected && (
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r.weekday} className="grid grid-cols-12 gap-2 items-center px-3 py-2">
                  <div className="col-span-2 text-sm font-medium text-slate-700">{WEEKDAY_FULL[r.weekday]}</div>
                  <select className="col-span-2 h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" value={r.day_type} onChange={(e) => setRow(r.weekday, 'day_type', e.target.value)}>
                    {DAY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <Input type="time" className="col-span-2 h-8 text-xs" value={r.start_time} onChange={(e) => setRow(r.weekday, 'start_time', e.target.value)} disabled={r.day_type !== 'trabalho' && r.day_type !== 'compensacao'} />
                  <Input type="time" className="col-span-2 h-8 text-xs" value={r.end_time} onChange={(e) => setRow(r.weekday, 'end_time', e.target.value)} disabled={r.day_type !== 'trabalho' && r.day_type !== 'compensacao'} />
                  <Input type="time" className="col-span-2 h-8 text-xs" value={r.break_start} onChange={(e) => setRow(r.weekday, 'break_start', e.target.value)} disabled={r.day_type !== 'trabalho' && r.day_type !== 'compensacao'} />
                  <Input type="time" className="col-span-2 h-8 text-xs" value={r.break_end} onChange={(e) => setRow(r.weekday, 'break_end', e.target.value)} disabled={r.day_type !== 'trabalho' && r.day_type !== 'compensacao'} />
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving} className="gap-2"><Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar escala padrão'}</Button>
              <Button variant="outline" onClick={onGenerate}>Gerar próxima semana</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}