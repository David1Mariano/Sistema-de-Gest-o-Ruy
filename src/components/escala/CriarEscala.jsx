import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { createSchedule } from '@/lib/escalaData';
import { currentUserName } from '@/lib/useCurrentUser';
import { AlertTriangle } from 'lucide-react';

const DAY_TYPES = [
  { value: 'trabalho', label: 'Trabalho' },
  { value: 'folga', label: 'Folga' },
  { value: 'ferias', label: 'Férias' },
  { value: 'afastamento', label: 'Afastamento' },
  { value: 'compensacao', label: 'Compensação' },
];

export default function CriarEscala({ open, onOpenChange, date, existingForDate, onSaved }) {
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    employee_id: '', date: date || '', sector: '', function: '', unit: '',
    start_time: '', end_time: '', break_start: '', break_end: '',
    day_type: 'trabalho', observation: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    base44.entities.Employee.filter({ status: 'ativo' }, 'name', 500).then(setEmployees);
  }, []);

  useEffect(() => {
    setForm((f) => ({ ...f, date: date || '' }));
  }, [date]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onPickEmployee = (id) => {
    const emp = employees.find((e) => e.id === id);
    setForm((f) => ({ ...f, employee_id: id, sector: emp?.sector || f.sector, function: emp?.function || f.function, unit: emp?.unit || f.unit, employee_name: emp?.name }));
  };

  const save = async () => {
    if (!form.employee_id || !form.date) return;
    setSaving(true);
    setError('');
    try {
      const emp = employees.find((e) => e.id === form.employee_id);
      await createSchedule({ ...form, employee_name: emp.name }, existingForDate, currentUserName());
      onSaved?.();
      onOpenChange?.(false);
      setForm({ employee_id: '', date: date || '', sector: '', function: '', unit: '', start_time: '', end_time: '', break_start: '', break_end: '', day_type: 'trabalho', observation: '' });
    } catch (e) {
      setError(e.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar à escala</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2 space-y-1.5">
            <Label>Funcionário *</Label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.employee_id} onChange={(e) => onPickEmployee(e.target.value)}>
              <option value="">Selecione...</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Data *</Label>
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo do dia</Label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.day_type} onChange={(e) => set('day_type', e.target.value)}>
              {DAY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Setor</Label>
            <Input value={form.sector} onChange={(e) => set('sector', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Função</Label>
            <Input value={form.function} onChange={(e) => set('function', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Entrada</Label>
            <Input type="time" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Saída</Label>
            <Input type="time" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Início intervalo</Label>
            <Input type="time" value={form.break_start} onChange={(e) => set('break_start', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Fim intervalo</Label>
            <Input type="time" value={form.break_end} onChange={(e) => set('break_end', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Unidade</Label>
            <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Observação</Label>
            <Textarea rows={2} value={form.observation} onChange={(e) => set('observation', e.target.value)} />
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.employee_id || !form.date}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}