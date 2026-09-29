import { Button } from '@/components/ui/button';
import { MANYCHAT_STATES, SOCIAL_CHANNELS, manyChatState } from '@/lib/social/integrations';

const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : '—';
const errors = { AUTHENTICATION_FAILED: 'Autenticação recusada', FORBIDDEN: 'Acesso recusado', RATE_LIMITED: 'Limite de requisições', TIMEOUT: 'Tempo de resposta excedido', NETWORK_ERROR: 'Serviço indisponível', NOT_CONFIGURED: 'Configuração backend necessária' };
export default function ManyChatCard({ health, canConfigure }) {
  return <section className="rounded-xl border bg-white p-5 space-y-3" aria-label="Integração ManyChat">
    <h3 className="font-semibold">ManyChat</h3>
    <p className="text-sm">{MANYCHAT_STATES[manyChatState(health)]}</p>
    <p className="text-sm text-slate-500">Ponte de comunicação. A Central Redes Sociais permanece como sistema principal.</p>
    <dl className="text-xs space-y-2"><div><dt>Última sincronização</dt><dd>{dateLabel(health?.last_synced_at)}</dd></div><div><dt>Canais detectados</dt><dd>{(health?.channels || []).filter(c => Object.hasOwn(SOCIAL_CHANNELS, c)).map(c => SOCIAL_CHANNELS[c]).join(', ') || 'Não detectados'}</dd></div><div><dt>Último evento</dt><dd>{dateLabel(health?.last_event_at)}</dd></div><div><dt>Último erro</dt><dd>{health?.error_code ? errors[health.error_code] || 'Requer atenção' : '—'}</dd></div></dl>
    <Button variant="outline" disabled>Configurar ManyChat</Button>
    <p className="text-xs text-slate-500">{canConfigure ? 'Configuração backend necessária' : 'Configuração restrita a administradores.'}</p>
    <p className="text-xs text-amber-800">Responder automaticamente via ManyChat: OFF</p>
  </section>;
}
