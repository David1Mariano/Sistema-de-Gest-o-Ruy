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

const empty = { employee_id: '', employee_name: '', date: '', amount: '', type: 'dinheiro', motive: '', payment_method: '', authorized_by: '', status: 'pendente', observation: '', proof_url: '' };

export default function ValeForm({ open, onOpenChange, employees = [], onSaved, editing = null }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { if (open) setForm(editing ? { ...empty, ...editing } : empty); }, [open, editing]);
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

  const pickEmployee = (id) => {
    const e = employees.find((x) => x.id === id);
    setForm((f) => ({ ...f, employee_id: id, employee_name: e?.name || '', sector: e?.sector || '' }));
  };

  const save = async () => {
    if (!form.employee_id || !form.date || !form.amount) return;
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), authorized_by: form.authorized_by || currentUserName() };
      let saved;
      if (editing?.id) saved = await base44.entities.Vale.update(editing.id, payload);
      else saved = await base44.entities.Vale.create(payload);
      await logAudit({ entity_type: 'Vale', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: `${payload.amount}`, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };

  const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? 'Editar vale' : 'Novo vale'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Funcionário *</Label>
            <select className={inputCls} value={form.employee_id} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">Selecione</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Data *</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Valor *</Label><Input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Tipo</Label>
            <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value)}>
              <option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="produto">Produto</option><option value="outros">Outros</option>
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Forma de pagamento</Label><Input value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Quem autorizou</Label><Input value={form.authorized_by} onChange={(e) => set('authorized_by', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="pendente">Pendente</option><option value="descontado">Descontado</option><option value="cancelado">Cancelado</option>
            </select>
          </div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Motivo</Label><Input value={form.motive} onChange={(e) => set('motive', e.target.value)} /></div>
          <div className="col-span-2 space-y-1"><Label className="text-xs">Observação</Label><Textarea rows={2} value={form.observation} onChange={(e) => set('observation', e.target.value)} /></div>
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
          <Button onClick={save} disabled={saving || !form.employee_id || !form.date || !form.amount}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}