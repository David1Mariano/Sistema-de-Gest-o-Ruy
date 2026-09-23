import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save, Clock, ShieldCheck } from 'lucide-react';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';

export default function Configuracoes() {
  const [settings, setSettings] = useState(null);
  const [tolerance, setTolerance] = useState(5);
  const [coverage, setCoverage] = useState('{}');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const list = await base44.entities.SystemSettings.list('-created_date', 10);
    if (list.length) {
      setSettings(list[0]);
      setTolerance(list[0].tolerance_minutes ?? 5);
      setCoverage(list[0].coverage_config || '{}');
    } else {
      setSettings(null);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { tolerance_minutes: Number(tolerance), coverage_config: coverage, company_name: 'RUY GESTÃO' };
      let saved;
      if (settings?.id) {
        saved = await base44.entities.SystemSettings.update(settings.id, payload);
        await logAudit({ entity_type: 'SystemSettings', entity_id: settings.id, action: 'alteracao', field: 'tolerance_minutes', old_value: settings.tolerance_minutes, new_value: tolerance, responsible_user: currentUserName() });
      } else {
        saved = await base44.entities.SystemSettings.create(payload);
        await logAudit({ entity_type: 'SystemSettings', entity_id: saved.id, action: 'criacao', new_value: tolerance, responsible_user: currentUserName() });
      }
      setSettings(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-slate-500">Parâmetros administrativos do sistema de jornada</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="w-4 h-4 text-amber-500" /> Tolerância de atraso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label>Minutos de tolerância</Label>
              <Input type="number" min={0} className="w-32" value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            </div>
            <p className="text-xs text-slate-500 pb-2">
              Registros com atraso acima deste valor serão destacados. Configuração administrativa — não aplica regras legais automaticamente.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Cobertura mínima por setor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Configuração (JSON: setor → mínimo)</Label>
          <Textarea
            rows={4}
            className="font-mono text-xs"
            placeholder='{"Atendimento": 6, "Caixa": 3}'
            value={coverage}
            onChange={(e) => setCoverage(e.target.value)}
          />
          <p className="text-xs text-slate-500">Define o número mínimo de colaboradores por setor usado no quadro de cobertura.</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar configurações'}
        </Button>
      </div>
    </div>
  );
}