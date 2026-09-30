import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
// MERGE (Fase 9): imports dos DOIS lados. A main trouxe o tema (Sun/Moon e
// useTheme); a branch social brought Tabs, useUserRole e o painel de acessos.
// Nenhum dos dois foi descartado.
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Save, Clock, ShieldCheck, Sun, Moon, MonitorSmartphone } from 'lucide-react';
import { logAudit } from '@/lib/pontoUtils';
import { currentUserName } from '@/lib/useCurrentUser';
import { useUserRole } from '@/lib/useUserRole';
import { useTheme } from '@/lib/theme/ThemeProvider';
import SocialAccessAdmin from '@/components/social/SocialAccessAdmin';
import { createSocialAccessClient } from '@/lib/social/aiClient';
import { supabaseAuth } from '@/lib/supabaseClient';


export default function Configuracoes() {
  const { isAdmin } = useUserRole();
  const [settings, setSettings] = useState(null);
  const [tolerance, setTolerance] = useState(5);
  const [coverage, setCoverage] = useState('{}');
  const [saving, setSaving] = useState(false);
  // MERGE (Fase 9): `accessClient` é da branch social; `tema/setTema` é da main.
  // Convivem sem conflito: um monta o cliente HTTP, o outro lê o contexto de tema.
  // Endpoint da API de acessos. Sem ele, o cliente falha fechado e a tela
  // mostra erro controlado em vez de fingir que está tudo vazio.
  const accessClient = useMemo(() => createSocialAccessClient({
    endpoint: import.meta.env.VITE_SOCIAL_ADMIN_ENDPOINT,
    getToken: async () => {
      try {
        const { data } = await supabaseAuth.getSession();
        return data?.session?.access_token ?? null;
      } catch {
        // Sem sessao nao ha token. O cliente segue sem `Authorization` e o
        // backend responde 401, que e a resposta correta.
        return null;
      }
    },
  }), []);
  // O tema NÃO é estado desta página: vem do contexto. Assim Configurações e o
  // layout nunca discordam sobre qual tema está ativo.
  const { tema, setTema } = useTheme();

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
        <p className="text-sm text-slate-500">Parâmetros administrativos do sistema</p>
      </div>

      {/* A tela de acessos entra como uma SEÇÃO de Configurações, com os mesmos
          Card/Alert/Badge do resto da tela. Sem palette própria e sem tema
          paralelo: se o sistema ganhar dark mode, o componente acompanha. */}
      <Tabs defaultValue="acesso">
        <TabsList>
          <TabsTrigger value="acesso">Redes Sociais</TabsTrigger>
          <TabsTrigger value="jornada">Jornada</TabsTrigger>
        </TabsList>
        <TabsContent value="acesso" className="mt-4 space-y-4">
          <SocialAccessAdmin
            client={accessClient}
            canConfigure={isAdmin}
            canAdmin={isAdmin}
          />
          <p className="text-xs text-slate-500">
            Conceder acesso aqui é a operação do dia a dia. Criar a estrutura de contas e acessos no banco é feito
            uma única vez pelo administrador do sistema.
          </p>
        </TabsContent>
        <TabsContent value="jornada" className="mt-4 space-y-5">
          {/* Aparência veio da main (tema claro/escuro). Fica na aba de jornada
              porque é preferência do navegador, não do domínio social. Convive
              com as Tabs da Fase 7: os dois lados do merge foram preservados. */}
          <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="w-4 h-4 text-amber-500" /> Aparência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            Vale para este navegador. A preferência fica salva aqui, no seu
            dispositivo — não é uma configuração do sistema e não muda o que
            outras pessoas veem.
          </p>
          <div
            role="radiogroup"
            aria-label="Tema da interface"
            className="flex gap-2">
            {[
              { valor: 'claro', rotulo: 'Claro', Icon: Sun },
              { valor: 'escuro', rotulo: 'Escuro', Icon: Moon },
              { valor: 'sistema', rotulo: 'Sistema', Icon: MonitorSmartphone },
            ].map(({ valor, rotulo, Icon }) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={tema === valor}
                onClick={() => setTema(valor)}
                className={
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ' +
                  (tema === valor
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-foreground'
                    : 'text-muted-foreground hover:bg-muted')
                }
              >
                <Icon className="h-4 w-4" />
                {rotulo}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="w-4 h-4 text-amber-500" /> Aparência
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            Vale para este navegador. A preferência fica salva aqui, no seu
            dispositivo — não é uma configuração do sistema e não muda o que
            outras pessoas veem.
          </p>
          <div
            role="radiogroup"
            aria-label="Tema da interface"
            className="grid gap-3 sm:grid-cols-2 max-w-md"
          >
            {[
              { valor: 'light', titulo: 'Modo Claro', descricao: 'Fundo claro, padrão do sistema', Icon: Sun },
              { valor: 'dark', titulo: 'Modo Escuro', descricao: 'Fundo escuro, mais confortável à noite', Icon: Moon },
            ].map(({ valor, titulo, descricao, Icon }) => {
              const ativo = tema === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={ativo}
                  onClick={() => setTema(valor)}
                  className={[
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                    ativo
                      ? 'border-foreground bg-accent'
                      : 'border-border bg-card hover:bg-accent',
                  ].join(' ')}
                >
                  <Icon className={ativo ? 'w-5 h-5 mt-0.5 shrink-0' : 'w-5 h-5 mt-0.5 shrink-0 text-slate-500'} />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{titulo}</span>
                    <span className="block text-xs text-slate-500">{descricao}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
        </TabsContent>
      </Tabs>
    </div>
  );
}