import { brl } from '@/lib/delivery/money';

// Entregadores: cadastro, status, entregas, repasse, fechamento individual.
export function EntregadoresTab({ drivers, orders }) {
  const porEntregador = (name) => orders.filter((o) => o.driver === name && o.status !== 'cancelado');
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {drivers.map((d) => {
        const list = porEntregador(d.name);
        const repasse = list.length * d.fee_cents;
        return (
          <div key={d.id} className="rounded-xl border bg-white p-4">
            <div className="flex items-center gap-2">
              <p className="font-semibold">{d.name}</p>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${d.status === 'disponivel' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{d.status}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{list.length} entregas no período · {brl(d.fee_cents)}/entrega</p>
            <p className="mt-2 text-lg font-bold tabular-nums">{brl(repasse)}</p>
            <p className="text-xs text-slate-500">Repasse estimado + histórico individual</p>
          </div>
        );
      })}
    </div>
  );
}

// Financeiro: bruto x descontos x taxas x líquido x recebido x pendente.
// Nunca confunde faturamento com caixa.
export function FinanceiroTab({ orders }) {
  const ok = orders.filter((o) => o.status !== 'cancelado');
  const bruto = ok.reduce((a, o) => a + o.gross_cents, 0);
  const desc = ok.reduce((a, o) => a + (o.discount_cents || 0), 0);
  const plat = ok.reduce((a, o) => a + (o.platform_fee_cents || 0), 0);
  const entr = ok.reduce((a, o) => a + (o.delivery_fee_cents || 0), 0);
  const liq = ok.reduce((a, o) => a + o.net_cents, 0);
  const recebido = ok.filter((o) => o.status === 'recebido').reduce((a, o) => a + o.net_cents, 0);
  const rows = [['Bruto dos pedidos', bruto], ['(−) Descontos/cupons', -desc], ['(−) Taxas plataforma', -plat], ['(+) Taxas de entrega', entr], ['(=) Líquido estimado', liq], ['Recebido', recebido], ['Pendente', liq - recebido]];
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full min-w-[520px] text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map(([k, v]) => (
            <tr key={k}><td className="px-4 py-3 text-slate-600">{k}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{brl(v)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="border-t p-3 text-xs text-slate-500">Faturamento ≠ caixa: o líquido estimado ainda depende de repasse (iFood/99) e conciliação.</p>
    </div>
  );
}
