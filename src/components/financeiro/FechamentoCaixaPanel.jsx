import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { useUserRole } from '@/lib/useUserRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Wallet, Plus, Upload, Paperclip, Search, Pencil, Lock, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';

const today = () => new Date().toISOString().slice(0, 10);
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (v) => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—';
const fmtDateTime = (v) => v ? new Date(v).toLocaleString('pt-BR') : '—';
const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const CASHIER_LABELS = { caixa_1: 'Caixa 1', caixa_2: 'Caixa 2' };
const SHIFT_LABELS = { abertura: 'Abertura', intermediario: 'Intermediário', fechamento: 'Fechamento' };
const STATUS_LABELS = { em_preenchimento: 'Em preenchimento', fechado: 'Fechado', com_falta: 'Com falta', com_sobra: 'Com sobra' };
const STATUS_STYLES = {
  em_preenchimento: 'bg-slate-100 text-slate-600',
  fechado: 'bg-emerald-100 text-emerald-700',
  com_falta: 'bg-rose-100 text-rose-700',
  com_sobra: 'bg-amber-100 text-amber-700',
};

const empty = {
  date: today(), cashier: 'caixa_1', shift: 'fechamento', operator_name: '', reviewer_name: '',
  opening_time: '', closing_time: '', opening_fund: '', cash_sales: '', pix_total: '', debit_total: '',
  credit_total: '', ifood_total: '', food99_total: '', brendi_total: '', other_payments: '',
  pix_machine: '', debit_machine: '', credit_machine: '',
  withdrawals_total: '', counted_cash: '', observation: '', attachment_url: '',
};

