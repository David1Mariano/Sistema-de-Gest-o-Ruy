import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deliveryCall } from '@/lib/integrations/deliveryClient';
import { CHANNELS } from '@/lib/delivery/domain';
import { customerView, filterCustomers } from '@/lib/delivery/attendance';

// Clientes por loja: identidade composta provider+loja+ID externo; telefone não associa pessoas.
export default function CustomerDirectory({ session, scopes, scopesError, onOpenCustomer }) {
  const [rows, setRows] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState('all'), [merchant, setMerchant] = useState('all'), [search, setSearch] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    if (!session || !scopes || !scopes.length) return undefined;
    setLoading(true); setError('');
    (async () => {
      try {
        const merged = [];
        for (const scope of scopes) {
          let offset = 0;
          do {
            const page = await deliveryCall('customers', { provider: scope.provider, merchantId: scope.merchant_id, offset });
            merged.push(...page.rows);
            offset = page.nextOffset;
            if (merged.length > 5000) throw Error('Limite de clientes excedido. Atualize os filtros de loja.');
          } while (offset !== null);
        }
        // Falha preserva o que já estava carregado; sucesso substitui de uma vez.
        if (active) setRows(merged);
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [session, scopes, reload]);

  const visible = filterCustomers(rows || [], { channel, merchant, search });
  const merchants = [...new Set((scopes || []).map(scope => scope.merchant_id))];

  return <section className="space-y-4 rounded-xl border bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">Clientes</h2>
        <p className="text-xs text-slate-500">Identidade por canal e loja. O mesmo telefone em dois canais não é a mesma pessoa.</p>
      </div>
      <Button variant="outline" disabled={!session || loading} onClick={() => setReload(value => value + 1)}>
        <RefreshCw size={16} /> Atualizar
      </Button>
    </div>

    <div className="flex flex-wrap gap-3">
      <Input aria-label="Buscar cliente" className="w-64" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome, telefone ou ID do cliente" />
      <select aria-label="Canal do cliente" className="rounded-md border px-3 text-sm" value={channel} onChange={e => setChannel(e.target.value)}>
        <option value="all">Todos os canais</option>
        {Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select aria-label="Loja do cliente" className="rounded-md border px-3 text-sm" value={merchant} onChange={e => setMerchant(e.target.value)}>
        <option value="all">Todas as lojas</option>
        {merchants.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
    </div>

    {scopesError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{scopesError}</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error} Os clientes já carregados continuam visíveis.</p>}
    {!session && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Verifique seu acesso para consultar clientes.</p>}
    {rows === null && loading && <p role="status" className="text-sm text-slate-500">Carregando clientes...</p>}
    {rows === null && !loading && !error && session && scopes && !scopes.length && <p className="text-sm text-slate-500">Nenhuma loja autorizada para atendimento.</p>}
    {rows && rows.length > 0 && !visible.length && <p className="text-sm text-slate-500">Nenhum cliente corresponde aos filtros.</p>}
    {loading && rows !== null && <p role="status" className="text-xs text-slate-400">Atualizando...</p>}

    {visible.length > 0 && <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2 pr-3">Cliente</th>
            <th className="py-2 pr-3">Canal</th>
            <th className="py-2 pr-3">Loja</th>
            <th className="py-2 pr-3">Telefone</th>
            <th className="py-2 pr-3">Conversas</th>
            <th className="py-2 pr-3">Última interação</th>
            <th className="py-2 pr-3">Ações</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(row => {
            const item = customerView(row);
            return <tr key={`${item.provider}:${item.merchantId}:${item.id}`} className="border-b last:border-0">
              <td className="py-2 pr-3">{item.name || <span className="text-slate-500">{item.externalId}</span>}</td>
              <td className="py-2 pr-3">{CHANNELS[item.provider]}</td>
              <td className="py-2 pr-3">{item.merchantId}</td>
              <td className="py-2 pr-3">{item.phone || 'Não informado'}</td>
              <td className="py-2 pr-3">{item.conversationCount}</td>
              <td className="py-2 pr-3">{item.lastInteractionAt ? new Date(item.lastInteractionAt).toLocaleString('pt-BR') : 'Sem interação registrada'}</td>
              <td className="py-2 pr-3">
                <Button variant="outline" onClick={() => onOpenCustomer?.(item.name || item.externalId)}>Abrir conversas</Button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>}
    <p className="text-xs text-slate-500">
      Conversas e última interação vêm apenas desta loja/provedor; o sistema não junta a mesma pessoa em canais diferentes.
    </p>
  </section>;
}
