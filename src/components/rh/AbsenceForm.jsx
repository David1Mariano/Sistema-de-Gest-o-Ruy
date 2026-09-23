import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ABSENCE_TYPES } from '@/lib/rhUtils';

const empty = { employee_id: '', employee_name: '', date: '', type: 'falta', expected_time: '', actual_time: '', minutes: 0, reason: '', observation: '', status: 'ativo' };

export default function AbsenceForm({ open, onOpenChange, employees = [], onSaved, editing = null, defaultEmployeeId = '' }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      const init = editing ? { ...empty, ...editing } : { ...empty, date: new Date().toISOString().slice(0, 10) };
      if (defaultEmployeeId && !editing) {
        const e = employees.find((x) => x.id === defaultEmployeeId);
        init.employee_id = defaultEmployeeId; init.employee_name = e?.name || ''; init.sector = e?.sector || '';
      }
      setForm(init);
    }
  }, [open, editing, defaultEmployeeId]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pickEmployee = (id) => {
    const e = employees.find((x) => x.id === id);
    setForm((f) => ({ ...f, employee_id: id, employee_name: e?.name || '', sector: e?.sector || '' }));
  };
  const save = async () => {
    if (!form.employee_id || !form.date) return;
    setSaving(true);
    try {
      const payload = { ...form, minutes: Number(form.minutes) || 0, responsible_user: form.responsible_user || currentUserName() };
      let saved;
      if (editing?.id) saved = await base44.entities.Absence.update(editing.id, payload);
      else saved = await base44.entities.Absence.create(payload);
      await logAudit({ entity_type: 'Absence', entity_id: saved.id, action: 'registro_falta', new_value: ABSENCE_TYPES[payload.type]?.label || payload.type, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Editar ocorrência' : 'Registrar ocorrência de frequência'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Funcionário *</Label>
            <select className={inputCls} value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)} disabled={!!defaultEmployeeId}>
              <option value="">Selecione</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Data *</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Tipo</Label>
            <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value)}>
              {Object.entries(ABSENCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Horário previsto</Label><Input type="time" value={form.expected_time || ''} onChange={(e) => set('expected_time', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Horário realizado</Label><Input type="time" value={form.actual_time || ''} onChange={(e) => set('actual_time', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Minutos</Label><Input type="number" value={form.minutes} onChange={(e) => set('minutes', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ativo">Ativo</option><option value="cancelado">Cancelado</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Motivo</Label><Input value={form.reason} onChange={(e) => set('reason', e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Observação</Label><Textarea rows={2} value={form.observation} onChange={(e) => set('observation', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.employee_id || !form.date}>{saving ? 'Salvando...' : 'Registrar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}