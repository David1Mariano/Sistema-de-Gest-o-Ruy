import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus } from 'lucide-react';
import TechnicalSheetDialog from '@/components/producao/TechnicalSheetDialog';
import ProductionOrderDialog from '@/components/producao/ProductionOrderDialog';
import DailyProductionDialog from '@/components/producao/DailyProductionDialog';
import TechnicalSheetsTable from '@/components/producao/TechnicalSheetsTable';
import ProductionOrdersTable from '@/components/producao/ProductionOrdersTable';
import DailyProductionTable from '@/components/producao/DailyProductionTable';
const allowed=['admin','super_admin','gerente','manager','producao'];
export default function Producao(){
 const {user}=useAuth(),[data,setData]=useState({products:[],ingredients:[],inventory:[],orders:[],records:[]}),[tab,setTab]=useState('fichas'),[editing,setEditing]=useState(null),[open,setOpen]=useState(false),[loading,setLoading]=useState(true);
 const load=async()=>{setLoading(true);const [products,ingredients,inventory,orders,records]=await Promise.all([base44.entities.ProductionProduct.list('name',500),base44.entities.RecipeIngredient.list('product_name',1000),base44.entities.InventoryItem.list('name',500),base44.entities.ProductionOrder.list('-date',1000),base44.entities.DailyProduction.list('-date',1000)]);setData({products,ingredients,inventory,orders,records});setLoading(false)};
 useEffect(()=>{if(allowed.includes(user?.role))load()},[user?.role]);
 if(!allowed.includes(user?.role))return <div className="rounded-xl border bg-card p-10 text-center"><h1 className="text-xl font-semibold">Acesso restrito</h1><p className="mt-2 text-muted-foreground">Esta área está disponível apenas para Produção e gestores.</p></div>;
 const add=()=>{setEditing(null);setOpen(true)}, edit=x=>{setEditing(x);setOpen(true)}, close=()=>{setOpen(false);setEditing(null)};
 return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">Produção</h1><p className="text-sm text-muted-foreground">Fichas técnicas, planejamento e controle diário</p></div><Button onClick={add}><Plus/> {tab==='fichas'?'Nova ficha':tab==='ordens'?'Nova ordem':'Registrar produção'}</Button></div>{loading?<div className="py-16 text-center text-muted-foreground">Carregando produção...</div>:<Tabs value={tab} onValueChange={setTab}><TabsList className="grid w-full max-w-xl grid-cols-3"><TabsTrigger value="fichas">Fichas técnicas</TabsTrigger><TabsTrigger value="ordens">Ordens</TabsTrigger><TabsTrigger value="diario">Controle diário</TabsTrigger></TabsList><TabsContent value="fichas" className="mt-4"><TechnicalSheetsTable products={data.products} ingredients={data.ingredients} onEdit={edit}/></TabsContent><TabsContent value="ordens" className="mt-4"><ProductionOrdersTable orders={data.orders} onEdit={edit}/></TabsContent><TabsContent value="diario" className="mt-4"><DailyProductionTable records={data.records} onEdit={edit}/></TabsContent></Tabs>}<TechnicalSheetDialog open={open&&tab==='fichas'} onClose={close} product={editing} inventory={data.inventory} ingredients={data.ingredients} onSaved={load}/><ProductionOrderDialog open={open&&tab==='ordens'} onClose={close} order={editing} products={data.products} onSaved={load}/><DailyProductionDialog open={open&&tab==='diario'} onClose={close} record={editing} products={data.products} orders={data.orders} onSaved={load}/></div>;
}