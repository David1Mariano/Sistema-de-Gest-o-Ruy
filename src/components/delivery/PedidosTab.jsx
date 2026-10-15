import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { brl } from '@/lib/delivery/money';
import { STATUS_LABEL, CHANNELS } from '@/lib/delivery/deliveryRules';

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function PedidosTab({ orders, setOrders }) {
  const [q, setQ] = useState('');
  const [canal, setCanal] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const list = orders.filter((o) =>
    (!q || o.customer_name.toLowerCase().includes(q.toLowerCase()) || o.id.includes(q)) &&
    (!canal || o.channel === canal) && (!status || o.status === status));
  const avancar = (id) => {
    const next = { novo: 'preparo', preparo: 'expedicao', expedicao: 'entregue', entregue: 'recebido' };
    setOrders((xs) => xs.map((o) => (o.id === id && next[o.status] ? { ...o, status: next[o.status] } : o)));
  };
  const cancelar = (id) => {
    const motivo = window.prompt('Motivo do cancelamento (obrigatório, vai p/ auditoria):');
    if (!motivo) { setErr('Cancelamento exige motivo.'); return; }
    setErr('');
    setOrders((xs) => xs.map((o) => (o.id === id ? { ...o, status: 'cancelado', cancel_reason: motivo } : o)));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar cliente ou nº..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={inputCls + ' w-40'} value={canal} onChange={(e) => setCanal(e.target.value)}>
          <option value="">Todos canais</option>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={inputCls + ' w-40'} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {err && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-3 text-left">Pedido</th><th className="px-4 py-3 text-left">Cliente</th><th className="px-4 py-3 text-left">Canal</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Bruto</th><th className="px-4 py-3 text-right">Líquido est.</th><th className="px-4 py-3 text-right">Ações</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-mono text-xs">#{o.id}<br /><span className="text-slate-400">{o.created_date.slice(0, 10)}</span></td>
                <td className="px-4 py-3 font-medium">{o.customer_name}<br /><span className="text-xs text-slate-400">{o.payment_method}</span></td>
                <td className="px-4 py-3">{CHANNELS[o.channel] || o.channel}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{STATUS_LABEL[o.status]}</span></td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(o.gross_cents)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{brl(o.net_cents)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {['novo', 'preparo', 'expedicao', 'entregue'].includes(o.status) && <Button size="sm" variant="outline" onClick={() => avancar(o.id)}>Avançar</Button>}
                    {!['recebido', 'cancelado'].includes(o.status) && <Button size="sm" variant="outline" className="text-red-600" onClick={() => cancelar(o.id)}>Cancelar</Button>}
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Sem pedidos no filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
