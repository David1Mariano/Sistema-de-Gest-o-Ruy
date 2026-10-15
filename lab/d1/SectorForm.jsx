import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { sectorKey, employeesOfSector } from '@/lib/sectorUtils';

// Formulário do LABORATÓRIO D1 (etapa D1.1). Diverge do oficial
// (src/components/rh/SectorForm.jsx) só no fluxo de renomeação: renomear um setor
// com vínculos agora é permitido, mas exige confirmação explícita do impacto.
// O servidor continua sendo a autoridade: revalida a contagem e só aplica a
// cascata na mesma transação.
const empty = { name: '', description: '', role_purpose: '', responsible_name: '', status: 'ativo' };

export default function SectorForm({ open, onOpenChange, editing = null, onSaved, employees = [] }) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  // Impacto de renomeação pendente de confirmação (null = nada a confirmar).
  const [impact, setImpact] = useState(null);
  useEffect(() => { if (open) { setForm(editing ? { ...empty, ...editing } : empty); setImpact(null); } }, [open, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (confirmed = false) => {
    if (!form.name?.trim()) return;
    // D1.1: detecta renomeação de setor com vínculos e pausa para confirmação.
    if (editing?.id && !confirmed && sectorKey(form.name) !== sectorKey(editing.name)) {
      const cols = employeesOfSector(employees, editing).length;
      const roles = await base44.entities.JobRole.list('-created_date', 1000);
      const funs = roles.filter((r) => sectorKey(r.sector_name) === sectorKey(editing.name)).length;
      if (cols > 0 || funs > 0) { setImpact({ cols, funs }); return; }
    }
    setSaving(true);
    try {
      let saved;
      if (editing?.id) {
        // O 3º argumento carrega a confirmação; sem ela o servidor recusa 409.
        saved = await base44.entities.Sector.update(editing.id, form, confirmed
          ? { confirmRename: true, renameImpact: { colaboradores: impact?.cols ?? 0, funcoes: impact?.funs ?? 0 } }
          : undefined);
      } else {
        saved = await base44.entities.Sector.create(form);
      }
      await logAudit({ entity_type: 'Sector', entity_id: saved.id, action: editing ? 'alteracao' : 'criacao', new_value: form.name, responsible_user: currentUserName() });
      setImpact(null);
      onSaved?.(saved); onOpenChange?.(false);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Editar setor' : 'Novo setor'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-2">
          <div className="space-y-1"><Label className="text-xs">Nome *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Sobre o setor</Label><Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="O que esse setor faz na empresa" /></div>
          <div className="space-y-1"><Label className="text-xs">Função na empresa</Label><Textarea rows={2} value={form.role_purpose} onChange={(e) => set('role_purpose', e.target.value)} placeholder="Qual o papel/função desse setor na operação" /></div>
          <div className="space-y-1"><Label className="text-xs">Responsável</Label>
            <Input value={form.responsible_name} onChange={(e) => set('responsible_name', e.target.value)} placeholder="Nome do responsável" />
          </div>
          <div className="space-y-1"><Label className="text-xs">Status</Label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
            </select>
          </div>
        </div>

        {/* D1.1: diálogo de impacto exibido ANTES de renomear setor com vínculos. */}
        {impact && (
          <div role="alertdialog" aria-labelledby="d1-rename-title" className="rounded-md border border-amber-400 bg-amber-50 p-4 space-y-3" data-testid="d1-rename-impact">
            <p id="d1-rename-title" className="font-semibold text-amber-900">Renomear setor com vínculos?</p>
            <p className="text-sm text-amber-900">
              O setor <strong>{editing?.name}</strong> passará a se chamar <strong>{form.name}</strong>.
              Os vínculos atuais serão atualizados automaticamente:
            </p>
            <ul className="list-disc pl-5 text-sm text-amber-900">
              <li>{impact.cols} colaborador(es) vinculado(s)</li>
              <li>{impact.funs} função(ões) vinculada(s)</li>
            </ul>
            <p className="text-xs text-amber-800">Identificadores e demais dados são preservados. A operação é transacional: ou tudo é aplicado, ou nada é.</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setImpact(null)}>Cancelar</Button>
              <Button onClick={() => save(true)} disabled={saving}>{saving ? 'Renomeando...' : 'Confirmar renomeação'}</Button>
            </div>
          </div>
        )}

        {!impact && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancelar</Button>
            <Button onClick={() => save()} disabled={saving || !form.name?.trim()}>{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}