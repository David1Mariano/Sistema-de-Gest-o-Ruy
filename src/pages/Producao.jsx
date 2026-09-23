import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import TechnicalSheetDialog from '@/components/producao/TechnicalSheetDialog';
import ProductionOrderDialog from '@/components/producao/ProductionOrderDialog';
import DailyProductionDialog from '@/components/producao/DailyProductionDialog';
import TechnicalSheetsTable from '@/components/producao/TechnicalSheetsTable';
import ProductionOrdersTable from '@/components/producao/ProductionOrdersTable';
import DailyProductionTable from '@/components/producao/DailyProductionTable';

// 'user' = usuário comum (operacional). O gate aqui é apenas UX: a
// barreira real de segurança precisa vir do backend/RLS (fora desta etapa).
const allowed = ['admin', 'super_admin', 'gerente', 'manager', 'producao', 'user'];

// Aba -> diálogo ativo (um único diálogo por vez; nunca cruza entidades).
const TAB_DIALOG = { fichas: 'ficha', ordens: 'ordem', diario: 'diario' };
const TAB_LABEL = { fichas: 'Nova ficha', ordens: 'Nova ordem', diario: 'Registrar produção' };

// Entidades com atualização automática (subscribe do localDb/cloudDb).
const SUBSCRIBED = ['ProductionProduct', 'RecipeIngredient', 'InventoryItem', 'ProductionOrder', 'DailyProduction'];

export default function Producao() {
  const { user } = useAuth();
  const [data, setData] = useState({
    products: [],
    ingredients: [],
    inventory: [],
    orders: [],
    records: [],
  });
  const [tab, setTab] = useState('fichas');
  const [dialog, setDialog] = useState(null); // 'ficha' | 'ordem' | 'diario' | null
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [partialError, setPartialError] = useState('');

  // Cada consulta captura o próprio erro: uma falha secundária não derruba
  // a tela; só a falha do Controle Diário (primária) vira erro bloquante.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError('');
    const run = (name, promise) =>
      promise.then((v) => ({ name, ok: true, v }), (e) => ({ name, ok: false, error: e }));
    try {
      const r = await Promise.all([
        run('ProductionProduct', base44.entities.ProductionProduct.list('name', 500)),
        run('RecipeIngredient', base44.entities.RecipeIngredient.list('product_name', 1000)),
        run('InventoryItem', base44.entities.InventoryItem.list('name', 500)),
        run('ProductionOrder', base44.entities.ProductionOrder.list('-date', 1000)),
        run('DailyProduction', base44.entities.DailyProduction.list('-date', 1000)),
      ]);
      if (!r[4].ok) {
        setLoadError(r[4].error?.message || 'Não foi possível carregar o controle diário.');
        return;
      }
      const failed = r.filter((x) => !x.ok).map((x) => x.name);
      setPartialError(
        failed.length
          ? `Não foi possível carregar: ${failed.join(', ')}. O restante está disponível.`
          : ''
      );
      setData({
        products: r[0].ok ? r[0].v : [],
        ingredients: r[1].ok ? r[1].v : [],
        inventory: r[2].ok ? r[2].v : [],
        orders: r[3].ok ? r[3].v : [],
        records: r[4].v,
      });
    } catch (e) {
      setLoadError(e?.message || 'Erro inesperado ao carregar a produção.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed.includes(user?.role)) return undefined;
    load();
    // Atualização automática (inclusive entre máquinas, via polling do
    // cloudDb) com cleanup no unmount.
    const unsubs = SUBSCRIBED.map((name) => {
      try {
        return base44.entities[name]?.subscribe?.(() => load({ silent: true }));
      } catch {
        return undefined;
      }
    });
    return () => unsubs.forEach((u) => { try { u?.(); } catch { /* noop */ } });
  }, [user?.role, load]);

  if (!allowed.includes(user?.role)) {
    return (
      <div className="rounded-xl border bg-card p-10 text-center">
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-muted-foreground">
          Esta área está disponível apenas para Produção e gestores.
        </p>
      </div>
    );
  }

  const add = () => { setEditing(null); setDialog(TAB_DIALOG[tab] || 'diario'); };
  const edit = (type, record) => { setEditing(record); setDialog(type); };
  const close = () => { setDialog(null); setEditing(null); };
  const changeTab = (value) => { setTab(value); close(); };

  const remove = async (record) => {
    const ok = window.confirm(
      'Excluir registro de produção?\n\nEsta ação não poderá ser desfeita.'
    );
    if (!ok) return;
    try {
      await base44.entities.DailyProduction.delete(record.id);
      await load({ silent: true });
      toast({ title: 'Registro excluído.' });
    } catch (e) {
      toast({
        title: 'Não foi possível excluir',
        description: e?.message || 'Tente novamente.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Produção</h1>
          <p className="text-sm text-muted-foreground">Fichas técnicas, planejamento e controle diário</p>
        </div>
        <Button onClick={add} disabled={loading || !!loadError}>
          <Plus /> {TAB_LABEL[tab]}
        </Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-muted-foreground">Carregando produção...</div>
      ) : loadError ? (
        <div className="rounded-xl border bg-card p-10 text-center">
          <h2 className="text-lg font-semibold">Não foi possível carregar a produção</h2>
          <p className="mt-2 text-sm text-destructive">{loadError}</p>
          <Button className="mt-4" onClick={() => load()}>Tentar novamente</Button>
        </div>
      ) : (
        <>
          {partialError && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {partialError}
            </div>
          )}
          <Tabs value={tab} onValueChange={changeTab}>
            <TabsList className="grid w-full max-w-xl grid-cols-3">
              <TabsTrigger value="fichas">Fichas técnicas</TabsTrigger>
              <TabsTrigger value="ordens">Ordens</TabsTrigger>
              <TabsTrigger value="diario">Controle diário</TabsTrigger>
            </TabsList>
            <TabsContent value="fichas" className="mt-4">
              <TechnicalSheetsTable
                products={data.products}
                ingredients={data.ingredients}
                onEdit={(x) => edit('ficha', x)}
              />
            </TabsContent>
            <TabsContent value="ordens" className="mt-4">
              <ProductionOrdersTable orders={data.orders} onEdit={(x) => edit('ordem', x)} />
            </TabsContent>
            <TabsContent value="diario" className="mt-4">
              <DailyProductionTable
                records={data.records}
                products={data.products}
                onEdit={(x) => edit('diario', x)}
                onDelete={remove}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <TechnicalSheetDialog
        open={dialog === 'ficha'}
        onClose={close}
        product={dialog === 'ficha' ? editing : null}
        inventory={data.inventory}
        ingredients={data.ingredients}
        onSaved={() => load({ silent: true })}
      />
      <ProductionOrderDialog
        open={dialog === 'ordem'}
        onClose={close}
        order={dialog === 'ordem' ? editing : null}
        products={data.products}
        onSaved={() => load({ silent: true })}
      />
      <DailyProductionDialog
        open={dialog === 'diario'}
        onClose={close}
        record={dialog === 'diario' ? editing : null}
        products={data.products}
        orders={data.orders}
        onSaved={() => load({ silent: true })}
      />
    </div>
  );
}