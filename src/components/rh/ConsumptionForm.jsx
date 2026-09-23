import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { nowTime } from '@/lib/timeUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const empty = { employee_id: '', employee_name: '', date: '', time: '', product: '', quantity: 1, amount: '', status: 'registrado' };

export default function ConsumptionForm({ open, onOpenChange, employees = [], onSaved, editing = null }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm(editing ? { ...empty, ...editing } : { ...empty, date: new Date().toISOString().slice(0, 10), time: nowTime() });
  }, [open, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pickEmployee = (id) => {
    const e = employees.find((x) => x.id === id);
    setForm((f) => ({ ...f, employee_id: id, employee_name: e?.name || '', sector: e?.sector || '' }));
  };
  const save = async () => {
    if (!form.employee_id || !form.product || !form.amount) return;
    setSaving(true);
    try {
      const payload = { ...form, quantity: Number(form.quantity) || 1, amount: Number(form.amount), registered_by: currentUserName() };
      let saved;
      if (editing?.id) saved = await base44.entities.Consumption.update(editing.id, payload);
      else saved = await base44.entities.Consumption.create(payload);
      await logAudit({ entity_type: 'Consumption', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: payload.product, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Editar consumo' : 'Novo consumo'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Funcionário *</Label>
            <select className={inputCls} value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">Selecione</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Data</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Horário</Label><Input type="time" value={form.time} onChange={(e) => set('time', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Produto *</Label><Input value={form.product} onChange={(e) => set('product', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Quantidade</Label><Input type="number" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Valor *</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="registrado">Registrado</option><option value="cobrado">Cobrado</option><option value="liberado">Liberado</option><option value="cancelado">Cancelado</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.employee_id || !form.product || !form.amount}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}