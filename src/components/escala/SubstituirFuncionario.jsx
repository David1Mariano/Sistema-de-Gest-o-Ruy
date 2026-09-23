import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { detectConflict, updateSchedule } from '@/lib/escalaData';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { AlertTriangle } from 'lucide-react';

export default function SubstituirFuncionario({ open, onOpenChange, schedule, allSchedules, onDone }) {
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState('');
  const [conflict, setConflict] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    base44.entities.Employee.filter({ status: 'ativo' }, 'name', 500).then(setEmployees);
  }, []);

  useEffect(() => {
    if (!schedule) return;
    setSelected('');
    setConflict('');
  }, [schedule]);

  const check = (id) => {
    setSelected(id);
    if (!schedule) return;
    const emp = employees.find((e) => e.id === id);
    const candidate = { ...schedule, employee_id: id, employee_name: emp?.name };
    const others = allSchedules.filter((s) => s.id !== schedule.id);
    setConflict(detectConflict(candidate, others) || '');
  };

  const confirm = async () => {
    if (conflict || !selected) return;
    setSaving(true);
    try {
      const emp = employees.find((e) => e.id === selected);
      const before = { employee_id: schedule.employee_id, employee_name: schedule.employee_name };
      await updateSchedule(schedule.id, { substitute_id: schedule.employee_id, substitute_name: schedule.employee_name }, schedule, 'Substituição por ausência', currentUserName());
      await base44.entities.Schedule.update(schedule.id, { employee_id: emp.id, employee_name: emp.name });
      await logAudit({ entity_type: 'Schedule', entity_id: schedule.id, action: 'substituicao', old_value: before.employee_name, new_value: emp.name, responsible_user: currentUserName() });
      onDone?.();
      onOpenChange?.(false);
    } finally {
      setSaving(false);
    }
  };

  if (!schedule) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Substituir funcionário</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">Ausente: <b>{schedule.employee_name}</b></p>
          <div className="space-y-1.5">
            <Label>Substituto disponível</Label>
            <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={selected} onChange={(e) => check(e.target.value)}>
              <option value="">Selecione...</option>
              {employees.filter((e) => e.id !== schedule.employee_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          {conflict && (
            <div className="flex items-center gap-2 text-rose-600 text-sm bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {conflict}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={confirm} disabled={saving || !selected || !!conflict}>{saving ? 'Salvando...' : 'Confirmar substituição'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}