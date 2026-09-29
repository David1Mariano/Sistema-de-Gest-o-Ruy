import { useState } from 'react';
import { originLabel } from '@/lib/social/integrations';
import { inPeriod } from '@/lib/social/domain';

export default function SocialMessages({ messages = [], range }) {
  const [channel, setChannel] = useState('all');
  const rows = messages.filter(m => m.kind === 'message' && inPeriod(m.created_at, range) && (channel === 'all' || m.channel === channel)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return <section className="rounded-xl border bg-white p-5 space-y-3">
    <h2 className="font-semibold">Mensagens privadas</h2>
    <label className="text-sm">Canal de mensagens <select className="rounded border p-2" value={channel} onChange={e => setChannel(e.target.value)}><option value="all">Todos</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="whatsapp">WhatsApp</option></select></label>
    <p className="text-xs text-slate-500">DM, Messenger e WhatsApp ficam separados dos comentários públicos e de suas métricas.</p>
    {!rows.length ? <p className="text-sm text-slate-500">Nenhuma mensagem privada recebida.</p> : rows.map(m => <article className="rounded border p-3 space-y-2" key={m.id}><h3 className="text-sm font-medium">{originLabel(m)} · Mensagem privada</h3><p className="text-xs">{m.author_name || 'Contato'} · {new Date(m.created_at).toLocaleString('pt-BR')}</p><p className="whitespace-pre-wrap break-words">{m.text}</p><p className="text-xs text-amber-800">Envio por ManyChat não disponível para este canal.</p></article>)}
  </section>;
}
