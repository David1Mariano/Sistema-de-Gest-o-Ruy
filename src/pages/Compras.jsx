import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, ShoppingCart, Truck, PackageCheck, FileText, Upload, Trash2, Building2 } from 'lucide-react';
import { MOVEMENT_TYPES, registerMovement } from '@/lib/stockService';

const today = () => new Date().toISOString().slice(0,10);
const brl = v => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmt = v => v ? String(v).slice(0,10).split('-').reverse().join('/') : '—';
const inputCls='h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function Compras(){
  const [tab,setTab]=useState('compras');
  const [data,setData]=useState({purchases:[],purchaseItems:[],suppliers:[],inventory:[],payables:[],categories:[],centers:[]});
  const [loading,setLoading]=useState(true);
  const [purchaseOpen,setPurchaseOpen]=useState(false);
  const [supplierOpen,setSupplierOpen]=useState(false);
  const [receiving,setReceiving]=useState(null);

  const load=async()=>{
    setLoading(true);
    try{
      const [purchases,purchaseItems,suppliers,inventory,payables,categories,centers]=await Promise.all([
        base44.entities.Purchase.list('-date',500).catch(()=>[]),
        base44.entities.PurchaseItem.list('-created_date',1000).catch(()=>[]),
        base44.entities.Supplier.list('name',500).catch(()=>[]),
        base44.entities.InventoryItem.list('name',500).catch(()=>[]),
        base44.entities.AccountsPayable.list('-due_date',1000).catch(()=>[]),
        base44.entities.ExpenseCategory.list('name',300).catch(()=>[]),
        base44.entities.CostCenter.list('name',300).catch(()=>[]),
      ]);
      setData({purchases,purchaseItems,suppliers,inventory,payables,categories,centers});
    }finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);

  const active=data.purchases.filter(x=>x.status!=='cancelada');
  const month=today().slice(0,7);
  const monthPurchases=active.filter(x=>(x.date||'').startsWith(month));
  const monthTotal=monthPurchases.reduce((s,x)=>s+Number(x.total_amount||0),0);
  const awaiting=active.filter(x=>x.status==='aguardando_recebimento').length;
  const received=active.filter(x=>x.status==='recebida').length;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Compras & Fornecedores</h1><p className="text-sm text-slate-500">Fornecedor → compra → conta a pagar → recebimento → estoque</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={()=>setSupplierOpen(true)} className="gap-2"><Building2 className="w-4 h-4"/> Fornecedor</Button><Button onClick={()=>setPurchaseOpen(true)} className="gap-2"><Plus className="w-4 h-4"/> Nova compra</Button></div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Compras no mês" value={monthPurchases.length} icon={ShoppingCart}/>
      <Stat label="Valor comprado no mês" value={brl(monthTotal)} icon={FileText}/>
      <Stat label="Aguardando recebimento" value={awaiting} icon={Truck} danger={awaiting>0}/>
      <Stat label="Compras recebidas" value={received} icon={PackageCheck}/>
    </div>

    <div className="flex gap-1">{[['compras','Compras'],['fornecedores','Fornecedores']].map(([k,l])=><button key={k} onClick={()=>setTab(k)} className={`px-3.5 py-2 rounded-lg text-sm font-medium ${tab===k?'bg-slate-900 text-white':'bg-slate-100 text-slate-600'}`}>{l}</button>)}</div>

    {tab==='compras'?<PurchasesTable data={data} loading={loading} onReceive={setReceiving}/>:<SuppliersTable rows={data.suppliers}/>}    

    <PurchaseDialog open={purchaseOpen} onClose={()=>setPurchaseOpen(false)} data={data} onSaved={load}/>
    <SupplierDialog open={supplierOpen} onClose={()=>setSupplierOpen(false)} onSaved={load}/>
    <ReceiveDialog purchase={receiving} open={Boolean(receiving)} onClose={()=>setReceiving(null)} data={data} onSaved={load}/>
  </div>
}

