import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DOC_CATEGORIES } from '@/lib/rhUtils';
import { Upload } from 'lucide-react';

const empty = { name: '', category: 'outros', date: '', file_url: '' };

export default function DocumentForm({ open, onOpenChange, employee, onSaved }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { if (open) setForm({ ...empty, date: new Date().toISOString().slice(0, 10) }); }, [open]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      set('file_url', file_url);
      if (!form.name) set('name', file.name);
    } finally { setUploading(false); }
  };

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = { employee_id: employee.id, employee_name: employee.name, ...form, uploaded_by: currentUserName() };
      const saved = await base44.entities.EmployeeDocument.create(payload);
      await logAudit({ entity_type: 'EmployeeDocument', entity_id: saved.id, action: 'criacao', new_value: form.name, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Anexar documento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <div className="space-y-1"><Label className="text-xs">Nome *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Categoria</Label>
            <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {Object.entries(DOC_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Data</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></div>
          <div className="space-y-1">
            <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
              <Upload className="w-4 h-4" /> {uploading ? 'Enviando...' : form.file_url ? 'Trocar arquivo' : 'Selecionar arquivo'}
            </Button>
            {form.file_url && <p className="text-xs text-emerald-600 mt-1">Arquivo anexado ✓</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.name}>{saving ? 'Salvando...' : 'Anexar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}