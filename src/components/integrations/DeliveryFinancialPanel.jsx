import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeliverySession } from './DeliveryAccess';
import { deliveryCall } from '@/lib/integrations/deliveryClient';
import { deliveryStatus, deliverySyncStatus } from '@/lib/integrations/deliveryStatus';
import { moneyOrUnknown, summarizeDelivery } from '@/lib/integrations/deliverySummary';
import { cashToday, cashMoney, entryTotal } from '@/lib/cashMovementUtils';

export default function DeliveryFinancialPanel({ movements = [], readOnly = false }) {
  const session = useDeliverySession();
  const [date, setDate] = useState(cashToday()), [channel, setChannel] = useState('all'), [result, setResult] = useState(null), [status, setStatus] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true; setResult(null); setStatus(null); setError('');
    if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setBusy(false); return undefined; }
    setBusy(true);
    (async () => {
      try {
        const from = new Date(`${date}T00:00:00-03:00`), to = new Date(from.getTime() + 86400000);
        const rows = []; let offset = 0;
        do {
          const page = await deliveryCall('orders', { from: from.toISOString(), to: to.toISOString(), offset });
          rows.push(...page.rows); offset = page.nextOffset;
          if (offset > 10000) throw new Error('Período excede o limite de exibição. Os totais não foram calculados.');
        } while (offset !== null && live);
        const state = await deliveryCall('status');
        if (live) { setResult(rows); setStatus(state); }
      } catch (e) { if (live) setError(e.message); }
      finally { if (live) setBusy(false); }
    })();
    return () => { live = false; };
  }, [session, date, reload]);
  const visible = (result || []).filter(row => channel === 'all' || row.platform === channel);
  const totals = summarizeDelivery(visible);
  const ifood = status?.integrations?.find(row => row.platform === 'ifood');
  const showImported = Boolean(ifood?.last_sync_at || visible.length);
  const own = movements.filter(m => m.source === 'delivery' && m.channel === 'delivery_proprio' && m.date === date);
  const link = async (row, id) => {
    if (!id) return;
    setBusy(true); setError('');
    try { await deliveryCall('link', { platform: row.platform, merchantId: row.merchant_id, externalId: row.external_id, cashMovementId: id }); setReload(v => v + 1); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="my-4 rounded-xl border bg-white p-4 space-y-3 text-slate-900">
    <div className="flex flex-wrap gap-2 items-center justify-between"><h3 className="font-semibold">Delivery · conferência das plataformas</h3><Link to="/Configuracoes" className="text-sm underline">Configurar integrações</Link></div>
    <p className="text-xs text-slate-600">Dados lançados e gerenciados exclusivamente no Financeiro. Pedidos importados não são somados aos caixas ou às receitas oficiais. Vincule-os ao movimento existente após conferir os valores.</p>
    <div className="flex flex-wrap gap-2"><Input aria-label="Dia dos pedidos" type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" /><select aria-label="Canal de delivery" className="border rounded px-2" value={channel} onChange={e => setChannel(e.target.value)}><option value="all">Todos os canais (separados)</option><option value="delivery_proprio">Delivery próprio</option><option value="ifood">iFood</option><option value="99food">99Food</option></select><Button variant="outline" disabled={!session || busy} onClick={() => setReload(v => v + 1)}>Atualizar leitura</Button></div>
    {!session && <p className="text-sm text-amber-800">Verifique seu acesso em Configurações para consultar os pedidos importados.</p>}
    {['all', 'ifood'].includes(channel) && <p className="text-sm">iFood: {deliveryStatus('ifood', status)} · {deliverySyncStatus('ifood', status)}. Valores importados exclusivos deste canal.</p>}
    {busy && <p role="status">Carregando dados de delivery...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {['all','delivery_proprio'].includes(channel) && <p className="text-sm">Delivery próprio — entradas já lançadas: <strong>{cashMoney(own.reduce((n, m) => n + entryTotal(m), 0))}</strong>. Quantidade de pedidos não disponível nos lançamentos diários.</p>}
    {['all', '99food'].includes(channel) && <p className="text-amber-800 text-sm">AGUARDANDO HOMOLOGAÇÃO/CREDENCIAIS 99FOOD</p>}
    {result && !error && !busy && ['all', 'ifood'].includes(channel) && showImported && <>
      <p className="text-xs">Consulta do dia selecionado; histórico anterior não garantido. 99Food não sincronizada. {status?.integrations.filter(i => i.platform === 'ifood').map(i => <span key={i.platform}>iFood: {deliveryStatus('ifood', status)} · última sincronização {i.last_sync_at ? new Date(i.last_sync_at).toLocaleString('pt-BR') : 'não realizada'}.</span>)}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">{[['Pedidos recebidos',totals.orders],['Concluídos',totals.completed],['Cancelados',totals.cancelled],['Ticket médio (cliente)',moneyOrUnknown(totals.average)],['Bruto dos concluídos',moneyOrUnknown(totals.gross)],['Descontos',moneyOrUnknown(totals.discounts)],['Taxas da plataforma',moneyOrUnknown(totals.fees)],['Líquido do restaurante',moneyOrUnknown(totals.net)]].map(([name,value]) => <div className="bg-slate-50 rounded p-2" key={name}><p className="text-xs text-slate-500">{name}</p><strong>{value}</strong></div>)}</div>
      <p className="text-xs">Recebíveis, estornos e repasses: não disponíveis nesta etapa. Valor do pedido não comprova recebimento bancário.</p>
      {!readOnly && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Plataforma / pedido','Status','Valor do cliente','Pagamento informado','Conferência financeira'].map(h => <th className="text-left p-2" key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={`${row.platform}:${row.merchant_id}:${row.external_id}`} className="border-t"><td className="p-2">{row.platform} · {row.data.number || row.external_id}</td><td className="p-2">{row.data.status}</td><td className="p-2">{moneyOrUnknown(row.data.money.customer_total)}</td><td className="p-2">{row.data.payments?.map(p => `${p.method} (${p.type})`).join(', ') || 'Não disponível'}</td><td className="p-2">{row.cash_movement_id ? `Vinculado: ${row.cash_movement_id}` : <select aria-label={`Vincular pedido ${row.data.number || row.external_id}`} value="" onChange={e => link(row, e.target.value)} disabled={busy} className="border rounded p-1"><option value="">Vincular ao lançamento existente</option>{movements.filter(m => m.source === 'delivery' && m.channel === row.platform && m.date === date).map(m => <option key={m.id} value={m.id}>{m.operator_name || m.id} · {cashMoney(entryTotal(m))}</option>)}</select>}</td></tr>)}</tbody></table>{!visible.length && <p className="text-sm py-2">Nenhum pedido importado neste período. Isso não confirma ausência de vendas na plataforma.</p>}</div>}
    </>}
  </section>;
}
