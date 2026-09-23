import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Upload } from 'lucide-react';

const PAYMENT_TYPES = {
  salario: 'Salário', diaria_motoboy: 'Diária de motoboy', diaria_freelancer: 'Diária de freelancer',
  vale: 'Vale', adiantamento: 'Adiantamento', hora_extra: 'Hora extra', comissao: 'Comissão',
  ferias: 'Férias', decimo_terceiro: '13º salário', acerto: 'Acerto', outros: 'Outros',
};
const PAYMENT_METHODS = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_debito: 'Cartão débito', cartao_credito: 'Cartão crédito', transferencia: 'Transferência', outro: 'Outro' };
const PAYMENT_STATUS = { pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado' };

const empty = {
  employee_id: '', employee_name: '', payment_type: 'salario', reference_start: '', reference_end: '',
  work_date: '', days_quantity: 1, daily_rate: 0, gross_amount: '', discount_amount: 0, net_amount: '',
  payment_date: '', payment_method: 'pix', proof_url: '', status: 'pago', observation: '',
};

function CurrencyInput({ value, onChange }) {
  const fmt = (v) => { const n = Number(v); return (v || v === 0) && !isNaN(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''; };
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]);
  const parse = (s) => { const cleaned = String(s).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, ''); return cleaned ? Number(cleaned) : ''; };
  return (
    <Input inputMode="decimal" value={text} placeholder="0,00"
      onFocus={() => { setFocused(true); setText(value ? String(value).replace('.', ',') : ''); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => { setText(e.target.value); onChange(parse(e.target.value)); }} />
  );
}

export default function PaymentForm({ open, onOpenChange, employee, onSaved, editing = null }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => {
    if (open) {
      const init = editing ? { ...empty, ...editing } : { ...empty, payment_date: new Date().toISOString().slice(0, 10) };
      if (employee && !editing) {
        init.employee_id = employee.id; init.employee_name = employee.name;
        init.sector = employee.sector || ''; init.function = employee.function || '';
      }
      setForm(init);
    }
  }, [open, editing, employee]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set('proof_url', file_url);
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!form.employee_id || !form.net_amount) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        gross_amount: Number(form.gross_amount) || 0,
        discount_amount: Number(form.discount_amount) || 0,
        net_amount: Number(form.net_amount) || 0,
        daily_rate: Number(form.daily_rate) || 0,
        days_quantity: Number(form.days_quantity) || 1,
        responsible_user: form.responsible_user || currentUserName(),
      };
      let saved;
      if (editing?.id) saved = await base44.entities.EmployeePayment.update(editing.id, payload);
      else saved = await base44.entities.EmployeePayment.create(payload);
      await logAudit({ entity_type: 'EmployeePayment', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: `${payload.net_amount}`, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };

  const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? 'Editar pagamento' : 'Novo pagamento'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1"><Label className="text-xs">Colaborador</Label>
            <Input value={form.employee_name} disabled className="bg-slate-50" />
          </div>
          <div className="space-y-1"><Label className="text-xs">Tipo de pagamento</Label>
            <select className={inputCls} value={form.payment_type} onChange={(e) => set('payment_type', e.target.value)}>
              {Object.entries(PAYMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Data do pagamento</Label><Input type="date" value={form.payment_date || ''} onChange={(e) => set('payment_date', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Início referência</Label><Input type="date" value={form.reference_start || ''} onChange={(e) => set('reference_start', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Fim referência</Label><Input type="date" value={form.reference_end || ''} onChange={(e) => set('reference_end', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Valor bruto</Label><CurrencyInput value={form.gross_amount} onChange={(v) => set('gross_amount', v)} /></div>
          <div className="space-y-1"><Label className="text-xs">Descontos</Label><CurrencyInput value={form.discount_amount} onChange={(v) => set('discount_amount', v)} /></div>
          <div className="space-y-1"><Label className="text-xs">Valor líquido *</Label><CurrencyInput value={form.net_amount} onChange={(v) => set('net_amount', v)} /></div>
          <div className="space-y-1"><Label className="text-xs">Forma de pagamento</Label>
            <select className={inputCls} value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Observação</Label><Textarea rows={2} value={form.observation || ''} onChange={(e) => set('observation', e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Comprovante</Label>
            <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
                <Upload className="w-4 h-4" /> {uploading ? 'Enviando...' : form.proof_url ? 'Trocar arquivo' : 'Selecionar arquivo'}
              </Button>
              {form.proof_url && <a href={form.proof_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 underline">Ver comprovante ✓</a>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.employee_id || !form.net_amount}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}