import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import {
  CONSUMPTION_STATES,
  STOCK_STATES,
  computeConsumption,
  findInventoryItem,
  stockStatus,
  toNumber,
} from '@/lib/consumptionCalc';

const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');
const qty = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '0';
};
const text = (v, fallback = '—') => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === undefined || s === null || s === '' ? fallback : String(s);
};

// FASE 2A — SOMENTE LEITURA. Nenhuma baixa de estoque, nenhum StockMovement
// e nenhuma alteração de InventoryItem são feitos aqui.
export default function ProductionConsumptionDialog({ open, onClose, record, products, ingredients, inventoryItems }) {
  const normalizedRecord = record && typeof record === 'object' ? record : null;
  const product = useMemo(
    () => (products || []).find((p) => p.id === normalizedRecord?.product_id) || null,
    [products, normalizedRecord]
  );
  const productIngredients = useMemo(
    () => (product ? (ingredients || []).filter((ing) => ing?.product_id === product.id) : []),
    [ingredients, product]
  );
  const calc = useMemo(
    () =>
      computeConsumption({
        record: normalizedRecord,
        product,
        ingredients: productIngredients,
      }),
    [normalizedRecord, product, productIngredients]
  );

const STATUS_META = {
  [STOCK_STATES.AVAILABLE]: { label: 'Disponível', icon: CheckCircle2, className: 'text-emerald-700' },
  [STOCK_STATES.INSUFFICIENT]: { label: 'Insuficiente', icon: AlertTriangle, className: 'text-destructive font-semibold' },
  [STOCK_STATES.MISSING]: { label: 'Item não encontrado', icon: MinusCircle, className: 'text-amber-700 font-semibold' },
};

function ConsumptionRows({ calc, product, inventoryItems }) {
  const rows = useMemo(() => {
    if (calc.state !== CONSUMPTION_STATES.OK) return [];
    return calc.rows.map(({ ingredient, needed }, index) => {
      const item = findInventoryItem(inventoryItems, ingredient?.inventory_item_id);
      return {
        key: `${ingredient?.inventory_item_id || 'sem-item'}-${index}`,
        name: text(ingredient?.inventory_item_name || item?.name, 'Ingrediente'),
        needed,
        neededUnit: text(ingredient?.unit || item?.unit || product?.yield_unit, ''),
        stock: item ? toNumber(item.current_stock) : null,
        stockUnit: text(item?.unit || ingredient?.unit || product?.yield_unit, ''),
        status: stockStatus({ needed, inventoryItem: item }),
        missingItem: !item,
      };
    });
  }, [calc, inventoryItems, product]);

  const insufficientCount = rows.filter((row) => row.status === STOCK_STATES.INSUFFICIENT).length;

  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {['Insumo', 'Necessário', 'Estoque atual', 'Situação'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const meta = STATUS_META[row.status];
                const Icon = meta.icon;
                return (
                  <tr key={row.key}>
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3">{qty(row.needed)} {row.neededUnit}</td>
                    <td className="px-4 py-3">{row.stock === null ? '—' : `${qty(row.stock)} ${row.stockUnit}`}</td>
                    <td className={`px-4 py-3 ${meta.className}`}>
                      <span className="inline-flex items-center gap-1"><Icon className="h-4 w-4" />{meta.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {rows.some((row) => row.missingItem) && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          Item de estoque não encontrado para um ou mais ingredientes. A produção permanece registrada e
          nenhum estoque foi alterado.
        </p>
      )}

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p className="rounded-lg border bg-card p-3">
          <span className="text-muted-foreground">Total de itens: </span><strong>{rows.length}</strong>
        </p>
        <p className="rounded-lg border bg-card p-3">
          <span className="text-muted-foreground">Itens insuficientes: </span>
          <strong className={insufficientCount > 0 ? 'text-destructive' : ''}>{insufficientCount}</strong>
        </p>
      </div>
    </>
  );
}

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conferência de consumo</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <div>
            <Label className="text-xs">Produto</Label>
            <p className="font-medium">{text(product?.name || normalizedRecord?.product_name)}</p>
          </div>
          <div>
            <Label className="text-xs">Produção</Label>
            <p className="font-medium">
              {qty(calc.producedQuantity)} {text(product?.yield_unit || normalizedRecord?.unit, '')}
            </p>
          </div>
          <div>
            <Label className="text-xs">Data</Label>
            <p className="font-medium">{fmtDate(normalizedRecord?.date)}</p>
          </div>
        </div>

        <section className="space-y-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Insumos necessários</p>
          {calc.state === CONSUMPTION_STATES.NO_RECIPE && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Este produto não possui ficha técnica cadastrada. Não foi possível calcular o consumo de insumos.
            </div>
          )}
          {calc.state === CONSUMPTION_STATES.BAD_YIELD && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Não foi possível calcular o consumo porque o rendimento da ficha técnica não está configurado.
            </div>
          )}
          {calc.state === CONSUMPTION_STATES.OK && (
            <ConsumptionRows calc={calc} product={product} inventoryItems={inventoryItems} />
          )}
        </section>

        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Nesta etapa nenhuma alteração será feita no estoque.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Continuar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
