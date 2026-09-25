import { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import NumberInput from '@/components/shared/NumberInput';
import {
  MOVEMENT_LABELS,
  MOVEMENT_TYPES,
  UNITS,
  createInventoryItem,
  movementTypeLabel,
  registerMovement,
  reverseMovement,
  roundMoney,
  roundQty,
  signedQuantity,
  stockDirection,
  todayISO,
  updateInventoryItem,
  validateMovement,
} from '@/lib/stockService';
import { Plus, Boxes, AlertTriangle, History, ArrowDownToLine, ArrowUpFromLine, Pencil, Undo2 } from 'lucide-react';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const qtyFmt = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const emptyItem = {
  name: '', sku: '', category: '', unit: 'un', current_stock: 0, minimum_stock: 0,
  average_cost: 0, last_cost: 0, preferred_supplier_id: '', location: '', status: 'ativo', observation: '',
};

export default function Estoque() {
  const [items, setItems] = useState([]);
  const [moves, setMoves] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemDialog, setItemDialog] = useState(null); // null | 'new' | item
  const [moving, setMoving] = useState(null);        // { item, type }
  const [adjusting, setAdjusting] = useState(null);  // item
  const [reversing, setReversing] = useState(null);  // movimentação
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  // Carrega itens, movimentações e fornecedores. O erro é tratado e mostrado:
  // antes, um .catch(()=>[]) transformava falha de rede/RLS em "Nenhum item
  // cadastrado", parecendo banco vazio.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError('');
    const run = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
    const [i, m, s] = await Promise.all([
      run(base44.entities.InventoryItem.list('name', 500)),
      run(base44.entities.StockMovement.list('-created_date', 2000)),
      run(base44.entities.Supplier.list('name', 500)),
    ]);
    const failed = [
      ['itens', i], ['movimentações', m], ['fornecedores', s],
    ].filter(([, r]) => !r.ok)
      .map(([n, r]) => n + ': ' + (r.e?.message || 'erro desconhecido'));

    if (!i.ok && !m.ok) {
      setItems([]);
      setMoves([]);
      setLoadError('Não foi possível carregar o estoque. ' + failed.join(' · '));
    } else {
      if (i.ok) setItems(i.v);
      if (m.ok) setMoves(m.v);
      if (failed.length) setLoadError('Falha parcial ao carregar — ' + failed.join(' · '));
    }
    if (s.ok) setSuppliers(s.v);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reflete mudanças feitas em outra aba/máquina sem exigir F5.
  useEffect(() => {
    const uns = ['InventoryItem', 'StockMovement', 'Supplier'].map((n) => {
      try { return base44.entities[n]?.subscribe?.(() => load({ silent: true })); }
      catch { return undefined; }
    });
    return () => uns.forEach((u) => { try { u?.(); } catch { /* noop */ } });
  }, [load]);

  const visible = useMemo(
    () => (showInactive ? items : items.filter((x) => x.status !== 'inativo')),
    [items, showInactive]
  );
  const active = useMemo(() => visible.filter((x) => x.status === 'ativo'), [visible]);
  const low = useMemo(
    () => active.filter((x) => Number(x.current_stock || 0) <= Number(x.minimum_stock || 0)),
    [active]
  );
  const value = useMemo(
    () => active.reduce((s, x) => s + Number(x.current_stock || 0) * Number(x.average_cost || 0), 0),
    [active]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return active;
    return active.filter((x) => (x.name + ' ' + (x.category || '') + ' ' + (x.sku || '')).toLowerCase().includes(q));
  }, [active, search]);
  const recentMoves = useMemo(() => moves.slice(0, 200), [moves]);

  const reload = () => load({ silent: true });


  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Estoque</h1>
          <p className="text-sm text-slate-500">Saldos, custos, estoque mínimo e movimentações</p>
        </div>
        <Button onClick={() => setItemDialog('new')} className="gap-2">
          <Plus className="w-4 h-4" /> Novo item
        </Button>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Falha ao acessar o banco</p>
          <p className="mt-1">{loadError}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => load()}>Tentar novamente</Button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Itens ativos" value={active.length} icon={Boxes} />
        <Stat label="Abaixo do mínimo" value={low.length} icon={AlertTriangle} danger={low.length > 0} />
        <Stat label="Valor estimado em estoque" value={brl(value)} icon={Boxes} />
        <Stat label="Movimentos registrados" value={moves.length} icon={History} />
      </div>

      {low.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">Atenção ao estoque</p>
          <p className="text-sm text-amber-800 mt-1">{low.length} item(ns) estão no estoque mínimo ou abaixo dele.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Buscar item..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inativos
        </label>
        {loading && <span className="text-sm text-slate-400">Carregando...</span>}
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {['Item', 'Categoria', 'Unidade', 'Estoque atual', 'Mínimo', 'Custo médio', 'Último custo', 'Fornecedor', 'Situação', 'Ação'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length ? filtered.map((x) => {
                const lowItem = Number(x.current_stock || 0) <= Number(x.minimum_stock || 0);
                const inactive = x.status !== 'ativo';
                return (
                  <tr key={x.id} className={inactive ? 'opacity-60' : ''}>
                    <td className="px-4 py-3 font-medium">{x.name}</td>
                    <td className="px-4 py-3">{x.category || '—'}</td>
                    <td className="px-4 py-3">{x.unit}</td>
                    <td className="px-4 py-3 font-semibold">{qtyFmt(x.current_stock)}</td>
                    <td className="px-4 py-3">{qtyFmt(x.minimum_stock)}</td>
                    <td className="px-4 py-3">{brl(x.average_cost)}</td>
                    <td className="px-4 py-3">{brl(x.last_cost)}</td>
                    <td className="px-4 py-3">{x.preferred_supplier_name || '—'}</td>
                    <td className="px-4 py-3">
                      {inactive ? <span className="text-slate-400">Inativo</span>
                        : lowItem ? <span className="text-amber-700">Repor estoque</span>
                        : <span className="text-emerald-700">Normal</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" title="Registrar entrada"
                          onClick={() => setMoving({ item: x, type: MOVEMENT_TYPES.ENTRADA_MANUAL })}>
                          <ArrowDownToLine className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="outline" title="Registrar saída"
                          onClick={() => setMoving({ item: x, type: MOVEMENT_TYPES.SAIDA_MANUAL })}>
                          <ArrowUpFromLine className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setAdjusting(x)}>Ajustar</Button>
                        <Button size="icon" variant="ghost" title="Editar cadastro"
                          onClick={() => setItemDialog(x)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={10} className="p-10 text-center text-slate-400">Nenhum item cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>


      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="p-4 border-b"><h3 className="font-semibold">Movimentações recentes</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>{['Data', 'Item', 'Movimento', 'Quantidade', 'Custo', 'Saldo antes', 'Saldo após', 'Responsável', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y">
              {recentMoves.length ? recentMoves.map((m) => {
                const signed = signedQuantity(m);
                const reversed = Boolean(m.reversed_by_movement_id);
                return (
                  <tr key={m.id} className={reversed ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">{fmt(m.date)}</td>
                    <td className="px-4 py-3 font-medium">{m.item_name || '—'}</td>
                    <td className="px-4 py-3">
                      {movementTypeLabel(m.movement_type)}
                      {reversed && <span className="ml-2 text-xs text-slate-500">(estornada)</span>}
                    </td>
                    <td className={'px-4 py-3 font-medium ' + (signed < 0 ? 'text-rose-600' : 'text-emerald-700')}>
                      {signed > 0 ? '+' : ''}{qtyFmt(signed)} {m.unit}
                    </td>
                    <td className="px-4 py-3">{brl(m.total_cost)}</td>
                    <td className="px-4 py-3 text-slate-500">{m.balance_before ?? '—'}</td>
                    <td className="px-4 py-3">{m.balance_after ?? '—'}</td>
                    <td className="px-4 py-3">{m.responsible_user || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {!reversed && !m.reverses_movement_id && (
                        <Button size="icon" variant="ghost" title="Estornar movimentação"
                          onClick={() => setReversing(m)}>
                          <Undo2 className="w-4 h-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={9} className="p-10 text-center text-slate-400">Nenhuma movimentação registrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ItemDialog
        open={Boolean(itemDialog)}
        item={itemDialog === 'new' ? null : itemDialog}
        onClose={() => setItemDialog(null)}
        suppliers={suppliers}
        onSaved={reload}
      />
      <MovementDialog
        open={Boolean(moving)}
        item={moving?.item}
        type={moving?.type}
        onClose={() => setMoving(null)}
        onSaved={reload}
      />
      <AdjustDialog item={adjusting} open={Boolean(adjusting)} onClose={() => setAdjusting(null)} onSaved={reload} />
      <ReverseDialog movement={reversing} open={Boolean(reversing)} onClose={() => setReversing(null)} onSaved={reload} />
    </div>
  );
}

function Stat({ label, value, icon: Icon, danger }) {
  return (
    <div className={'rounded-xl border p-4 ' + (danger ? 'border-amber-200 bg-amber-50' : 'bg-white border-slate-200')}>
      <div className="flex justify-between">
        <div><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div>
        <Icon className={'w-5 h-5 ' + (danger ? 'text-amber-600' : 'text-slate-400')} />
      </div>
    </div>
  );
}

function Field({ l, children, hint }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{l}</Label>
      {children}
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function ErrorBox({ children }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{children}</div>;
}


// ---------------------------------------------------------------------------
// Cadastro/edição do item. O saldo NUNCA é digitado aqui na edição: ele só
// muda por movimentação (a garantia é do stockService). Na criação, o saldo
// inicial vira uma movimentação de abertura — assim não existe saldo sem
// lastro no histórico.
// ---------------------------------------------------------------------------
function ItemDialog({ open, item, onClose, suppliers, onSaved }) {
  const editing = Boolean(item && item.id);
  const [f, setF] = useState(emptyItem);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setF({
        ...emptyItem, ...item,
        current_stock: Number(item.current_stock || 0),
        minimum_stock: Number(item.minimum_stock || 0),
        average_cost: Number(item.average_cost || 0),
        last_cost: Number(item.last_cost || 0),
      });
    } else {
      setF(emptyItem);
    }
  }, [open, item, editing]);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.name?.trim()) { setError('Informe o nome do item.'); return; }
    const minimum = roundQty(f.minimum_stock);
    const cost = roundMoney(f.average_cost);
    if (!Number.isFinite(minimum) || minimum < 0) { setError('Estoque mínimo inválido.'); return; }
    if (!Number.isFinite(cost) || cost < 0) { setError('Custo inválido.'); return; }
    if (!UNITS.includes(f.unit)) { setError('Unidade inválida.'); return; }

    setSaving(true);
    setError('');
    try {
      const supplier = suppliers.find((x) => x.id === f.preferred_supplier_id);
      const payload = {
        name: f.name.trim(),
        sku: (f.sku || '').trim(),
        category: (f.category || '').trim(),
        unit: f.unit,
        minimum_stock: minimum,
        preferred_supplier_id: f.preferred_supplier_id,
        preferred_supplier_name: supplier?.trade_name || supplier?.name || '',
        location: (f.location || '').trim(),
        status: f.status || 'ativo',
        observation: (f.observation || '').trim(),
      };

      if (editing) {
        await updateInventoryItem(
          item.id,
          { ...payload, average_cost: cost, last_cost: roundMoney(f.last_cost) },
          { responsibleUser: currentUserName() }
        );
        toast({ title: 'Item atualizado.' });
      } else {
        const opening = roundQty(f.current_stock);
        if (!Number.isFinite(opening) || opening < 0) { setError('Estoque inicial inválido.'); setSaving(false); return; }
        await createInventoryItem(
          { item: { ...payload, current_stock: opening, average_cost: cost, last_cost: cost } },
          { responsibleUser: currentUserName() }
        );
        toast({ title: 'Item salvo.' });
      }
      onClose();
      await onSaved();
    } catch (e) {
      setError(e?.message || 'Não foi possível salvar o item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar item de estoque' : 'Novo item de estoque'}</DialogTitle>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field l="Nome *"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field l="Código/SKU"><Input value={f.sku} onChange={(e) => set('sku', e.target.value)} /></Field>
          <Field l="Categoria"><Input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Ex.: Laticínios, carnes, secos..." /></Field>
          <Field l="Unidade *">
            <select className={inputCls} value={f.unit} onChange={(e) => set('unit', e.target.value)}>
              {UNITS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          {!editing && (
            <Field l="Estoque inicial" hint="Vira uma movimentação de entrada no histórico.">
              <NumberInput value={f.current_stock} onChange={(v) => set('current_stock', v)} placeholder="0" />
            </Field>
          )}
          {editing && (
            <Field l="Estoque atual" hint="O saldo só muda por entrada, saída ou ajuste.">
              <Input value={qtyFmt(f.current_stock) + ' ' + (f.unit || '')} disabled />
            </Field>
          )}
          <Field l="Estoque mínimo">
            <NumberInput value={f.minimum_stock} onChange={(v) => set('minimum_stock', v)} placeholder="0" />
          </Field>
          <Field l="Custo unitário médio (R$)">
            <NumberInput value={f.average_cost} onChange={(v) => set('average_cost', v)} fractionDigits={2} placeholder="0,00" />
          </Field>
          <Field l="Último custo (R$)">
            <NumberInput value={f.last_cost} onChange={(v) => set('last_cost', v)} fractionDigits={2} placeholder="0,00" />
          </Field>
          <Field l="Fornecedor preferencial">
            <select className={inputCls} value={f.preferred_supplier_id} onChange={(e) => set('preferred_supplier_id', e.target.value)}>
              <option value="">Não definido</option>
              {suppliers.filter((x) => x.status === 'ativo').map((x) => (
                <option key={x.id} value={x.id}>{x.trade_name || x.name}</option>
              ))}
            </select>
          </Field>
          <Field l="Localização"><Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Ex.: freezer 2, prateleira A..." /></Field>
          <Field l="Situação">
            <select className={inputCls} value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field l="Observação"><Textarea rows={2} value={f.observation} onChange={(e) => set('observation', e.target.value)} /></Field>
          </div>
        </div>
        <ErrorBox>{error}</ErrorBox>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !f.name?.trim()}>
            {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Salvar item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// Entrada / saída / perda. É o caminho oficial para mexer no saldo: sempre
// gera StockMovement e usa o transact do banco (nunca confia no saldo que veio
// na tela). O clientToken impede que um duplo clique lance duas vezes.
// ---------------------------------------------------------------------------
function MovementDialog({ open, item, type, onClose, onSaved }) {
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [date, setDate] = useState(todayISO());
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuantity('');
    setUnitCost('');
    setDate(todayISO());
    setObservation('');
    setError('');
  }, [open, item, type]);

  if (!item) return null;
  const isEntry = stockDirection(type) === 'entrada';
  const current = roundQty(item.current_stock) || 0;
  const qtyNum = roundQty(quantity);
  const preview = Number.isFinite(qtyNum) ? roundQty(isEntry ? current + qtyNum : current - qtyNum) : null;

  const save = async () => {
    if (saving) return;
    setError('');
    try {
      validateMovement({ item, type, quantity });
    } catch (e) {
      setError(e?.message || 'Verifique os dados da movimentação.');
      return;
    }
    setSaving(true);
    // Token estável por item+tipo+quantidade+data: o mesmo lançamento repetido
    // (duplo clique, reenvio) não vira duplicidade no banco.
    const token = 'mov:' + [item.id, type, qtyNum, date].join('|');
    try {
      const { movement, item: fresh, duplicated } = await registerMovement({
        item,
        type,
        quantity,
        date,
        unit: item.unit,
        unitCost,
        originType: 'manual',
        observation,
        responsibleUser: currentUserName(),
        clientToken: token,
      });
      toast({
        title: duplicated
          ? 'Movimentação já registrada.'
          : 'Movimentação registrada.',
        description: movementTypeLabel(movement.movement_type) + ' · saldo ' + qtyFmt(fresh.current_stock) + ' ' + item.unit,
      });
      onClose();
      await onSaved();
    } catch (e) {
      setError(e?.message || 'Não foi possível registrar a movimentação.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEntry ? 'Registrar entrada' : 'Registrar saída'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium">{item.name}</p>
            <p className="text-sm text-slate-500">Saldo atual: {qtyFmt(current)} {item.unit}</p>
          </div>
          <Field l={'Quantidade * (' + item.unit + ')'}>
            <NumberInput value={quantity} onChange={setQuantity} placeholder="0" autoFocus />
          </Field>
          <Field l={'Custo unitário (R$)'}>
            <NumberInput value={unitCost} onChange={setUnitCost} fractionDigits={2} placeholder="0,00" />
          </Field>
          <Field l="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field l="Observação">
            <Textarea rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} />
          </Field>
          {preview !== null && (
            <p className="text-sm text-slate-600">
              Saldo após o lançamento: <strong>{qtyFmt(preview)} {item.unit}</strong>
            </p>
          )}
          <ErrorBox>{error}</ErrorBox>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !Number.isFinite(qtyNum) || qtyNum <= 0}>
            {saving ? 'Registrando...' : isEntry ? 'Confirmar entrada' : 'Confirmar saída'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// Ajuste de inventário: o usuário informa o saldo realfound e o sistema calcula
// a diferença, lançando a movimentação de ajuste (entrada ou saída) com o
// motivo escolhido. O saldo continua vindo do banco.
// ---------------------------------------------------------------------------
function AdjustDialog({ item, open, onClose, onSaved }) {
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState(MOVEMENT_TYPES.AJUSTE);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !item) return;
    setTarget(String(roundQty(item.current_stock) || 0));
    setReason(MOVEMENT_TYPES.AJUSTE);
    setNote('');
    setError('');
  }, [open, item]);

  if (!item) return null;
  const current = roundQty(item.current_stock) || 0;
  const targetNum = roundQty(target);
  const diff = Number.isFinite(targetNum) ? roundQty(targetNum - current) : 0;
  const effectiveType = diff >= 0 ? MOVEMENT_TYPES.AJUSTE_ENTRADA : MOVEMENT_TYPES.AJUSTE_SAIDA;

  const save = async () => {
    if (saving) return;
    if (!Number.isFinite(targetNum)) { setError('Novo saldo inválido.'); return; }
    if (targetNum < 0) { setError('O saldo não pode ficar negativo.'); return; }
    if (diff === 0) { setError('O novo saldo é igual ao atual: não há ajuste a fazer.'); return; }
    setSaving(true);
    setError('');
    try {
      // Saldo real pode ser menor que o esperado: um inventário que encontra
      // falta também precisa ser lançável, por isso allowNegative no caminho
      // de ajuste (o saldo final continua >= 0, validado acima).
      await registerMovement({
        item,
        type: reason === MOVEMENT_TYPES.PERDA ? MOVEMENT_TYPES.PERDA : effectiveType,
        quantity: Math.abs(diff),
        date: todayISO(),
        unit: item.unit,
        unitCost: 0,
        originType: 'ajuste',
        observation: note || 'Ajuste de inventário',
        responsibleUser: currentUserName(),
        clientToken: 'ajuste:' + [item.id, targetNum, reason, todayISO()].join('|'),
        allowNegative: true,
      });
      toast({ title: 'Estoque ajustado.', description: 'Novo saldo: ' + qtyFmt(targetNum) + ' ' + item.unit });
      onClose();
      await onSaved();
    } catch (e) {
      setError(e?.message || 'Não foi possível ajustar o estoque.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Ajustar estoque</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium">{item.name}</p>
            <p className="text-sm text-slate-500">Saldo atual: {qtyFmt(current)} {item.unit}</p>
          </div>
          <Field l={'Novo saldo (' + item.unit + ')'}>
            <NumberInput value={target} onChange={setTarget} placeholder="0" />
          </Field>
          <Field l="Motivo">
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value={MOVEMENT_TYPES.AJUSTE}>Inventário</option>
              <option value={MOVEMENT_TYPES.PERDA}>Perda</option>
            </select>
          </Field>
          <Field l="Observação">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {diff !== 0 && (
            <p className="text-sm text-slate-600">
              Sera lancado como <strong>{MOVEMENT_LABELS[reason === MOVEMENT_TYPES.PERDA ? MOVEMENT_TYPES.PERDA : effectiveType]}</strong> de{' '}
              <strong>{qtyFmt(Math.abs(diff))} {item.unit}</strong>.
            </p>
          )}
          <ErrorBox>{error}</ErrorBox>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || diff === 0}>
            {saving ? 'Ajustando...' : 'Confirmar ajuste'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------------------------------------------------------------------
// Estorno. Em vez de apagar a movimentação (o que deixaria o saldo sem
// explicação), gravamos a movimentação inversa e marcamos a original. O
// histórico continua completo e o saldo volta ao valor anterior.
// ---------------------------------------------------------------------------
function ReverseDialog({ movement, open, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError('');
  }, [open, movement]);

  if (!movement) return null;
  const signed = signedQuantity(movement);

  const save = async () => {
    if (saving) return;
    if (!reason.trim()) { setError('Informe o motivo do estorno.'); return; }
    setSaving(true);
    setError('');
    try {
      await reverseMovement(movement, { reason: reason.trim(), responsibleUser: currentUserName() });
      toast({ title: 'Movimentação estornada.', description: 'O saldo foi recalculado.' });
      onClose();
      await onSaved();
    } catch (e) {
      setError(e?.message || 'Não foi possível estornar a movimentação.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Estornar movimentação</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium">{movement.item_name || 'Item'}</p>
            <p className="text-sm text-slate-500">
              {fmt(movement.date)} · {movementTypeLabel(movement.movement_type)} · {qtyFmt(signed)} {movement.unit}
            </p>
          </div>
          <p className="text-sm text-slate-600">
            A movimentação original sera mantida no historico e o saldo recebera um lancamento inverso.
          </p>
          <Field l="Motivo do estorno *">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: lancamento duplicado" />
          </Field>
          <ErrorBox>{error}</ErrorBox>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={save} disabled={saving || !reason.trim()}>
            {saving ? 'Estornando...' : 'Confirmar estorno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