export default function FechamentoCaixaPanel({ records, onSaved }) {
  const { isAdmin } = useUserRole();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterCashier, setFilterCashier] = useState('');
  const [filterOperator, setFilterOperator] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const deleteFechamento = async (r) => {
    if (!window.confirm(`Excluir o fechamento de ${fmtDate(r.date)} · ${CASHIER_LABELS[r.cashier]} · ${SHIFT_LABELS[r.shift]}? Esta ação não pode ser desfeita.`)) return;
    await base44.entities.FechamentoCaixa.delete(r.id);
    await onSaved();
  };

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (filterDate && r.date !== filterDate) return false;
      if (filterCashier && r.cashier !== filterCashier) return false;
      if (filterOperator && !(r.operator_name || '').toLowerCase().includes(filterOperator.toLowerCase())) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (search && !`${r.date} ${r.operator_name} ${r.reviewer_name} ${r.cashier} ${r.shift}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [records, search, filterDate, filterCashier, filterOperator, filterStatus]);

  const dayTotals = useMemo(() => {
    const todayRecords = records.filter((r) => r.date === today());
    const sum = (key) => todayRecords.reduce((s, r) => s + Number(r[key] || 0), 0);
    return {
      totalSold: sum('cash_sales') + sum('pix_total') + sum('debit_total') + sum('credit_total') + sum('ifood_total') + sum('food99_total') + sum('brendi_total') + sum('other_payments'),
      totalCash: sum('cash_sales'),
      totalPix: sum('pix_total'),
      totalCards: sum('debit_total') + sum('credit_total'),
      totalWithdrawals: sum('withdrawals_total'),
      totalDifference: sum('difference'),
    };
  }, [records]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Fechamento de Caixa</h3>
          <p className="text-sm text-slate-500">Conferência de caixa por turno, operador e forma de pagamento.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }} className="gap-2"><Plus className="w-4 h-4" /> Novo fechamento</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Stat label="Total vendido hoje" value={brl(dayTotals.totalSold)} icon={Wallet} />
        <Stat label="Total em dinheiro" value={brl(dayTotals.totalCash)} icon={Wallet} />
        <Stat label="Total em PIX" value={brl(dayTotals.totalPix)} icon={Wallet} />
        <Stat label="Total em cartões" value={brl(dayTotals.totalCards)} icon={Wallet} />
        <Stat label="Total de sangrias" value={brl(dayTotals.totalWithdrawals)} icon={Wallet} />
        <Stat label="Diferença total" value={brl(dayTotals.totalDifference)} icon={AlertTriangle} danger={Math.abs(dayTotals.totalDifference) > 0.005} />
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="relative max-w-xs flex-1 min-w-48">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div><Label className="text-xs">Data</Label><Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">Caixa</Label>
          <select className={inputCls + ' w-36'} value={filterCashier} onChange={(e) => setFilterCashier(e.target.value)}>
            <option value="">Todos</option>
            <option value="caixa_1">Caixa 1</option>
            <option value="caixa_2">Caixa 2</option>
          </select>
        </div>
        <div><Label className="text-xs">Operador</Label><Input value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)} placeholder="Operador" className="w-40" /></div>
        <div><Label className="text-xs">Situação</Label>
          <select className={inputCls + ' w-44'} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {['Data', 'Caixa', 'Turno', 'Operador', 'Conferente', 'Vendido', 'Dinheiro contado', 'Esperado', 'Diferença', 'Situação', 'Ação'].map((h) => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {!filtered.length ? (
                <tr><td colSpan={11} className="p-10 text-center text-slate-400">Nenhum fechamento de caixa registrado.</td></tr>
              ) : filtered.map((r) => {
                const totalSold = Number(r.cash_sales || 0) + Number(r.pix_total || 0) + Number(r.debit_total || 0) + Number(r.credit_total || 0) + Number(r.ifood_total || 0) + Number(r.food99_total || 0) + Number(r.brendi_total || 0) + Number(r.other_payments || 0);
                const diff = Number(r.difference || 0);
                const diffColor = Math.abs(diff) < 0.005 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-amber-700';
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3">{CASHIER_LABELS[r.cashier] || r.cashier}</td>
                    <td className="px-4 py-3">{SHIFT_LABELS[r.shift] || r.shift}</td>
                    <td className="px-4 py-3 font-medium">{r.operator_name || '—'}</td>
                    <td className="px-4 py-3">{r.reviewer_name || '—'}</td>
                    <td className="px-4 py-3">{brl(totalSold)}</td>
                    <td className="px-4 py-3">{brl(r.counted_cash)}</td>
                    <td className="px-4 py-3">{brl(r.expected_cash)}</td>
                    <td className={`px-4 py-3 font-semibold ${diffColor}`}>{brl(diff)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[r.status] || ''}`}>{STATUS_LABELS[r.status] || r.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {r.status === 'em_preenchimento' || isAdmin ? (
                          <button onClick={() => { setEditing(r); setOpen(true); }} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500" title="Editar"><Pencil className="w-4 h-4" /></button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Lock className="w-3.5 h-3.5" /> Bloqueado</span>
                        )}
                        {isAdmin && <button onClick={() => deleteFechamento(r)} className="p-1.5 rounded-md hover:bg-rose-50 text-slate-400 hover:text-rose-600" title="Excluir"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <FechamentoCaixaDialog open={open} editing={editing} onClose={() => { setOpen(false); setEditing(null); }} onSaved={onSaved} records={records} />
    </div>
  );
}

