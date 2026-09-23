import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { duplicateWeek } from '@/lib/escalaData';
import { currentUserName } from '@/lib/useCurrentUser';
import { startOfWeek, addDays, formatBR } from '@/lib/timeUtils';

export default function DuplicarEscala({ open, onOpenChange, existingForDest, onDone }) {
  const [src, setSrc] = useState(startOfWeek(addDays(startOfWeek(new Date().toISOString().slice(0, 10)), -7)));
  const [dst, setDst] = useState(startOfWeek(new Date().toISOString().slice(0, 10)));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setSaving(true);
    setResult(null);
    try {
      const count = await duplicateWeek(src, dst, existingForDest, currentUserName());
      setResult(`${count} escalas duplicadas.`);
      onDone?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duplicar escala (copiar semana)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Semana de origem (domingo)</Label>
            <input type="date" value={src} onChange={(e) => setSrc(e.target.value)} className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" />
            <p className="text-xs text-slate-500">De {formatBR(src)} a {formatBR(addDays(src, 6))}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Semana de destino (domingo)</Label>
            <input type="date" value={dst} onChange={(e) => setDst(e.target.value)} className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm" />
            <p className="text-xs text-slate-500">De {formatBR(dst)} a {formatBR(addDays(dst, 6))}</p>
          </div>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Escalas conflitantes no destino serão puladas (não substituídas sem confirmação).
          </p>
          {result && <p className="text-sm text-emerald-600 font-medium">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Fechar</Button>
          <Button onClick={run} disabled={saving}>{saving ? 'Duplicando...' : 'Duplicar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}