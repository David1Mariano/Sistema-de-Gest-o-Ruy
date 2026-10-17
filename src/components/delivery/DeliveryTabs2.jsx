import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { brl } from '@/lib/delivery/money';
import { CHANNELS, STATUS_LABEL, maskPhone } from '@/lib/delivery/deliveryRules';
import { DEMO_CUSTOMERS } from '@/lib/delivery/deliverySeed';
import { downloadCsv } from '@/lib/delivery/deliveryPanel';

// Planilhas: busca, ordenacao, totais, CSV, impressao/PDF. Gerada dos registros.
export function PlanilhasTab({ orders }) {
  const [ord, setOrd] = useState('data');
  const list = [...orders].sort((a, b) => ord === 'valor' ? b.gross_cents - a.gross_cents : b.created_date.localeCompare(a.created_date));
  const total = list.filter((o) => o.status !== 'cancelado').reduce((a, o) => a + o.gross_cents, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={ord === 'data' ? 'default' : 'outline'} onClick={() => setOrd('data')}>Por data</Button>
        <Button size="sm" variant={ord === 'valor' ? 'default' : 'outline'} onClick={() => setOrd('valor')}>Por valor</Button>
        <Button size="sm" variant="outline" onClick={() => window.print()}>Imprimir / PDF</Button>
        <Button size="sm" variant="outline" onClick={() => downloadCsv('delivery-relatorio.csv', ['ID', 'Data', 'Cliente', 'Canal', 'Status', 'Bruto', 'Liquido'], list.map((o) => [o.id, o.created_date.slice(0, 10), o.customer_name, CHANNELS[o.channel], STATUS_LABEL[o.status], brl(o.gross_cents), brl(o.net_cents)]))}>Exportar CSV</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Data</th><th className="px-4 py-3 text-left">Cliente</th><th className="px-4 py-3 text-left">Canal</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-right">Bruto</th><th className="px-4 py-3 text-right">Líquido</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((o) => <tr key={o.id}><td className="px-4 py-2">{o.created_date.slice(0, 10)}</td><td className="px-4 py-2">{o.customer_name}</td><td className="px-4 py-2">{CHANNELS[o.channel]}</td><td className="px-4 py-2">{STATUS_LABEL[o.status]}</td><td className="px-4 py-2 text-right tabular-nums">{brl(o.gross_cents)}</td><td className="px-4 py-2 text-right tabular-nums">{brl(o.net_cents)}</td></tr>)}
          </tbody>
          <tfoot className="bg-slate-50 font-bold"><tr><td colSpan={4} className="px-4 py-3">Total (exceto cancelados)</td><td className="px-4 py-3 text-right tabular-nums">{brl(total)}</td><td /></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// Clientes: historico, total gasto, LGPD (telefone mascarado).
export function ClientesTab() {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 text-left">Cliente</th><th className="px-4 py-3 text-left">Telefone (LGPD)</th><th className="px-4 py-3 text-right">Pedidos</th><th className="px-4 py-3 text-right">Total gasto</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {DEMO_CUSTOMERS.map((c) => <tr key={c.id}><td className="px-4 py-3 font-medium">{c.name}</td><td className="px-4 py-3">{maskPhone(c.phone)}</td><td className="px-4 py-3 text-right">{c.orders}</td><td className="px-4 py-3 text-right tabular-nums font-semibold">{brl(c.total_cents)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
