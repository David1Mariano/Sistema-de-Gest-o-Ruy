import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const today = () => new Date().toISOString().slice(0, 10);
const blank = {
  date: today(),
  product_id: '',
  planned_quantity: 1,
  produced_quantity: 0,
  priority: 'normal',
  status: 'planejada',
  responsible: '',
  observation: '',
};
const cls = 'h-9 w-full rounded-md border bg-background px-3 text-sm';

export default function ProductionOrderDialog({ open, onClose, order, products, onSaved }) {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(order ? { ...blank, ...order } : { ...blank, date: today(), responsible: currentUserName() });
    setError('');
  }, [open, order]);

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (saving) return;
    const p = products.find((x) => x.id === form.product_id);
    if (!p || Number(form.planned_quantity) <= 0) {
      setError('Selecione o produto e informe a quantidade.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        product_name: p.name,
        unit: p.yield_unit,
        planned_quantity: Number(form.planned_quantity),
        produced_quantity: Number(form.produced_quantity || 0),
      };
      if (order) {
        await base44.entities.ProductionOrder.update(order.id, payload);
      } else {
        await base44.entities.ProductionOrder.create(payload);
      }
      onClose();
      await onSaved?.();
    } catch (e) {
      setError(e?.message || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{order ? 'Editar ordem' : 'Nova ordem de produção'}</DialogTitle>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field l="Data programada">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field l="Produto *">
            <select className={cls} value={form.product_id} onChange={(e) => set('product_id', e.target.value)}>
              <option value="">Selecione</option>
              {products.filter((x) => x.status !== 'inativo').map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
          <Field l="Quantidade planejada">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={form.planned_quantity}
              onChange={(e) => set('planned_quantity', e.target.value)}
            />
          </Field>
          <Field l="Prioridade">
            <select className={cls} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="baixa">Baixa</option>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </Field>
          <Field l="Status">
            <select className={cls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="planejada">Planejada</option>
              <option value="em_producao">Em produção</option>
              <option value="concluida">Concluída</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </Field>
          <Field l="Responsável">
            <Input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
          </Field>
        </div>
        <Field l="Observação">
          <Input value={form.observation} onChange={(e) => set('observation', e.target.value)} />
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar ordem'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ l, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{l}</Label>
      {children}
    </div>
  );
}