function Stat({ label, value, icon: Icon, danger }) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex justify-between">
        <div>
          <p className={`text-xs ${danger ? 'text-rose-600' : 'text-slate-500'}`}>{label}</p>
          <p className={`text-lg font-semibold mt-1 ${danger ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p>
        </div>
        <Icon className={`w-5 h-5 ${danger ? 'text-rose-500' : 'text-amber-600'}`} />
      </div>
    </div>
  );
}

function FechamentoCaixaDialog({ open, editing, onClose, onSaved, records }) {
  const { isAdmin } = useUserRole();
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (open) {
      if (editing) {
        setF({
          ...empty,
          ...editing,
          opening_fund: String(editing.opening_fund || ''),
          cash_sales: String(editing.cash_sales || ''),
          pix_total: String(editing.pix_total || ''),
          debit_total: String(editing.debit_total || ''),
          credit_total: String(editing.credit_total || ''),
          ifood_total: String(editing.ifood_total || ''),
          food99_total: String(editing.food99_total || ''),
          brendi_total: String(editing.brendi_total || ''),
          other_payments: String(editing.other_payments || ''),
          pix_machine: String(editing.pix_machine || ''),
          debit_machine: String(editing.debit_machine || ''),
          credit_machine: String(editing.credit_machine || ''),
          withdrawals_total: String(editing.withdrawals_total || ''),
          counted_cash: String(editing.counted_cash || ''),
        });
      } else {
        setF(empty);
      }
      setShowConfirm(false);
    }
  }, [open, editing]);

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const num = (v) => Number(v || 0);
  const expectedCash = useMemo(() => num(f.opening_fund) + num(f.cash_sales) - num(f.withdrawals_total), [f.opening_fund, f.cash_sales, f.withdrawals_total]);
  const difference = useMemo(() => num(f.counted_cash) - expectedCash, [f.counted_cash, expectedCash]);
  const totalSold = useMemo(() => num(f.cash_sales) + num(f.pix_total) + num(f.debit_total) + num(f.credit_total) + num(f.ifood_total) + num(f.food99_total) + num(f.brendi_total) + num(f.other_payments), [f]);
  const pixDiff = num(f.pix_total) - num(f.pix_machine);
  const debitDiff = num(f.debit_total) - num(f.debit_machine);
  const creditDiff = num(f.credit_total) - num(f.credit_machine);
  const machineSystemDiff = useMemo(() => pixDiff + debitDiff + creditDiff, [pixDiff, debitDiff, creditDiff]);
  const msDiffColor = Math.abs(machineSystemDiff) < 0.005 ? 'text-emerald-700' : machineSystemDiff < 0 ? 'text-rose-700' : 'text-amber-700';
  const diffBox = (d) => Math.abs(d) < 0.005 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : d < 0 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-amber-50 border-amber-200 text-amber-700';

  const diffColor = Math.abs(difference) < 0.005 ? 'text-emerald-700' : difference < 0 ? 'text-rose-700' : 'text-amber-700';
  const diffBg = Math.abs(difference) < 0.005 ? 'bg-emerald-50 border-emerald-200' : difference < 0 ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200';
  const diffLabel = Math.abs(difference) < 0.005 ? 'Caixa conferido ✓' : difference < 0 ? 'Faltando dinheiro' : 'Sobrando dinheiro';

  const isLocked = editing && editing.status !== 'em_preenchimento' && !isAdmin;

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set('attachment_url', file_url);
    } finally { setUploading(false); }
  };

  const computeStatus = (diff) => Math.abs(diff) < 0.005 ? 'fechado' : diff < 0 ? 'com_falta' : 'com_sobra';

  const buildPayload = (finalize) => {
    const status = finalize ? computeStatus(difference) : (editing?.status === 'em_preenchimento' || !editing ? 'em_preenchimento' : editing.status);
    return {
      date: f.date, cashier: f.cashier, shift: f.shift,
      operator_name: f.operator_name, reviewer_name: f.reviewer_name,
      opening_time: f.opening_time, closing_time: f.closing_time,
      opening_fund: num(f.opening_fund), cash_sales: num(f.cash_sales), pix_total: num(f.pix_total),
      debit_total: num(f.debit_total), credit_total: num(f.credit_total),
      ifood_total: num(f.ifood_total), food99_total: num(f.food99_total), brendi_total: num(f.brendi_total),
      other_payments: num(f.other_payments), pix_machine: num(f.pix_machine), debit_machine: num(f.debit_machine), credit_machine: num(f.credit_machine), machine_system_difference: machineSystemDiff,
      withdrawals_total: num(f.withdrawals_total),
      counted_cash: num(f.counted_cash), expected_cash: expectedCash, difference,
      observation: f.observation, attachment_url: f.attachment_url,
      status,
      finalized_by: finalize ? currentUserName() : (editing?.finalized_by || ''),
      finalized_at: finalize ? new Date().toISOString() : (editing?.finalized_at || ''),
      created_by_name: editing?.created_by_name || currentUserName(),
    };
  };

  const checkDuplicate = () => records.find((r) => r.date === f.date && r.cashier === f.cashier && r.shift === f.shift && r.id !== editing?.id);

  const save = async (finalize) => {
    if (!f.date || !f.operator_name) return;
    const duplicate = checkDuplicate();
    if (duplicate && !isAdmin) {
      window.alert('Já existe um fechamento para este caixa, data e turno. Apenas um administrador pode criar um duplicado.');
      return;
    }
    if (duplicate && finalize && !window.confirm('Já existe um fechamento idêntico para este caixa, data e turno. Deseja confirmar mesmo assim?')) return;
    setSaving(true);
    try {
      const payload = buildPayload(finalize);
      if (editing) {
        await base44.entities.FechamentoCaixa.update(editing.id, payload);
      } else {
        await base44.entities.FechamentoCaixa.create(payload);
      }
      onClose();
      await onSaved();
    } finally { setSaving(false); }
  };

  if (isLocked) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Fechamento bloqueado</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Lock className="w-10 h-10 text-slate-400" />
            <p className="text-sm text-slate-600">Este fechamento já foi finalizado e só pode ser corrigido por um administrador.</p>
            <div className="rounded-lg bg-slate-50 p-3 w-full text-left text-sm">
              <p><b>Data:</b> {fmtDate(editing.date)} · {CASHIER_LABELS[editing.cashier]} · {SHIFT_LABELS[editing.shift]}</p>
              <p><b>Operador:</b> {editing.operator_name}</p>
              <p><b>Diferença:</b> <span className={diffColor}>{brl(editing.difference)}</span></p>
              <p><b>Finalizado por:</b> {editing.finalized_by || '—'} em {fmtDateTime(editing.finalized_at)}</p>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Editar fechamento de caixa' : 'Novo fechamento de caixa'}</DialogTitle></DialogHeader>

        {!showConfirm ? (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <Field l="Data do fechamento"><Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
              <Field l="Caixa"><Select v={f.cashier} on={(v) => set('cashier', v)} opts={Object.entries(CASHIER_LABELS)} /></Field>
              <Field l="Turno"><Select v={f.shift} on={(v) => set('shift', v)} opts={Object.entries(SHIFT_LABELS)} /></Field>
              <Field l="Operador do caixa"><Input value={f.operator_name} onChange={(e) => set('operator_name', e.target.value)} placeholder="Nome do operador" /></Field>
              <Field l="Responsável pela conferência"><Input value={f.reviewer_name} onChange={(e) => set('reviewer_name', e.target.value)} placeholder="Nome do conferente" /></Field>
              <div />
              <Field l="Horário de abertura"><Input type="time" value={f.opening_time} onChange={(e) => set('opening_time', e.target.value)} /></Field>
              <Field l="Horário de fechamento"><Input type="time" value={f.closing_time} onChange={(e) => set('closing_time', e.target.value)} /></Field>
            </div>

            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-600 uppercase mb-2">Dinheiro</p>
              <div className="grid sm:grid-cols-3 gap-3">
                <Field l="Fundo inicial"><CurrencyInput value={f.opening_fund} onChange={(v) => set('opening_fund', v)} /></Field>
                <Field l="Vendas em dinheiro"><CurrencyInput value={f.cash_sales} onChange={(v) => set('cash_sales', v)} /></Field>
                <Field l="Total de sangrias"><CurrencyInput value={f.withdrawals_total} onChange={(v) => set('withdrawals_total', v)} /></Field>
              </div>
            </div>

            <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
              <p className="text-xs font-semibold text-slate-600 uppercase">Outras formas de pagamento</p>
              <div className="space-y-2">
                <MethodPair label="PIX" machine={f.pix_machine} system={f.pix_total} diff={pixDiff} onMachine={(v) => set('pix_machine', v)} onSystem={(v) => set('pix_total', v)} />
                <MethodPair label="Débito" machine={f.debit_machine} system={f.debit_total} diff={debitDiff} onMachine={(v) => set('debit_machine', v)} onSystem={(v) => set('debit_total', v)} />
                <MethodPair label="Crédito" machine={f.credit_machine} system={f.credit_total} diff={creditDiff} onMachine={(v) => set('credit_machine', v)} onSystem={(v) => set('credit_total', v)} />
              </div>
              <div className="grid sm:grid-cols-4 gap-3 pt-3 border-t border-slate-200">
                <Field l="iFood"><CurrencyInput value={f.ifood_total} onChange={(v) => set('ifood_total', v)} /></Field>
                <Field l="99Food"><CurrencyInput value={f.food99_total} onChange={(v) => set('food99_total', v)} /></Field>
                <Field l="Brendi"><CurrencyInput value={f.brendi_total} onChange={(v) => set('brendi_total', v)} /></Field>
                <Field l="Outras formas"><CurrencyInput value={f.other_payments} onChange={(v) => set('other_payments', v)} /></Field>
              </div>
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 uppercase">Diferença total máquina x sistema</span>
                <span className={`px-3 py-1.5 rounded-md border font-semibold text-sm ${diffBox(machineSystemDiff)}`}>{brl(machineSystemDiff)}</span>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field l="Dinheiro contado no caixa"><CurrencyInput value={f.counted_cash} onChange={(v) => set('counted_cash', v)} /></Field>
              <div className="space-y-1">
                <Label className="text-xs">Anexo (maquininha, comprovantes, documentos)</Label>
                <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf" onChange={(e) => upload(e.target.files?.[0])} />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2"><Upload className="w-4 h-4" />{uploading ? 'Enviando...' : f.attachment_url ? 'Trocar arquivo' : 'Anexar arquivo'}</Button>
                  {f.attachment_url && <a href={f.attachment_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 flex items-center gap-1"><Paperclip className="w-3 h-3" /> Abrir</a>}
                </div>
              </div>
            </div>

            <div className={`rounded-lg border p-4 ${diffBg}`}>
              <div className="grid sm:grid-cols-4 gap-3 text-sm">
                <div><p className="text-xs text-slate-500">Valor esperado em dinheiro</p><p className="font-semibold mt-1">{brl(expectedCash)}</p><p className="text-[10px] text-slate-400">fundo + vendas - sangrias</p></div>
                <div><p className="text-xs text-slate-500">Dinheiro contado</p><p className="font-semibold mt-1">{brl(num(f.counted_cash))}</p></div>
                <div><p className="text-xs text-slate-500">Total vendido</p><p className="font-semibold mt-1">{brl(totalSold)}</p></div>
                <div><p className="text-xs text-slate-500">Diferença do caixa</p><p className={`font-semibold mt-1 ${diffColor}`}>{brl(difference)}</p><p className={`text-xs font-medium ${diffColor}`}>{diffLabel}</p></div>
              </div>
            </div>

            <Field l="Observações"><Textarea rows={2} value={f.observation} onChange={(e) => set('observation', e.target.value)} /></Field>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button variant="outline" onClick={() => save(false)} disabled={saving || !f.date || !f.operator_name}>{saving ? 'Salvando...' : 'Salvar rascunho'}</Button>
              <Button onClick={() => setShowConfirm(true)} disabled={saving || !f.date || !f.operator_name} className="gap-2"><CheckCircle2 className="w-4 h-4" /> Finalizar fechamento</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-slate-50 p-4">
              <h4 className="font-semibold mb-3">Resumo do fechamento</h4>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <SummaryRow label="Data" value={fmtDate(f.date)} />
                <SummaryRow label="Caixa / Turno" value={`${CASHIER_LABELS[f.cashier]} · ${SHIFT_LABELS[f.shift]}`} />
                <SummaryRow label="Operador" value={f.operator_name} />
                <SummaryRow label="Conferente" value={f.reviewer_name || '—'} />
                <SummaryRow label="Fundo inicial" value={brl(num(f.opening_fund))} />
                <SummaryRow label="Vendas em dinheiro" value={brl(num(f.cash_sales))} />
                <SummaryRow label="Sangrias" value={brl(num(f.withdrawals_total))} />
                <SummaryRow label="PIX" value={brl(num(f.pix_total))} />
                <SummaryRow label="Débito" value={brl(num(f.debit_total))} />
                <SummaryRow label="Crédito" value={brl(num(f.credit_total))} />
                <SummaryRow label="iFood" value={brl(num(f.ifood_total))} />
                <SummaryRow label="99Food" value={brl(num(f.food99_total))} />
                <SummaryRow label="Brendi" value={brl(num(f.brendi_total))} />
                <SummaryRow label="PIX (máquina)" value={brl(num(f.pix_machine))} />
                <SummaryRow label="PIX (sistema)" value={brl(num(f.pix_total))} />
                <SummaryRow label="Débito (máquina)" value={brl(num(f.debit_machine))} />
                <SummaryRow label="Débito (sistema)" value={brl(num(f.debit_total))} />
                <SummaryRow label="Crédito (máquina)" value={brl(num(f.credit_machine))} />
                <SummaryRow label="Crédito (sistema)" value={brl(num(f.credit_total))} />
                <SummaryRow label="iFood" value={brl(num(f.ifood_total))} />
                <SummaryRow label="99Food" value={brl(num(f.food99_total))} />
                <SummaryRow label="Brendi" value={brl(num(f.brendi_total))} />
                <SummaryRow label="Outras formas" value={brl(num(f.other_payments))} />
                <div className="flex justify-between border-t pt-1.5"><span className="text-slate-600">Diferença máquina x sistema</span><strong className={msDiffColor}>{brl(machineSystemDiff)}</strong></div>
                <SummaryRow label="Total vendido" value={brl(totalSold)} strong />
                <SummaryRow label="Dinheiro contado" value={brl(num(f.counted_cash))} strong />
                <SummaryRow label="Valor esperado" value={brl(expectedCash)} strong />
                <div className="flex justify-between border-t pt-1.5"><span className="text-slate-600">Diferença do caixa</span><strong className={diffColor}>{brl(difference)} · {diffLabel}</strong></div>
              </div>
            </div>
            <p className="text-sm text-slate-600">Confirme os valores acima. Após finalizar, o fechamento será bloqueado para usuários comuns e só poderá ser corrigido por administradores.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirm(false)}>Voltar</Button>
              <Button onClick={() => save(true)} disabled={saving} className="gap-2">{saving ? 'Finalizando...' : 'Confirmar e finalizar'}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryRow({ label, value, strong }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  );
}

function Field({ l, children }) { return <div className="space-y-1"><Label className="text-xs">{l}</Label>{children}</div>; }
function Select({ v, on, opts }) { return <select className={inputCls} value={v} onChange={(e) => on(e.target.value)}>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>; }

function MethodPair({ label, machine, system, diff, onMachine, onSystem }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr_1fr_1fr] gap-2 items-end">
      <Label className="text-xs font-semibold text-slate-700">{label}</Label>
      <Field l="Informado pela máquina"><CurrencyInput value={machine} onChange={onMachine} /></Field>
      <Field l="Informado pelo sistema"><CurrencyInput value={system} onChange={onSystem} /></Field>
      <div className="space-y-1">
        <Label className="text-xs">Diferença</Label>
        <div className={`h-9 flex items-center px-3 rounded-md border font-semibold text-sm ${Math.abs(diff) < 0.005 ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : diff < 0 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>{brl(diff)}</div>
      </div>
    </div>
  );
}

function CurrencyInput({ value, onChange }) {
  const fmt = (v) => { const n = Number(v); return (v || v === 0) && !isNaN(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; };
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]);
  const parse = (s) => { const cleaned = String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''); return cleaned ? Number(cleaned) : ''; };
  return <Input inputMode="decimal" value={text} placeholder="0,00" onFocus={() => { setFocused(true); setText(value ? String(value).replace('.', ',') : ''); }} onBlur={() => setFocused(false)} onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />;
}