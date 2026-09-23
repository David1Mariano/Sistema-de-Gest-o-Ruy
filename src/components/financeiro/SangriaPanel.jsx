import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Wallet, Trash2, Pencil, Search } from 'lucide-react';
import { useUserRole } from '@/lib/useUserRole';

const today = () => new Date().toISOString().slice(0, 10);
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v) => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—';
const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
const CASHIER_LABELS = { caixa_1: 'Caixa 1', caixa_2: 'Caixa 2' };

export default function SangriaPanel({ records, onSaved }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const { isAdmin } = useUserRole();

  const sorted = useMemo(() => [...records].sort((a, b) => (b.date || '').localeCompare(a.date || '')), [records]);
  const filtered = useMemo(() => sorted.filter(x => `${x.responsible || ''} ${x.purpose || ''} ${x.destination || ''}`.toLowerCase().includes(search.toLowerCase())), [sorted, search]);
  const total = useMemo(() => filtered.filter(x => x.status !== 'cancelado').reduce((s, x) => s + Number(x.amount || 0), 0), [filtered]);
  const todayTotal = useMemo(() => sorted.filter(x => x.status !== 'cancelado' && x.date === today()).reduce((s, x) => s + Number(x.amount || 0), 0), [sorted]);

  const handleDelete = async (row) => {
    if (!window.confirm('Deseja cancelar esta sangria?')) return;
    await base44.entities.Sangria.update(row.id, { status: 'cancelado' });
    await onSaved();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Sangrias</h3>
          <p className="text-sm text-slate-500">Registro de retiradas de dinheiro do caixa, com responsável e intuito.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Nova sangria</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Total no período" value={brl(total)} icon={Wallet} />
        <Stat label="Sangrias hoje" value={brl(todayTotal)} icon={Wallet} />
        <Stat label="Registros" value={filtered.filter(x => x.status !== 'cancelado').length} icon={Wallet} />
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" placeholder="Buscar por responsável, intuito ou destino..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>{['Data', 'Operador do caixa', 'Caixa', 'Responsável', 'Intuito/Motivo', 'Destino', 'Valor', 'Status', 'Ação'].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length ? filtered.map(x => (
                <tr key={x.id} className={x.status === 'cancelado' ? 'opacity-50' : ''}>
                  <td className="px-4 py-3">{fmt(x.date)}</td>
                  <td className="px-4 py-3">{x.operator_name || '—'}</td>
                  <td className="px-4 py-3">{CASHIER_LABELS[x.cashier] || '—'}</td>
                  <td className="px-4 py-3 font-medium">{x.responsible}</td>
                  <td className="px-4 py-3">{x.purpose}</td>
                  <td className="px-4 py-3">{x.destination || '—'}</td>
                  <td className="px-4 py-3 font-semibold">{brl(x.amount)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${x.status === 'cancelado' ? 'text-slate-500 bg-slate-100' : 'text-emerald-700 bg-emerald-50'}`}>{x.status === 'cancelado' ? 'Cancelado' : 'Ativo'}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(x); setOpen(true); }} className="h-8 px-2"><Pencil className="w-3.5 h-3.5" /></Button>
                      {isAdmin && x.status !== 'cancelado' && <Button size="sm" variant="ghost" onClick={() => handleDelete(x)} className="h-8 px-2 text-rose-600"><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={9} className="p-10 text-center text-slate-400">Nenhuma sangria registrada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <SangriaDialog open={open} editing={editing} onClose={() => { setOpen(false); setEditing(null); }} onSaved={onSaved} />
    </div>
  );
}

export function SangriaDialog({ open, editing, onClose, onSaved, presetResponsible }) {
  const empty = { date: today(), time: '', cashier: 'caixa_1', amount: '', operator_name: '', responsible: '', purpose: '', destination: '', observation: '' };
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setF({ ...empty, ...editing, amount: String(editing.amount || '') });
      } else {
        setF({ ...empty, responsible: presetResponsible || '' });
      }
    }
  }, [open, editing, presetResponsible]);

  const set = (k, v) => setF(x => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.date || !Number(f.amount) || !f.responsible || !f.purpose) return;
    setSaving(true);
    try {
      const payload = {
        date: f.date,
        time: f.time,
        cashier: f.cashier,
        amount: Number(f.amount),
        operator_name: f.operator_name,
        responsible: f.responsible,
        purpose: f.purpose,
        destination: f.destination,
        observation: f.observation,
        registered_by: currentUserName(),
        status: 'ativo',
      };
      if (editing) {
        await base44.entities.Sangria.update(editing.id, payload);
      } else {
        await base44.entities.Sangria.create(payload);
      }
      onClose();
      await onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Editar sangria' : 'Nova sangria'}</DialogTitle></DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field l="Data"><Input type="date" value={f.date} onChange={e => set('date', e.target.value)} /></Field>
          <Field l="Horário"><Input type="time" value={f.time} onChange={e => set('time', e.target.value)} /></Field>
          <Field l="Caixa">
            <select className={inputCls} value={f.cashier} onChange={e => set('cashier', e.target.value)}>
              {Object.entries(CASHIER_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field l="Valor"><CurrencyInput value={f.amount} onChange={v => set('amount', v)} /></Field>
          <Field l="Operador do caixa"><Input value={f.operator_name} onChange={e => set('operator_name', e.target.value)} placeholder="Quem operou o caixa" /></Field>
          <Field l="Responsável"><Input value={f.responsible} onChange={e => set('responsible', e.target.value)} placeholder="Quem retirou" /></Field>
          <Field l="Destino"><Input value={f.destination} onChange={e => set('destination', e.target.value)} placeholder="Para onde foi" /></Field>
          <div className="sm:col-span-2"><Field l="Intuito/Motivo"><Input value={f.purpose} onChange={e => set('purpose', e.target.value)} placeholder="Para qual intuito pegou" /></Field></div>
          <div className="sm:col-span-2"><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e => set('observation', e.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !f.date || !Number(f.amount) || !f.responsible || !f.purpose}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Registrar sangria'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, icon: Icon }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex justify-between"><div><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold mt-1 text-slate-900">{value}</p></div><Icon className="w-5 h-5 text-amber-600" /></div></div>;
}
function Field({ l, children }) { return <div className="space-y-1"><Label className="text-xs">{l}</Label>{children}</div>; }

function CurrencyInput({ value, onChange }) {
  const fmt = (v) => { const n = Number(v); return (v || v === 0) && !isNaN(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; };
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]);
  const parse = (s) => { const cleaned = String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''); return cleaned ? Number(cleaned) : ''; };
  return <Input inputMode="decimal" value={text} placeholder="0,00" onFocus={() => { setFocused(true); setText(value ? String(value).replace('.', ',') : ''); }} onBlur={() => setFocused(false)} onChange={e => { setText(e.target.value); onChange(parse(e.target.value)); }} />;
}