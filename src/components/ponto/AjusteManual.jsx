import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { adjustRecord } from '@/lib/pontoActions';
import { currentUserName } from '@/lib/useCurrentUser';
import { computeMetrics, deriveStatus, logAudit } from '@/lib/pontoUtils';

const FIELDS = [
  { key: 'entry_time', label: 'Entrada' },
  { key: 'lunch_start', label: 'Saída para almoço' },
  { key: 'lunch_end', label: 'Retorno do almoço' },
  { key: 'exit_time', label: 'Saída final' },
];

export default function AjusteManual({ open, onOpenChange, row, tolerance, onDone }) {
  const [record, setRecord] = useState(null);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && row) {
      const rec = row.record || {
        id: null, employee_id: row.employee_id, employee_name: row.employee_name,
        date: row.schedule?.date, entry_time: row.entry_time, lunch_start: row.lunch_start,
        lunch_end: row.lunch_end, exit_time: row.exit_time, schedule_id: row.schedule?.id,
      };
      setRecord(rec);
      setValues({
        entry_time: rec.entry_time || '', lunch_start: rec.lunch_start || '',
        lunch_end: rec.lunch_end || '', exit_time: rec.exit_time || '',
      });
      setReason(''); setObservation('');
    }
  }, [open, row]);

  const save = async () => {
    setSaving(true);
    try {
      let rec = record;
      if (!rec.id) {
        const { base44 } = await import('@/api/base44Client');
        const sched = row.schedule || null;
        const payload = {
          employee_id: row.employee_id, employee_name: row.employee_name,
          date: sched?.date || row.date || '', sector: row.sector || '', unit: row.unit || '',
          entry_time: values.entry_time, lunch_start: values.lunch_start,
          lunch_end: values.lunch_end, exit_time: values.exit_time,
          schedule_id: sched?.id || '', origin: 'ajuste_admin', responsible_user: currentUserName(),
          expected_start: sched?.start_time || '', expected_end: sched?.end_time || '',
          observation: observation || '',
        };
        const m = computeMetrics(payload, sched, tolerance);
        Object.assign(payload, {
          late_minutes: m.late_minutes, early_exit_minutes: m.early_exit_minutes,
          worked_minutes: m.worked_minutes, expected_minutes: m.expected_minutes,
          break_minutes: m.break_minutes, status: deriveStatus(payload, sched, tolerance),
        });
        rec = await base44.entities.TimeRecord.create(payload);
        await logAudit({ entity_type: 'TimeRecord', entity_id: rec.id, action: 'criacao', field: 'ponto_manual', new_value: `${values.entry_time || ''}/${values.exit_time || ''}`, reason, responsible_user: currentUserName() });
      } else {
        for (const f of FIELDS) {
          if (values[f.key] !== (rec[f.key] || '')) {
            rec = await adjustRecord(rec, f.key, values[f.key], { reason, observation, tolerance, responsible: currentUserName() });
          }
        }
      }
      onDone?.();
      onOpenChange?.(false);
    } finally {
      setSaving(false);
    }
  };

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar ponto — {row.employee_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input type="time" value={values[f.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Motivo da alteração</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: erro de registro (opcional)" />
          </div>
          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">O valor anterior e o novo serão mantidos no histórico de auditoria.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar ponto'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}