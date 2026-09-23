import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { WARNING_CATEGORIES } from '@/lib/rhUtils';

const empty = { employee_id: '', employee_name: '', date: '', category: 'outros', description: '', status: 'pendente', observation: '', attachment_url: '' };

export default function WarningForm({ open, onOpenChange, employees = [], onSaved, editing = null }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(editing ? { ...empty, ...editing } : { ...empty, date: new Date().toISOString().slice(0, 10) }); }, [open, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pickEmployee = (id) => {
    const e = employees.find((x) => x.id === id);
    setForm((f) => ({ ...f, employee_id: id, employee_name: e?.name || '', sector: e?.sector || '' }));
  };
  const save = async () => {
    if (!form.employee_id || !form.date) return;
    setSaving(true);
    try {
      const payload = { ...form, responsible_user: form.responsible_user || currentUserName() };
      let saved;
      if (editing?.id) saved = await base44.entities.Warning.update(editing.id, payload);
      else saved = await base44.entities.Warning.create(payload);
      await logAudit({ entity_type: 'Warning', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: WARNING_CATEGORIES[payload.category], responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Editar ocorrência' : 'Nova ocorrência disciplinar'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Funcionário *</Label>
            <select className={inputCls} value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">Selecione</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Data *</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Categoria</Label>
            <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {Object.entries(WARNING_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="pendente">Pendente</option><option value="tratada">Tratada</option><option value="cancelada">Cancelada</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Descrição</Label><Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
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