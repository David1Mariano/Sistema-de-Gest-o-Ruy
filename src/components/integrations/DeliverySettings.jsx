import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DeliveryAccess, { useDeliverySession } from './DeliveryAccess';
import { deliveryCall, deliveryMessage } from '@/lib/integrations/deliveryClient';

const labels = { disconnected: 'Não conectado', connecting: 'Conectando', connected: 'Conectado', attention: 'Requer atenção', error: 'Erro' };
export default function DeliverySettings() {
  const session = useDeliverySession();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState(null), [code, setCode] = useState('');
  const refresh = async () => setData(await deliveryCall('status'));
  useEffect(() => { let live = true; setData(null); if (session) deliveryCall('status').then(value => live && setData(value)).catch(e => live && setError(e.message)); return () => { live = false; }; }, [session]);
  const run = async fn => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <section className="rounded-xl border bg-white p-4 space-y-4">
    <h2 className="text-lg font-semibold">Integrações de Delivery</h2><DeliveryAccess />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {['ifood', '99food'].map(platform => {
      const name = platform === 'ifood' ? 'iFood' : '99Food';
      const record = data?.integrations.find(i => i.platform === platform);
      const blocked = platform === '99food';
      return <div key={platform} className="rounded-lg border p-3 space-y-2">
        <h3 className="font-semibold">{name}</h3>
        <p>{blocked ? 'AGUARDANDO HOMOLOGAÇÃO/CREDENCIAIS 99FOOD' : record ? labels[record.status] : 'Conexão não verificada'}</p>
        {!blocked && data && !data.ifoodConfigured && <p className="text-sm text-amber-800">Aguardando credenciais e homologação iFood no servidor.</p>}
        {record?.last_error && <p className="text-sm text-amber-800">{deliveryMessage(record.last_error)}</p>}
        {data?.merchants.filter(m => m.platform === platform).map(m => <p key={m.merchant_id} className="text-sm">{m.name || 'Estabelecimento'} · ID: {m.merchant_id}</p>)}
        <p className="text-xs">Última sincronização: {record?.last_sync_at ? new Date(record.last_sync_at).toLocaleString('pt-BR') : 'Ainda não realizada'}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={blocked || busy || !data?.ifoodConfigured} onClick={() => run(async () => setPending(await deliveryCall('begin', { platform })))}>{record?.status === 'connected' || record?.status === 'attention' ? 'Reconectar' : `Conectar ${name}`}</Button>
          {!blocked && ['connected', 'attention', 'error'].includes(record?.status) && <Button variant="outline" disabled={busy} onClick={() => run(async () => { const result = await deliveryCall('sync', { platform }); if (result.failures || result.pending || result.unsupported) throw new Error('Sincronização parcial; consulte o estado e tente novamente.'); })}>Sincronizar agora</Button>}
          {!blocked && record && record.status !== 'disconnected' && <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm('Desconectar localmente? Revogue também a autorização no Portal do Parceiro iFood.')) run(async () => { await deliveryCall('disconnect', { platform }); setPending(null); }); }}>Desconectar</Button>}
        </div>
        {blocked && <a href="https://developer-food.99app.com/pt-BR/openapi/index" target="_blank" rel="noreferrer" className="text-xs underline">Portal oficial 99Food</a>}
      </div>;
    })}
    {pending && session && <div className="space-y-2 border rounded-lg p-3">
      <p>Autorize no portal iFood usando o código <strong>{pending.userCode}</strong>.</p>
      <a href={pending.verificationUrl} target="_blank" rel="noreferrer" className="underline">Abrir autorização oficial iFood</a>
      <p className="text-xs">Expira em {new Date(pending.expiresAt).toLocaleTimeString('pt-BR')}.</p>
      <Input aria-label="Código de autorização iFood" value={code} onChange={e => setCode(e.target.value)} placeholder="Código devolvido pelo portal iFood" />
      <Button disabled={busy || !code} onClick={() => run(async () => { await deliveryCall('complete', { platform: 'ifood', authorizationCode: code }); setPending(null); setCode(''); })}>Concluir autorização</Button>
    </div>}
    <p className="text-xs text-slate-500">A conexão não confirma homologação nem acesso ao módulo financeiro. A 99Food permanece desabilitada até validação do contrato oficial.</p>
  </section>;
}
