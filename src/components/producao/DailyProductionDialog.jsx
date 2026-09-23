import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';

const today = () => new Date().toISOString().slice(0, 10);
const cls = 'h-9 w-full rounded-md border bg-background px-3 text-sm';

// Motivos comuns de perda (digitáveis: o campo aceita texto livre via datalist).
const LOSS_REASONS = [
  'Produto queimado',
  'Produto danificado',
  'Produto vencido',
  'Produto fora do padrão',
  'Erro de produção',
  'Excesso de produção',
  'Queda/acidente',
  'Outro',
];

const blank = {
  date: today(),
  product_id: '',
  production_order_id: '',
  produced_quantity: 0,
  loss_quantity: 0,
  leftover_quantity: 0,
  responsible: '',
  observation: '',
  losses: /** @type {any[]} */ ([]),
};

const lossId = () => `loss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const newLoss = (date, responsible) => ({
  id: lossId(),
  date,
  quantity: '',
  unit: '',
  reason: '',
  responsible: responsible || '',
  observation: '',
});

const sumLosses = (losses) =>
  (losses || []).reduce((s, l) => s + (Number(l.quantity) > 0 ? Number(l.quantity) : 0), 0);

export default function DailyProductionDialog({ open, onClose, record, products, orders, onSaved, onReviewConsumption }) {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const base = record
      ? { ...blank, ...record }
      : { ...blank, date: today(), responsible: currentUserName() };
    base.losses = Array.isArray(record?.losses)
      ? record.losses.map((l) => ({ id: l.id || lossId(), ...l }))
      : [];
    setForm(base);
    setError('');
  }, [open, record]);

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const setLoss = (i, k, v) =>
    setForm((x) => ({ ...x, losses: x.losses.map((l, n) => (n === i ? { ...l, [k]: v } : l)) }));
  const addLoss = () =>
    setForm((x) => ({ ...x, losses: [...x.losses, newLoss(x.date, x.responsible)] }));
  const removeLoss = (i) => setForm((x) => ({ ...x, losses: x.losses.filter((_, n) => n !== i) }));

  const unit = (() => {
    const p = products.find((x) => x.id === form.product_id);
    return p?.yield_unit || record?.unit || '';
  })();
  const lossTotal = sumLosses(form.losses);
  const legacyLoss = form.losses.length ? 0 : Number(form.loss_quantity || 0);

  const orderChange = (id) => {
    const o = orders.find((x) => x.id === id);
    setForm((x) => ({
      ...x,
      production_order_id: id,
      product_id: o?.product_id || x.product_id,
      produced_quantity: o?.planned_quantity || x.produced_quantity,
    }));
  };

  const save = async () => {
    if (saving) return; // impede duplo clique
    setError('');

    if (!form.date) {
      setError('Informe a data da produção.');
      return;
    }
    const p = products.find((x) => x.id === form.product_id);
    if (!p) {
      setError('Selecione o produto produzido.');
      return;
    }
    if (!(Number(form.produced_quantity) > 0)) {
      setError('Informe a quantidade produzida maior que zero.');
      return;
    }
    const losses = form.losses.map((l) => ({
      ...l,
      quantity: Number(l.quantity),
      reason: String(l.reason || '').trim(),
      responsible: String(l.responsible || '').trim(),
      date: l.date || form.date,
      unit: String(l.unit || '').trim() || unit,
      observation: String(l.observation || '').trim(),
    }));
    for (const l of losses) {
      if (!(l.quantity > 0)) {
        setError('Cada perda deve ter quantidade maior que zero (ou remova a linha).');
        return;
      }
      if (!l.reason) {
        setError('Informe o motivo de todas as perdas (ou remova a linha).');
        return;
      }
      if (!l.responsible) {
        setError('Informe o responsável por todas as perdas (ou remova a linha).');
        return;
      }
    }

    const payload = {
      ...form,
      product_name: p.name,
      unit,
      produced_quantity: Number(form.produced_quantity),
      leftover_quantity: Number(form.leftover_quantity || 0),
      losses,
      // Compatibilidade: soma das perdas detalhadas; sem detalhamento,
      // preserva o valor antigo do registro (dados históricos).
      loss_quantity: losses.length ? lossTotal : Number(form.loss_quantity || 0),
    };

    setSaving(true);
    // 1) Registro diário (se falhar aqui, nada foi salvo → erro no diálogo).
    let savedRecord = null;
    try {
      if (record) {
        savedRecord = await base44.entities.DailyProduction.update(record.id, payload);
      } else {
        savedRecord = await base44.entities.DailyProduction.create(payload);
      }
    } catch (e) {
      setError(e?.message || 'Não foi possível salvar. Tente novamente.');
      setSaving(false);
      return;
    }

    // 2) Efeito colateral na ordem: só se existir ordem vinculada que ainda
    // não está concluída. Uma falha aqui NUNCA desfaz nem duplica o registro.
    let orderWarning = '';
    if (form.production_order_id) {
      const o = orders.find((x) => x.id === form.production_order_id);
      if (o && o.status !== 'concluida') {
        try {
          await base44.entities.ProductionOrder.update(o.id, {
            status: 'concluida',
            produced_quantity: Number(form.produced_quantity),
          });
        } catch (e) {
          orderWarning = e?.message || 'erro desconhecido';
        }
      }
    }

    setSaving(false);
    onClose();
    await onSaved?.();
    if (orderWarning) {
      toast({
        title: 'Produção registrada, mas a ordem não foi atualizada',
        description: `O registro diário foi salvo com sucesso. Falha ao atualizar a ordem: ${orderWarning}`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Produção registrada com sucesso.',
        description: 'Use a ação "Conferir consumo" na linha do registro para ver os insumos previstos.',
      });
    }
    // FASE 2A: abre a conferência de consumo do registro recém-salvo.
    // Não altera nada; apenas exibe o cálculo da ficha técnica.
    if (savedRecord) onReviewConsumption?.(savedRecord);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? 'Editar controle diário' : 'Registrar produção diária'}</DialogTitle>
        </DialogHeader>

        {/* SEÇÃO 1 — PRODUÇÃO */}
        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Produção</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field l="Data *">
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
            <Field l="Ordem de produção (opcional)">
              <select className={cls} value={form.production_order_id} onChange={(e) => orderChange(e.target.value)}>
                <option value="">Sem ordem vinculada</option>
                {orders.filter((x) => !['concluida', 'cancelada'].includes(x.status)).map((x) => (
                  <option key={x.id} value={x.id}>{x.date} — {x.product_name}</option>
                ))}
              </select>
            </Field>
            <Field l="Quantidade produzida *">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={form.produced_quantity}
                onChange={(e) => set('produced_quantity', e.target.value)}
              />
            </Field>
            <Field l="Sobras">
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.leftover_quantity}
                onChange={(e) => set('leftover_quantity', e.target.value)}
              />
            </Field>
            <Field l="Unidade">
              <Input value={unit} readOnly disabled placeholder="Vem do produto" />
            </Field>
            <div className="sm:col-span-2">
              <Field l="Responsável">
                <Input value={form.responsible} onChange={(e) => set('responsible', e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field l="Observação">
                <Input value={form.observation} onChange={(e) => set('observation', e.target.value)} />
              </Field>
            </div>
          </div>
        </section>

        {/* SEÇÃO 2 — PERDAS */}
        <section className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Perdas</p>
            <Button type="button" size="sm" variant="outline" onClick={addLoss}>
              <Plus className="w-4 h-4 mr-1" /> Adicionar perda
            </Button>
          </div>

          {legacyLoss > 0 && (
            <p className="text-xs text-muted-foreground">
              Registro anterior com {legacyLoss} {unit} de perda(s) sem detalhamento.
              Adicione perdas detalhadas para substituir esse valor.
            </p>
          )}

          {form.losses.map((l, i) => (
            <div key={l.id || i} className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Perda {i + 1}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  title="Remover perda"
                  onClick={() => removeLoss(i)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                <Field l="Quantidade *">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => setLoss(i, 'quantity', e.target.value)}
                  />
                </Field>
                <Field l="Unidade">
                  <Input
                    value={l.unit}
                    placeholder={unit || 'un'}
                    onChange={(e) => setLoss(i, 'unit', e.target.value)}
                  />
                </Field>
                <Field l="Motivo *">
                  <input
                    className={cls}
                    list="dp-loss-reasons"
                    value={l.reason}
                    placeholder="Ex.: Produto queimado"
                    onChange={(e) => setLoss(i, 'reason', e.target.value)}
                  />
                </Field>
                <Field l="Responsável *">
                  <Input
                    value={l.responsible}
                    onChange={(e) => setLoss(i, 'responsible', e.target.value)}
                  />
                </Field>
                <Field l="Data">
                  <Input
                    type="date"
                    value={l.date || form.date}
                    onChange={(e) => setLoss(i, 'date', e.target.value)}
                  />
                </Field>
                <Field l="Observação">
                  <Input
                    value={l.observation}
                    placeholder={l.reason === 'Outro' ? 'Descreva o motivo' : ''}
                    onChange={(e) => setLoss(i, 'observation', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}

          <datalist id="dp-loss-reasons">
            {LOSS_REASONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>

          {(form.losses.length > 0 || legacyLoss > 0) && (
            <p className="text-sm font-semibold text-destructive">
              Total de perdas: {form.losses.length ? lossTotal : legacyLoss} {unit}
            </p>
          )}
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Button>
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