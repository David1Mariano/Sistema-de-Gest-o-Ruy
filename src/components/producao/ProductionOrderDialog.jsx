import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { usePersistentDraft } from '@/lib/usePersistentDraft';
import { hasDraftChanged } from '@/lib/draftStore';
import { DRAFT_CANCEL_CONFIRM, DRAFT_FORM_KEYS, draftEditKey } from '@/lib/draftConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DraftNotice from '@/components/shared/DraftNotice';
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

  // Rascunho apenas no CADASTRO da ordem (planejamento). A produção diária é
  // operação com baixa de estoque e não recebe rascunho: restaurar aquele
  // formulário poderia levar a pessoa a executar um lançamento sem perceber.
  const draft = usePersistentDraft({
    formKey: draftEditKey(DRAFT_FORM_KEYS.PRODUCAO_ORDEM_NOVO, order?.id),
    enabled: open,
    value: form,
    recordUpdatedAt: order?.updated_at,
  });

  useEffect(() => {
    if (!open) return;
    // O rascunho entra pelo mesmo reset que já existia, sem competir de ordem
    // de efeito com o hook.
    setForm(draft.restoreInto(order ? { ...blank, ...order } : { ...blank, date: today(), responsible: currentUserName() }));
    setError('');
  }, [open, order, draft.restoreInto]);

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
      // Backend confirmou: agora sim o rascunho sai. Se o `await` lançar, ele
      // continua lá — é a única cópia do planejamento digitado.
      draft.markSaved();
      onClose();
      await onSaved?.();
    } catch (e) {
      draft.markFailed();
      setError(e?.message || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    const base = order ? { ...blank, ...order } : { ...blank, date: today(), responsible: currentUserName() };
    if (hasDraftChanged(form, base) && window.confirm(DRAFT_CANCEL_CONFIRM)) draft.discard();
    else draft.keep();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && requestClose()}>
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
        <DraftNotice
          status={draft.status}
          message={draft.message}
          onDiscard={draft.discard}
          onDismiss={draft.dismissNotice} />
        <DialogFooter>
          <Button variant="outline" onClick={requestClose} disabled={saving}>Cancelar</Button>
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