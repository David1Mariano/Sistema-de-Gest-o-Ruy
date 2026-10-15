import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Plus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/delivery/money';
import { CHANNELS } from '@/lib/delivery/deliveryRules';
import { DEMO_ORDERS, DEMO_DRIVERS } from '@/lib/delivery/deliverySeed';
import { kpisOf, downloadCsv, Kpi } from '@/lib/delivery/deliveryPanel';
import { useMemo } from 'react';
import PedidosTab from '@/components/delivery/PedidosTab';
import { NovoPedidoDialog } from '@/components/delivery/NovoPedidoDialog';
import { EntregadoresTab, FinanceiroTab } from '@/components/delivery/DeliveryTabs1';
import { PlanilhasTab, ClientesTab } from '@/components/delivery/DeliveryTabs2';
import { CardapioTab, IntegracoesTab } from '@/components/delivery/DeliveryTabs3';

const TABS = [['painel', 'Painel'], ['pedidos', 'Pedidos'], ['entregadores', 'Entregadores'], ['financeiro', 'Financeiro'], ['planilhas', 'Planilhas'], ['clientes', 'Clientes'], ['cardapio', 'Cardápio'], ['integracoes', 'Integrações']];
const COLORS = ['#f59e0b', '#0ea5e9', '#10b981', '#8b5cf6', '#ef4444', '#64748b'];

export default function Delivery() {
  const [tab, setTab] = useState('painel');
  const [orders, setOrders] = useState(DEMO_ORDERS);
  const [drivers] = useState(DEMO_DRIVERS);
  const [open, setOpen] = useState(false);
  const kpis = useMemo(() => kpisOf(orders), [orders]);
  const porCanal = useMemo(() => {
    const m = {};
    orders.filter((o) => o.status !== 'cancelado').forEach((o) => { m[o.channel] = (m[o.channel] || 0) + o.gross_cents; });
    return Object.entries(m).map(([name, value]) => ({ name: CHANNELS[name] || name, value: Math.round(value / 100) }));
  }, [orders]);
  const topProdutos = useMemo(() => {
    const m = {};
    orders.filter((o) => o.status !== 'cancelado').forEach((o) => o.items.forEach((i) => { m[i.product_name] = (m[i.product_name] || 0) + i.qty; }));
    return Object.entries(m).map(([name, qtd]) => ({ name, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 6);
  }, [orders]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Delivery</h2>
          <p className="text-xs text-slate-500">Dados sintéticos de laboratório.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCsv('delivery-pedidos.csv', ['ID', 'Data', 'Cliente', 'Canal', 'Status', 'Bruto', 'Líquido'], orders.map((o) => [o.id, o.created_date.slice(0, 10), o.customer_name, o.channel, o.status, brl(o.gross_cents), brl(o.net_cents)]))}><Download className="h-4 w-4" /> CSV</Button>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Novo pedido</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl border bg-white p-1">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-2 text-sm font-medium ${tab === k ? 'bg-amber-500 text-slate-950' : 'text-slate-600 hover:bg-slate-100'}`}>{l}</button>
        ))}
      </div>
      {tab === 'painel' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Faturamento" value={brl(kpis.faturamento)} hint="Bruto ≠ caixa" />
            <Kpi label="Líquido estimado" value={brl(kpis.liquido)} hint="Após taxas" />
            <Kpi label="Pedidos" value={kpis.pedidos} hint={`${kpis.cancelados} cancelados`} />
            <Kpi label="Ticket médio" value={brl(kpis.ticket)} />
            <Kpi label="Taxa iFood" value="27%" hint="Sobre o bruto" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <p className="mb-2 text-sm font-semibold">Vendas por canal (R$)</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart><Pie data={porCanal} dataKey="value" nameKey="name" outerRadius={80} label>{porCanal.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl border bg-white p-4">
              <p className="mb-2 text-sm font-semibold">Top produtos (qtd)</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topProdutos}><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} height={60} /><YAxis /><Tooltip /><Bar dataKey="qtd" fill="#f59e0b" /></BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      {tab === 'pedidos' && <PedidosTab orders={orders} setOrders={setOrders} />}
      {tab === 'entregadores' && <EntregadoresTab drivers={drivers} orders={orders} />}
      {tab === 'financeiro' && <FinanceiroTab orders={orders} />}
      {tab === 'planilhas' && <PlanilhasTab orders={orders} />}
      {tab === 'clientes' && <ClientesTab />}
      {tab === 'cardapio' && <CardapioTab />}
      {tab === 'integracoes' && <IntegracoesTab orders={orders} setOrders={setOrders} />}
      <NovoPedidoDialog open={open} onClose={() => setOpen(false)} onSaved={(o) => { setOrders((x) => [o, ...x]); setOpen(false); }} />
    </div>
  );
}
