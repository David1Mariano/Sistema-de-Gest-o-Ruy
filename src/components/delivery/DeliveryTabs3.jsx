import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/delivery/money';
import { CHANNEL_FEE_PCT, suggestedPrice } from '@/lib/delivery/deliveryRules';
import { CONNECTORS, parseChannelCsv, dedupImport } from '@/lib/delivery/channelConnectors';
import { DEMO_MENU } from '@/lib/delivery/deliverySeed';

export function CardapioTab() {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Produto</th><th className="px-4 py-3 text-right">Base</th><th className="px-4 py-3 text-right">iFood (+27%)</th><th className="px-4 py-3 text-right">99 (+18%)</th><th className="px-4 py-3 text-right">Margem est.</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {DEMO_MENU.map((m) => (
            <tr key={m.id}><td className="px-4 py-3 font-medium">{m.name}</td><td className="px-4 py-3 text-right tabular-nums">{brl(m.base_cents)}</td><td className="px-4 py-3 text-right tabular-nums">{brl(suggestedPrice(m.base_cents, 'ifood'))}</td><td className="px-4 py-3 text-right tabular-nums">{brl(suggestedPrice(m.base_cents, 'food99'))}</td><td className="px-4 py-3 text-right tabular-nums text-emerald-700">{brl(m.base_cents - m.cost_cents)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="border-t p-3 text-xs text-slate-500">Sugestão calculada — nenhum preço real é alterado automaticamente.</p>
    </div>
  );
}

export function IntegracoesTab({ orders, setOrders }) {
  const [txt, setTxt] = useState('external_id;data;cliente;telefone;canal;item;qtd;preco;taxa_entrega;desconto;pagamento\nIF-1001;2026-10-15;Demo CSV;11999990009;ifood;Caldo de cana 500ml;1;10,10;5,00;0;pix');
  const [msg, setMsg] = useState('');
  const importar = () => {
    const { rows, errors } = parseChannelCsv(txt);
    if (errors.length) { setMsg(errors.join(' ')); return; }
    const { fresh, skipped } = dedupImport(rows, orders.map((o) => o.external_id).filter(Boolean));
    const novos = fresh.map((r, k) => ({ id: `csv${Date.now().toString(36)}${k}`, external_id: r.external_id, created_date: `${r.data}T12:00:00`, customer_name: r.cliente, channel: r.canal || 'ifood', fulfillment: 'entrega', status: 'novo', payment_method: r.pagamento || 'pix', items: [{ product_name: r.item, qty: r.qty, unit_price_cents: r.unit_price_cents }], gross_cents: r.qty * r.unit_price_cents, discount_cents: 0, delivery_fee_cents: 500, platform_fee_cents: 0, net_cents: r.qty * r.unit_price_cents + 500 }));
    setOrders((xs) => [...novos, ...xs]);
    setMsg(`Importados ${novos.length}; duplicados ignorados: ${skipped.length}.`);
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(CONNECTORS).map(([k, c]) => (
          <div key={k} className="rounded-xl border bg-white p-4">
            <p className="font-semibold">{c.label} <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase">demo</span></p>
            <p className="mt-1 text-xs text-slate-500">{c.note}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm font-semibold">Importar CSV do canal (com conferência)</p>
        <textarea className="mt-2 h-28 w-full rounded-md border p-2 font-mono text-xs" value={txt} onChange={(e) => setTxt(e.target.value)} />
        <div className="mt-2"><Button size="sm" onClick={importar}>Conferir e importar</Button></div>
        {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
        <p className="mt-1 text-xs text-slate-400">iFood {CHANNEL_FEE_PCT.ifood}% · 99Food {CHANNEL_FEE_PCT.food99}%</p>
      </div>
    </div>
  );
}
