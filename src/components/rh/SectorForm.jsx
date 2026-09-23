import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const empty = { name: '', description: '', responsible_name: '', status: 'ativo' };

export default function SectorForm({ open, onOpenChange, editing = null, onSaved, employees = [] }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(editing ? { ...empty, ...editing } : empty); }, [open, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      let saved;
      if (editing?.id) saved = await base44.entities.Sector.update(editing.id, form);
      else saved = await base44.entities.Sector.create(form);
      await logAudit({ entity_type: 'Sector', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: form.name, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Editar setor' : 'Novo setor'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <div className="space-y-1"><Label className="text-xs">Nome *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Descrição</Label><Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Responsável</Label>
            <Input value={form.responsible_name} onChange={(e) => set('responsible_name', e.target.value)} placeholder="Nome do responsável" />
          </div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.name?.trim()}>{saving ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}