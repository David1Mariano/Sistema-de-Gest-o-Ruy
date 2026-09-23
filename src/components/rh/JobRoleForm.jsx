import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const empty = { name: '', sector_id: '', sector_name: '', status: 'ativo' };

export default function JobRoleForm({ open, onOpenChange, editing = null, onSaved, sectors = [] }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(editing ? { ...empty, ...editing } : empty); }, [open, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pickSector = (id) => {
    const s = sectors.find((x) => x.id === id);
    setForm((f) => ({ ...f, sector_id: id, sector_name: s?.name || '' }));
  };
  const save = async () => {
    if (!form.name?.trim()) return;
    setSaving(true);
    try {
      let saved;
      if (editing?.id) saved = await base44.entities.JobRole.update(editing.id, form);
      else saved = await base44.entities.JobRole.create(form);
      await logAudit({ entity_type: 'JobRole', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: form.name, responsible_user: currentUserName() });
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Editar função' : 'Nova função'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <div className="space-y-1"><Label className="text-xs">Nome da função *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Setor</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.sector_id} onChange={(e) => pickSector(e.target.value)}>
              <option value="">Selecione</option>{sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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