function Stat({label,value,icon:Icon,danger}){return <div className={`rounded-xl border p-4 ${danger?'border-amber-200 bg-amber-50':'bg-white border-slate-200'}`}><div className="flex justify-between gap-2"><div><p className={`text-xs ${danger?'text-amber-700':'text-slate-500'}`}>{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div><Icon className={`w-5 h-5 ${danger?'text-amber-600':'text-slate-400'}`}/></div></div>}

function PurchasesTable({data,loading,onReceive}){
  return <div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[1050px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Data','Fornecedor','Documento','Itens','Valor','Vencimento','Financeiro','Estoque','Status','Ação'].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{loading?<tr><td colSpan={10} className="p-10 text-center text-slate-400">Carregando...</td></tr>:data.purchases.length?data.purchases.map(p=>{const items=data.purchaseItems.filter(i=>i.purchase_id===p.id&&i.status!=='cancelado');const payable=data.payables.find(x=>x.id===p.accounts_payable_id);return <tr key={p.id}><td className="px-4 py-3">{fmt(p.date)}</td><td className="px-4 py-3 font-medium">{p.supplier_name}</td><td className="px-4 py-3">{p.document_number||'—'}{p.invoice_url&&<a href={p.invoice_url} target="_blank" rel="noreferrer" className="ml-2 text-blue-600 underline">NF</a>}</td><td className="px-4 py-3">{items.length}</td><td className="px-4 py-3 font-semibold">{brl(p.total_amount)}</td><td className="px-4 py-3">{fmt(p.due_date)}</td><td className="px-4 py-3">{payable?<span className={payable.status==='pago'?'text-emerald-700':'text-amber-700'}>{payable.status}</span>:<span className="text-slate-400">—</span>}</td><td className="px-4 py-3">{p.stock_posted?<span className="text-emerald-700">Entrada feita ✓</span>:<span className="text-slate-500">Pendente</span>}</td><td className="px-4 py-3 capitalize">{String(p.status||'').replaceAll('_',' ')}</td><td className="px-4 py-3">{p.status==='aguardando_recebimento'&&!p.stock_posted?<Button size="sm" variant="outline" onClick={()=>onReceive(p)}>Receber</Button>:'—'}</td></tr>}):<tr><td colSpan={10} className="p-10 text-center text-slate-400">Nenhuma compra cadastrada.</td></tr>}</tbody></table></div></div>
}

function SuppliersTable({rows}){return <div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Fornecedor','Documento','Contato','WhatsApp','Categoria','Pagamento','Status'].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.length?rows.map(x=><tr key={x.id}><td className="px-4 py-3 font-medium">{x.trade_name||x.name}</td><td className="px-4 py-3">{x.document||'—'}</td><td className="px-4 py-3">{x.contact_name||'—'}</td><td className="px-4 py-3">{x.whatsapp||x.phone||'—'}</td><td className="px-4 py-3">{x.category||'—'}</td><td className="px-4 py-3">{x.payment_terms||'—'}</td><td className="px-4 py-3 capitalize">{x.status}</td></tr>):<tr><td colSpan={7} className="p-10 text-center text-slate-400">Nenhum fornecedor cadastrado.</td></tr>}</tbody></table></div></div>}

function SupplierDialog({open,onClose,onSaved}){
  const empty={name:'',trade_name:'',document:'',contact_name:'',phone:'',whatsapp:'',email:'',category:'',payment_terms:'',pix_key:'',status:'ativo',observation:''};const [f,setF]=useState(empty);const [saving,setSaving]=useState(false);useEffect(()=>{if(open)setF(empty)},[open]);const set=(k,v)=>setF(x=>({...x,[k]:v}));const save=async()=>{if(!f.name.trim())return;setSaving(true);try{await base44.entities.Supplier.create(f);onClose();await onSaved()}finally{setSaving(false)}};
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Novo fornecedor</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3"><Field l="Razão social/Nome *"><Input value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field l="Nome fantasia"><Input value={f.trade_name} onChange={e=>set('trade_name',e.target.value)}/></Field><Field l="CPF/CNPJ"><Input value={f.document} onChange={e=>set('document',e.target.value)}/></Field><Field l="Contato"><Input value={f.contact_name} onChange={e=>set('contact_name',e.target.value)}/></Field><Field l="WhatsApp"><Input value={f.whatsapp} onChange={e=>set('whatsapp',e.target.value)}/></Field><Field l="E-mail"><Input value={f.email} onChange={e=>set('email',e.target.value)}/></Field><Field l="Categoria"><Input value={f.category} onChange={e=>set('category',e.target.value)} placeholder="Ex.: Hortifruti, laticínios..."/></Field><Field l="Condição de pagamento"><Input value={f.payment_terms} onChange={e=>set('payment_terms',e.target.value)} placeholder="Ex.: 7 dias, à vista..."/></Field><Field l="Chave Pix"><Input value={f.pix_key} onChange={e=>set('pix_key',e.target.value)}/></Field><div className="sm:col-span-2"><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e=>set('observation',e.target.value)}/></Field></div></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||!f.name.trim()}>{saving?'Salvando...':'Salvar fornecedor'}</Button></DialogFooter></DialogContent></Dialog>
}

function PurchaseDialog({open,onClose,data,onSaved}){
  const empty={date:today(),supplier_id:'',document_number:'',invoice_url:'',discount:'0',freight:'0',other_costs:'0',due_date:today(),payment_method:'pix',cost_center_id:'',observation:''};const [f,setF]=useState(empty);const [items,setItems]=useState([]);const [draft,setDraft]=useState({inventory_item_id:'',quantity:'',unit_cost:''});const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState(false);const fileRef=useRef();useEffect(()=>{if(open){setF(empty);setItems([]);setDraft({inventory_item_id:'',quantity:'',unit_cost:''})}},[open]);const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const addItem=()=>{const inv=data.inventory.find(x=>x.id===draft.inventory_item_id);const q=Number(draft.quantity),cost=Number(draft.unit_cost);if(!inv||!q||!cost)return;setItems(x=>[...x,{inventory_item_id:inv.id,item_name:inv.name,unit:inv.unit,quantity:q,unit_cost:cost,total_cost:q*cost}]);setDraft({inventory_item_id:'',quantity:'',unit_cost:''})};
  const subtotal=items.reduce((s,x)=>s+x.total_cost,0);const total=Math.max(0,subtotal-Number(f.discount||0)+Number(f.freight||0)+Number(f.other_costs||0));
  const upload=async file=>{if(!file)return;setUploading(true);try{const {file_url}=await base44.integrations.Core.UploadFile({file});set('invoice_url',file_url)}finally{setUploading(false)}};
  const save=async()=>{const supplier=data.suppliers.find(x=>x.id===f.supplier_id);if(!supplier||!items.length||!total)return;setSaving(true);try{const center=data.centers.find(x=>x.id===f.cost_center_id);const p=await base44.entities.Purchase.create({...f,supplier_name:supplier.trade_name||supplier.name,subtotal,discount:Number(f.discount||0),freight:Number(f.freight||0),other_costs:Number(f.other_costs||0),total_amount:total,cost_center_name:center?.name||'Estoque/Compras',status:'aguardando_recebimento',stock_posted:false,responsible_user:currentUserName()});for(const item of items){await base44.entities.PurchaseItem.create({...item,purchase_id:p.id,status:'pendente',received_quantity:0})}const existing=data.payables.find(x=>x.purchase_id===p.id&&x.status!=='cancelado');if(!existing&&f.due_date){const cat=data.categories.find(x=>x.name==='Insumos e matéria-prima');const ap=await base44.entities.AccountsPayable.create({description:`Compra - ${supplier.trade_name||supplier.name}`,issue_date:f.date,due_date:f.due_date,amount:total,category_id:cat?.id||'',category_name:'Insumos e matéria-prima',cost_center_id:center?.id||'',cost_center_name:center?.name||'Estoque/Compras',beneficiary_name:supplier.trade_name||supplier.name,beneficiary_type:'fornecedor',supplier_id:supplier.id,purchase_id:p.id,payment_method_planned:f.payment_method,document_number:f.document_number,document_url:f.invoice_url,status:'pendente',priority:'normal',responsible_user:currentUserName(),observation:`Gerada pela compra ${p.id}`});await base44.entities.Purchase.update(p.id,{accounts_payable_id:ap.id})}onClose();await onSaved()}finally{setSaving(false)}};
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>Nova compra</DialogTitle></DialogHeader><div className="grid sm:grid-cols-3 gap-3"><Field l="Data"><Input type="date" value={f.date} onChange={e=>set('date',e.target.value)}/></Field><Field l="Fornecedor *"><select className={inputCls} value={f.supplier_id} onChange={e=>set('supplier_id',e.target.value)}><option value="">Selecione...</option>{data.suppliers.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.trade_name||x.name}</option>)}</select></Field><Field l="Nota/Pedido"><Input value={f.document_number} onChange={e=>set('document_number',e.target.value)}/></Field><Field l="Vencimento"><Input type="date" value={f.due_date} onChange={e=>set('due_date',e.target.value)}/></Field><Field l="Forma prevista"><select className={inputCls} value={f.payment_method} onChange={e=>set('payment_method',e.target.value)}>{['pix','dinheiro','boleto','transferencia','cartao_credito','cartao_debito'].map(x=><option key={x} value={x}>{x.replaceAll('_',' ')}</option>)}</select></Field><Field l="Centro de custo"><select className={inputCls} value={f.cost_center_id} onChange={e=>set('cost_center_id',e.target.value)}><option value="">Estoque/Compras</option>{data.centers.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></div>
    <div className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">Itens da compra</h3><div className="grid sm:grid-cols-[1fr_130px_150px_auto] gap-2"><select className={inputCls} value={draft.inventory_item_id} onChange={e=>setDraft(x=>({...x,inventory_item_id:e.target.value}))}><option value="">Selecione o item...</option>{data.inventory.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name} · {x.unit}</option>)}</select><Input type="number" placeholder="Qtd." value={draft.quantity} onChange={e=>setDraft(x=>({...x,quantity:e.target.value}))}/><Input type="number" placeholder="Custo unit." value={draft.unit_cost} onChange={e=>setDraft(x=>({...x,unit_cost:e.target.value}))}/><Button type="button" onClick={addItem}>Adicionar</Button></div>{items.length?<div className="divide-y">{items.map((x,i)=><div key={`${x.inventory_item_id}-${i}`} className="flex justify-between items-center py-2 text-sm"><span>{x.item_name} · {x.quantity} {x.unit} × {brl(x.unit_cost)}</span><div className="flex items-center gap-2"><strong>{brl(x.total_cost)}</strong><button onClick={()=>setItems(a=>a.filter((_,idx)=>idx!==i))} className="text-rose-500"><Trash2 className="w-4 h-4"/></button></div></div>)}</div>:<p className="text-sm text-slate-400">Adicione os itens que estão sendo comprados.</p>}</div>
    <div className="grid sm:grid-cols-4 gap-3"><Field l="Desconto"><Input type="number" value={f.discount} onChange={e=>set('discount',e.target.value)}/></Field><Field l="Frete"><Input type="number" value={f.freight} onChange={e=>set('freight',e.target.value)}/></Field><Field l="Outros custos"><Input type="number" value={f.other_costs} onChange={e=>set('other_costs',e.target.value)}/></Field><div className="rounded-lg bg-slate-900 text-white p-3"><p className="text-xs text-slate-300">Total</p><p className="text-xl font-semibold">{brl(total)}</p></div></div>
    <div className="grid sm:grid-cols-2 gap-3"><div><Label className="text-xs">Nota fiscal/Documento</Label><input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf" onChange={e=>upload(e.target.files?.[0])}/><div className="mt-1"><Button type="button" variant="outline" size="sm" onClick={()=>fileRef.current?.click()} disabled={uploading} className="gap-2"><Upload className="w-4 h-4"/>{uploading?'Enviando...':f.invoice_url?'Trocar documento':'Anexar documento'}</Button></div></div><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e=>set('observation',e.target.value)}/></Field></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||!f.supplier_id||!items.length||!total}>{saving?'Salvando...':'Criar compra e conta a pagar'}</Button></DialogFooter></DialogContent></Dialog>
}

function ReceiveDialog({purchase,open,onClose,data,onSaved}){
  const [saving,setSaving]=useState(false);const [error,setError]=useState('');const items=data.purchaseItems.filter(x=>x.purchase_id===purchase?.id&&x.status!=='cancelado');
  useEffect(()=>{if(open)setError('')},[open,purchase]);
  if(!purchase)return null;
  const receive=async()=>{
    if(saving||purchase.stock_posted)return;
    setSaving(true);setError('');
    // Guarda de idempotência no próprio banco: a compra só recebe uma vez.
    // Um duplo clique (ou duas abas) não pode dobrar a entrada.
    const fresh=await base44.entities.Purchase.get(purchase.id);
    if(fresh.stock_posted){setError('Esta compra já teve a entrada registrada.');setSaving(false);await onSaved();return;}
    try{
      for(const pi of items){
        const inv=data.inventory.find(x=>x.id===pi.inventory_item_id);if(!inv)continue;
        // registerMovement é a fonte única: saldo atômico + histórico, e o
        // clientToken impede baixa duplicada se o processo repetir.
        const {movement:mov}=await registerMovement({
          item:inv,type:MOVEMENT_TYPES.ENTRADA_COMPRA,quantity:Number(pi.quantity||0),
          date:today(),unit:inv.unit,unitCost:Number(pi.unit_cost||0),
          originType:'compra',originId:purchase.id,reference:purchase.document_number||'',
          purchaseId:purchase.id,purchaseItemId:pi.id,
          observation:`Recebimento da compra ${purchase.document_number||purchase.id}`,
          responsibleUser:currentUserName(),clientToken:`compra:${purchase.id}:${pi.id}`,
          allowNegative:true,
        });
        await base44.entities.PurchaseItem.update(pi.id,{received_quantity:Number(pi.quantity||0),status:'recebido',observation:`Entrada registrada ${mov.id}`});
      }
      await base44.entities.Purchase.update(purchase.id,{status:'recebida',stock_posted:true,received_date:today(),responsible_user:currentUserName()});
      onClose();await onSaved();
    }catch(e){setError(e?.message||'Não foi possível registrar o recebimento.');}
    finally{setSaving(false)}
  };
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Confirmar recebimento</DialogTitle></DialogHeader><div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{purchase.supplier_name}</p><p className="text-sm text-slate-500">{items.length} item(ns) · {brl(purchase.total_amount)}</p></div><div className="divide-y rounded-lg border px-3">{items.map(x=><div key={x.id} className="flex justify-between py-2 text-sm"><span>{x.item_name}</span><span>{x.quantity} {x.unit}</span></div>)}</div><p className="text-xs text-slate-500">Ao confirmar, os itens serão adicionados ao estoque e cada entrada ficará registrada no histórico. Esta ação é protegida contra lançamento em duplicidade.</p>{error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}</div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={receive} disabled={saving||purchase.stock_posted}>{saving?'Recebendo...':'Confirmar entrada no estoque'}</Button></DialogFooter></DialogContent></Dialog>
}

function Field({l,children}){return <div className="space-y-1"><Label className="text-xs">{l}</Label>{children}</div>}
