import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, RefreshCw, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DeliveryAccess, { useDeliverySession } from '@/components/integrations/DeliveryAccess';
import AttendanceCenter from '@/components/integrations/AttendanceCenter';
import CustomerDirectory from '@/components/integrations/CustomerDirectory';
import { deliveryCall } from '@/lib/integrations/deliveryClient';
import { deliveryStatus } from '@/lib/integrations/deliveryStatus';
import { moneyOrUnknown } from '@/lib/integrations/deliverySummary';
import { CHANNELS, ORDER_STATES, deliveryOrder, filterOrders, orderKey, orderMetrics } from '@/lib/delivery/domain';

const TABS = [['conversas', 'Conversas'], ['clientes', 'Clientes'], ['pedidos', 'Pedidos']];

export default function CentralDelivery() {
  const session = useDeliverySession();
  const [tab, setTab] = useState('conversas');
  const [snapshot, setSnapshot] = useState(null), [statusError, setStatusError] = useState('');
  // Escopos de atendimento (server-side) compartilhados entre as abas Conversas e Clientes.
  const [scopes, setScopes] = useState(null), [actorId, setActorId] = useState(null), [scopesError, setScopesError] = useState('');
  const [seed, setSeed] = useState({ text: '', nonce: 0 });
  // Aba Pedidos: consulta preservada da versão anterior.
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()));
  const [orderChannel, setOrderChannel] = useState('all'), [orderState, setOrderState] = useState('all'), [orderSearch, setOrderSearch] = useState('');
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    if (!session) { setSnapshot(null); setStatusError(''); return () => { active = false; }; }
    deliveryCall('status').then(result => { if (active) setSnapshot(result); })
      .catch(e => { if (active) setStatusError(e.message); });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;
    if (!session) { setScopes(null); setActorId(null); setScopesError(''); return () => { active = false; }; }
    deliveryCall('contact_scopes').then(result => {
      if (active) { setScopes(result.rows || []); setActorId(result.actorId || null); setScopesError(''); }
    }).catch(e => { if (active) setScopesError(e.message); });
    return () => { active = false; };
  }, [session]);
  useEffect(() => {
    let active = true;
    // Pedidos só são consultados quando a aba está aberta; status e escopos vêm dos efeitos acima.
    if (!session || tab !== 'pedidos' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return () => { active = false; };
    setRows(null); setError(''); setBusy(true);
    (async () => {
      try {
        const from = new Date(`${date}T00:00:00-03:00`), to = new Date(from.getTime() + 86400000);
        const orders = []; let offset = 0;
        do {
          const page = await deliveryCall('orders', { from: from.toISOString(), to: to.toISOString(), offset });
          if (!active) return;
          orders.push(...page.rows.map(deliveryOrder)); offset = page.nextOffset;
          if (orders.length > 10000) throw Error('Limite de consulta excedido. Não foram calculados totais parciais.');
        } while (offset !== null);
        setRows([...new Map(orders.map(order => [orderKey(order), order])).values()]);
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [session, date, reload, tab]);
  const channelRows = filterOrders(rows || [], { channel: orderChannel });
  const visible = filterOrders(channelRows, { status: orderState, search: orderSearch });
  const metrics = orderMetrics(channelRows);
  const synced = snapshot?.integrations?.some(row => (orderChannel === 'all' || row.platform === orderChannel) && row.last_sync_at);
  const known = rows !== null && !error && !busy && (synced || channelRows.length > 0);
  const cards = [['Pedidos no dia', metrics.orders], ['Vendas concluídas', moneyOrUnknown(metrics.sales)], ['Ticket médio', moneyOrUnknown(metrics.average)], ['Em preparo', metrics.preparing || 'Não informado'], ['Aguardando aceite', metrics.waiting], ['Cancelamentos', metrics.cancelled]];
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2"><ShoppingBag className="text-orange-600" /><h1 className="text-2xl font-bold text-slate-900">Central de Delivery</h1></div><p className="mt-1 text-sm text-slate-500">Atendimento, clientes e pedidos dos canais em um só lugar. Consulta operacional independente do caixa.</p></div>
      <Link to="/configuracoes" className="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm"><Settings size={16} /> Configurar integrações</Link>
    </header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(CHANNELS).map(([id, label]) => {
      const record = snapshot?.integrations?.find(row => row.platform === id);
      return <div key={id} className="rounded-xl border bg-white p-4"><h2 className="font-semibold">{label}</h2>
        <p className="mt-2 text-sm text-slate-600">{id === '99food' && snapshot?.food99Blocker ? snapshot.food99Blocker : deliveryStatus(id, snapshot)}</p>
        <p className="mt-1 text-xs text-slate-500">{record?.last_sync_at ? `Última sincronização: ${new Date(record.last_sync_at).toLocaleString('pt-BR')}` : 'Sem sincronização'}</p>
        {id !== 'ifood' && <p className="mt-1 text-xs text-slate-400">Canal sem envio de mensagens nesta fase.</p>}</div>;
    })}</div>
    {statusError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{statusError}</p>}
    <DeliveryAccess />
    <nav className="flex gap-2 border-b pb-2" aria-label="Seções da Central de Delivery">
      {TABS.map(([id, label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined}
        onClick={() => setTab(id)}
        className={`rounded-full px-4 py-2 text-sm ${tab === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{label}</button>)}
    </nav>
    {tab === 'conversas' && <AttendanceCenter session={session} scopes={scopes} actorId={actorId} scopesError={scopesError}
      aiConfigured={Boolean(snapshot?.aiConfigured)} seedSearch={seed.text} seedNonce={seed.nonce} />}
    {tab === 'clientes' && <CustomerDirectory session={session} scopes={scopes} scopesError={scopesError}
      onOpenCustomer={text => { setSeed(s => ({ text, nonce: s.nonce + 1 })); setTab('conversas'); }} />}
    {tab === 'pedidos' && <section className="space-y-4 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap gap-3"><Input type="date" aria-label="Dia dos pedidos" className="w-44" value={date} onChange={e => setDate(e.target.value)} /><select aria-label="Canal" className="rounded-md border px-3" value={orderChannel} onChange={e => setOrderChannel(e.target.value)}><option value="all">Todos os canais</option>{Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><Button variant="outline" disabled={!session || busy} onClick={() => setReload(value => value + 1)}><RefreshCw size={16} /> Atualizar leitura</Button></div>
      <p className="text-xs text-slate-500">Indicadores do dia e canal selecionados, apenas dos pedidos importados. Vendas e ticket consideram concluídos; não representam repasses nem lançamentos financeiros.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{cards.map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><strong className="mt-1 block text-lg">{known ? value : '—'}</strong></div>)}</div>
      <div className="flex gap-2 overflow-x-auto pb-2" aria-label="Estados do pedido">{[['all', 'Todos'], ...Object.entries(ORDER_STATES)].map(([id, name]) => <button key={id} aria-pressed={orderState === id} onClick={() => setOrderState(id)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${orderState === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{name}</button>)}</div>
      <Input aria-label="Buscar pedido" value={orderSearch} onChange={e => setOrderSearch(e.target.value)} placeholder="Número, identificador, cliente ou telefone disponível" />
      <p className="text-xs text-slate-500">Cliente, telefone, endereço e tipo de entrega ainda não são importados pelo adaptador atual. Estados não informados pelo canal não são inferidos.</p>
      {!session && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Verifique seu acesso para consultar pedidos. Nenhum canal está simulado como conectado.</p>}
      {busy && <p role="status">Consultando pedidos...</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {rows && !busy && !error && <div className="grid gap-3 lg:grid-cols-2">{visible.map(order => <article key={orderKey(order)} className="rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2"><strong>{CHANNELS[order.provider]} · {order.displayId || order.externalId}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{ORDER_STATES[order.status]}</span></div>
        <p className="mt-2 text-xs text-slate-500">{new Date(order.timestamps.placedAt).toLocaleString('pt-BR')} · ID: {order.externalId}</p>
        <p className="mt-2 text-sm">Cliente: {order.customer?.name || 'Não disponível'}</p>
        <ul className="my-3 space-y-1 text-sm">{order.items?.map((item, i) => <li key={i}>{item.quantity ?? '—'} × {item.name || 'Item sem descrição'}</li>)}</ul>
        {!order.items?.length && <p className="text-sm">Itens não disponíveis</p>}
        <div className="flex justify-between text-sm"><span>Total informado</span><strong>{moneyOrUnknown(order.money?.customer_total)}</strong></div>
        <p className="mt-2 text-xs text-slate-600">Pagamento: {order.payment?.map(payment => payment.method).join(', ') || 'Não informado'} · Entrega: {order.deliveryType || 'Não informada'}</p>
      </article>)}{!visible.length && <p className="col-span-full py-6 text-center text-sm text-slate-500">Nenhum pedido importado corresponde aos filtros. Isso não comprova ausência de vendas na plataforma.</p>}</div>}
    </section>}
    <p className="text-xs text-slate-500">
      Atendimento: leitura, handoff auditado, não lidas e rascunho local. Envio de mensagens, cardápio unificado,
      KDS e criação de pedidos seguem não implementados; nenhuma mensagem automática ou alteração de status é enviada por esta tela.
    </p>
  </div>;
}
