const names = { loja: 'Loja', delivery_proprio: 'Delivery próprio', ifood: 'iFood', '99food': '99Food', brendi: 'Brendi', whatsapp: 'WhatsApp', outro: 'Outros' };
const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function DirectionChannels({ channels }) {
  const maximum = channels[0]?.[1] || 1;
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="mb-4"><h2 className="font-semibold">Receita líquida por canal</h2><p className="mt-1 text-xs text-muted-foreground">Participação no mês atual</p></div>
      {channels.length ? <div className="space-y-4">{channels.slice(0, 6).map(([channel, amount]) => <div key={channel}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span>{names[channel] || channel}</span><strong>{money(amount)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, amount / maximum * 100)}%` }} /></div></div>)}</div> : <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma receita registrada neste mês.</p>}
    </section>
  );
}