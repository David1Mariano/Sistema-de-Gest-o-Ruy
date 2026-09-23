import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const empty = { date: '', period: '', score: '', notes: '', evaluator: '' };

export default function EvaluationForm({ open, onOpenChange, employee, onSaved, editing = null }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(editing ? { ...empty, ...editing } : { ...empty, date: new Date().toISOString().slice(0, 10) }); }, [open, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.date) return;
    setSaving(true);
    try {
      const payload = { employee_id: employee.id, employee_name: employee.name, ...form, score: Number(form.score) || null, evaluator: form.evaluator || currentUserName() };
      let saved;
      if (editing?.id) saved = await base44.entities.Evaluation.update(editing.id, payload);
      else saved = await base44.entities.Evaluation.create(payload);
      await logAudit({ entity_type: 'Evaluation', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: String(form.score), responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Editar avaliação' : 'Nova avaliação'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <div className="space-y-1"><Label className="text-xs">Data *</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Período</Label><Input value={form.period} onChange={(e) => set('period', e.target.value)} placeholder="Ex: Ago/2026" /></div>
          <div className="space-y-1"><Label className="text-xs">Nota</Label><Input type="number" step="0.1" value={form.score} onChange={(e) => set('score', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Avaliador</Label><Input value={form.evaluator} onChange={(e) => set('evaluator', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Anotações</Label><Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.date}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}