import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, PackageCheck, AlertTriangle, Layers, ClipboardList, X, ClipboardCheck } from 'lucide-react';

const inputCls = 'h-9 w-full rounded-md border bg-background px-3 text-sm';

const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
// Nunca renderiza undefined/null/NaN para o usuário.
const qty = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? '0' : String(v));
const text = (v, fallback = '—') => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === undefined || s === null || s === '' ? fallback : String(s);
};

// Compatibilidade: perdas detalhadas (novo) ou loss_quantity (legado).
const lossOf = (r) =>
  Array.isArray(r.losses) && r.losses.length
    ? r.losses.reduce((s, l) => s + num(l.quantity), 0)
    : num(r.loss_quantity);

export default function DailyProductionTable({ records, products, onEdit, onDelete, onReviewConsumption }) {
  const [date, setDate] = useState('');
  const [productId, setProductId] = useState('');
  const [responsible, setResponsible] = useState('');
  const [search, setSearch] = useState('');

  const unitOf = (r) =>
    text(r.unit, '') || text(products.find((p) => p.id === r.product_id)?.yield_unit, '') || '';

  // Opções de produto do filtro: cadastro + produtos citados em registros legados.
  const productOptions = useMemo(() => {
    const map = new Map();
    (products || []).forEach((p) => map.set(p.id, p.name));
    (records || []).forEach((r) => {
      if (r.product_id && !map.has(r.product_id)) {
        map.set(r.product_id, text(r.product_name, r.product_id));
      }
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [products, records]);

  const responsibleOptions = useMemo(() => {
    const set = new Set();
    (records || []).forEach((r) => {
      const resp = String(r.responsible || '').trim();
      if (resp) set.add(resp);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (records || []).filter((r) => {
      if (date && String(r.date || '').slice(0, 10) !== date) return false;
      if (productId && r.product_id !== productId) return false;
      if (responsible && String(r.responsible || '') !== responsible) return false;
      if (q) {
        const lossesText = Array.isArray(r.losses)
          ? r.losses.map((l) => `${l.reason || ''} ${l.responsible || ''} ${l.observation || ''}`).join(' ')
          : '';
        const hay = [
          r.product_name,
          r.responsible,
          r.observation,
          r.date,
          String(r.produced_quantity),
          lossesText,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [records, date, productId, responsible, search]);

  const totals = useMemo(
    () => ({
      produced: filtered.reduce((s, r) => s + num(r.produced_quantity), 0),
      losses: filtered.reduce((s, r) => s + lossOf(r), 0),
      leftovers: filtered.reduce((s, r) => s + num(r.leftover_quantity), 0),
      count: filtered.length,
    }),
    [filtered]
  );

  const hasFilters = Boolean(date || productId || responsible || search.trim());
  const clearFilters = () => {
    setDate('');
    setProductId('');
    setResponsible('');
    setSearch('');
  };

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Produção do dia" value={qty(totals.produced)} icon={PackageCheck} />
        <Kpi label="Perdas" value={qty(totals.losses)} icon={AlertTriangle} danger={totals.losses > 0} />
        <Kpi label="Sobras" value={qty(totals.leftovers)} icon={Layers} />
        <Kpi label="Registros" value={qty(totals.count)} icon={ClipboardList} />
      </div>

      {/* Filtros */}
      <div className="rounded-xl border bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 items-end">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Data</p>
            <Input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Produto</p>
            <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Todos</option>
              {productOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Responsável</p>
            <select className={inputCls} value={responsible} onChange={(e) => setResponsible(e.target.value)}>
              <option value="">Todos</option>
              {responsibleOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Busca</p>
            <Input
              placeholder="Produto, motivo, observação..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <X className="w-4 h-4 mr-1" /> Limpar filtros
            </Button>
          </div>
        )}
      </div>

      {/* Tabela */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {['Data', 'Produto', 'Produzido', 'Un.', 'Perdas', 'Sobras', 'Responsável', 'Observação', 'Ações'].map(
                  (h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.length ? (
                filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3 font-medium">{text(r.product_name)}</td>
                    <td className="px-4 py-3">{qty(r.produced_quantity)}</td>
                    <td className="px-4 py-3">{text(unitOf(r), '—')}</td>
                    <td className={`px-4 py-3 ${lossOf(r) > 0 ? 'text-destructive font-semibold' : ''}`}>
                      {qty(lossOf(r))}
                    </td>
                    <td className="px-4 py-3">{qty(r.leftover_quantity)}</td>
                    <td className="px-4 py-3">{text(r.responsible, 'Não informado')}</td>
                    <td className="px-4 py-3 max-w-[240px] truncate" title={text(r.observation, '')}>
                      {text(r.observation)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" title="Editar" onClick={() => onEdit(r)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Conferir consumo"
                          onClick={() => onReviewConsumption?.(r)}
                        >
                          <ClipboardCheck className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          title="Excluir"
                          onClick={() => onDelete(r)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-muted-foreground">
                    {hasFilters
                      ? 'Nenhum registro encontrado com os filtros atuais.'
                      : 'Nenhuma produção registrada. Clique em "Registrar produção" para começar.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalhe das perdas do período filtrado */}
      {filtered.some((r) => Array.isArray(r.losses) && r.losses.length > 0) && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="font-semibold">Perdas registradas</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  {['Data', 'Produto', 'Quantidade', 'Motivo', 'Responsável', 'Observação'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered
                  .flatMap((r) =>
                    (Array.isArray(r.losses) ? r.losses : []).map((l) => ({
                      ...l,
                      product_name: r.product_name,
                      recordDate: r.date,
                    }))
                  )
                  .map((l, i) => (
                    <tr key={l.id || i}>
                      <td className="px-4 py-3">{fmtDate(l.date || l.recordDate)}</td>
                      <td className="px-4 py-3 font-medium">{text(l.product_name)}</td>
                      <td className="px-4 py-3 text-destructive font-semibold">{qty(l.quantity)}</td>
                      <td className="px-4 py-3">{text(l.reason)}</td>
                      <td className="px-4 py-3">{text(l.responsible, 'Não informado')}</td>
                      <td className="px-4 py-3">{text(l.observation)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, danger = false }) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? 'border-destructive/40 bg-destructive/5' : 'bg-card'}`}>
      <div className="flex justify-between gap-2">
        <div>
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold mt-1">{value}</p>
        </div>
        <Icon className={`w-5 h-5 shrink-0 ${danger ? 'text-destructive' : 'text-muted-foreground'}`} />
      </div>
    </div>
  );
}