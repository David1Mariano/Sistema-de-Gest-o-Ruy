import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { usePersistentDraft } from '@/lib/usePersistentDraft';
import { hasDraftChanged } from '@/lib/draftStore';
import { DRAFT_CANCEL_CONFIRM, DRAFT_FORM_KEYS } from '@/lib/draftConfig';
import NumberInput from '@/components/shared/NumberInput';
import DraftNotice from '@/components/shared/DraftNotice';
import { toNumberBR } from '@/lib/numberUtils';
import { criarItemComEstoqueInicial, ajustarSaldo, newClientToken, buscarVinculosDoItem, excluirOuDesativarItem, reativarItem } from '@/lib/stockService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Boxes, AlertTriangle, History, Trash2, RotateCcw } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { logAudit } from '@/lib/pontoUtils';
import { DELETE_MODE, LIST_TABS, itemDecision, itemsForTab } from '@/lib/stockItemUtils';

const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const fmt=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const today=()=>new Date().toISOString().slice(0,10);
const inputCls='h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function Estoque(){
 const [items,setItems]=useState([]);const [moves,setMoves]=useState([]);const [suppliers,setSuppliers]=useState([]);const [open,setOpen]=useState(false);const [adjusting,setAdjusting]=useState(null);const [search,setSearch]=useState('');const [aba,setAba]=useState('ativo');const [removing,setRemoving]=useState(null);const [removingVinc,setRemovingVinc]=useState(null);const [removingBusy,setRemovingBusy]=useState(false);const [removeError,setRemoveError]=useState('');const [reacting,setReacting]=useState(null);const [reactBusy,setReactBusy]=useState(false);const [reactError,setReactError]=useState('');
 const [loading,setLoading]=useState(true);const [loadError,setLoadError]=useState(false);
 const load=async()=>{setLoading(true);try{const [i,m,s]=await Promise.all([base44.entities.InventoryItem.list('name',500),base44.entities.StockMovement.list('-created_date',1000),base44.entities.Supplier.list('name',500)]);setItems(i);setMoves(m);setSuppliers(s);setLoadError(false)}catch{setLoadError(true)}finally{setLoading(false)}};useEffect(()=>{load()},[]);
  // A escrita (e a revalidação no banco) ficam em `stockService`. A tela só
  // decide o texto e o modo; o serviço redecide antes de gravar, porque entre
  // abrir o modal e confirmar alguém pode ter registrado uma movimentação.
  const decisao=removing?itemDecision(removing,removingVinc||{}):null;
  // Enquanto os vínculos não voltaram do banco a decisão é DESCONHECIDA: o
  // botão fica travado. Sem isso, `removingVinc=null` cairia no caminho de
  // exclusão física e uma falha de rede viraria "item sem histórico".
  const carregandoVinc=Boolean(removing)&&removingVinc===null;
  const podeConfirmar=Boolean(decisao)&&!carregandoVinc&&decisao.mode!==DELETE_MODE.BLOCKED;
  const abrirExclusao=async(x)=>{setRemoveError('');setRemovingVinc(null);setRemoving(x);setRemovingBusy(true);try{setRemovingVinc(await buscarVinculosDoItem(x.id))}catch(e){setRemoveError(e?.message||'Não foi possível verificar os vínculos deste item.')}finally{setRemovingBusy(false)}};
  const confirmarExclusao=async()=>{if(!removing||!podeConfirmar)return;setRemovingBusy(true);setRemoveError('');try{const r=await excluirOuDesativarItem({item:removing,mode:decisao.mode});if(r.mode===DELETE_MODE.DELETE){await logAudit({entity_type:'InventoryItem',entity_id:r.itemId,action:'exclusao',old_value:r.name,new_value:'',reason:'Item de estoque excluído definitivamente (sem saldo, histórico ou vínculo).',responsible_user:currentUserName()})}else{await logAudit({entity_type:'InventoryItem',entity_id:r.itemId,action:'exclusao_logica',old_value:r.name,new_value:`status=${r.status}`,reason:'Item desativado para preservar o histórico de movimentações.',responsible_user:currentUserName()})}setRemoving(null);await load()}catch(err){setRemoveError(err?.message||'Não foi possível concluir a operação. Tente novamente.')}finally{setRemovingBusy(false)}};
  const confirmarReativar=async()=>{if(!reacting)return;setReactBusy(true);setReactError('');try{const r=await reativarItem({item:reacting});await logAudit({entity_type:'InventoryItem',entity_id:r.itemId,action:'reativacao',old_value:`status=${reacting.status||'inativo'}`,new_value:`status=${r.status}`,reason:'Item de estoque reativado.',responsible_user:currentUserName()});setReacting(null);await load()}catch(err){setReactError(err?.message||'Não foi possível reativar o item.')}finally{setReactBusy(false)}};
  const ehAtivo=(x)=>(x?.status||'ativo')==='ativo';
  // Textos do diálogo, montados fora do JSX: o arquivo concentra muito numa
  // linha só, e template literal dentro de JSX e de ternário fica impossível
  // de ler (e fácil de errar a chave).
  const tituloExclusao=decisao?.mode===DELETE_MODE.DELETE?'Excluir definitivamente?':decisao?.mode===DELETE_MODE.DEACTIVATE?'Desativar item?':'Excluir item?';
  const CONFIRMACAO_FISICA='Tem certeza que deseja excluir definitivamente este item? Esta ação não poderá ser desfeita.';
  const textoExclusao=!decisao?'':decisao.mode===DELETE_MODE.DELETE?CONFIRMACAO_FISICA:`"${removing?.name||''}" será desativado e deixará de aparecer nas listas operacionais. O histórico é preservado e nada é apagado.`;
  const rotuloAcaoExclusao=decisao?.mode===DELETE_MODE.DELETE?'Excluir definitivamente':'Desativar item';
  const textoReativacao=reacting?`"${reacting.name}" voltará a aparecer nas listas operacionais. O mesmo registro será reativado — nenhum item novo é criado e o histórico é mantido.`:'';
  const fecharExclusao=()=>{if(removingBusy)return;setRemoving(null);setRemoveError('');setRemovingVinc(null)};
  const fecharReativacao=()=>{if(reactBusy)return;setReacting(null);setReactError('')};
  const acaoExcluir=(x)=>(<button type="button" onClick={()=>abrirExclusao(x)} title={`Excluir item ${x.name}`} aria-label={`Excluir item ${x.name}`} className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5"/></button>);
  const acaoReativar=(x)=>(<button type="button" onClick={()=>{setReactError('');setReacting(x);}} title={`Reativar item ${x.name}`} aria-label={`Reativar item ${x.name}`} className="p-1 rounded hover:bg-emerald-50 text-slate-500 hover:text-emerald-600"><RotateCcw className="w-3.5 h-3.5"/></button>);

 const active=items.filter(x=>x.status==='ativo');const low=active.filter(x=>Number(x.current_stock||0)<=Number(x.minimum_stock||0));const value=active.reduce((s,x)=>s+Number(x.current_stock||0)*Number(x.average_cost||0),0);const visiveis=itemsForTab(items,aba);const filtered=visiveis.filter(x=>`${x.name} ${x.category||''} ${x.sku||''}`.toLowerCase().includes(search.toLowerCase()));
 if(loading)return <div>Carregando indicadores...</div>;
 if(loadError)return <div role="alert">Indicadores indisponíveis. <button onClick={load}>Tentar novamente</button></div>;
 return <div className="space-y-5"><div className="flex flex-wrap justify-between items-end gap-3"><div><h1 className="text-2xl font-semibold">Estoque</h1><p className="text-sm text-slate-500">Saldos, custos, estoque mínimo e movimentações</p></div><Button onClick={()=>setOpen(true)} className="gap-2"><Plus className="w-4 h-4"/> Novo item</Button></div><div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="Itens ativos" value={active.length} icon={Boxes}/><Stat label="Abaixo do mínimo" value={low.length} icon={AlertTriangle} danger={low.length>0}/><Stat label="Valor estimado em estoque" value={brl(value)} icon={Boxes}/><Stat label="Movimentos registrados" value={moves.length} icon={History}/></div>{low.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-900">Atenção ao estoque</p><p className="text-sm text-amber-800 mt-1">{low.length} item(ns) estão no estoque mínimo ou abaixo dele.</p></div>}<div className="flex flex-wrap gap-1">{LIST_TABS.map(t=><button key={t.key} type="button" onClick={()=>setAba(t.key)} className={`px-3 py-1.5 text-sm rounded-md border ${aba===t.key?'bg-slate-900 text-white border-slate-900':'bg-white text-slate-600 border-slate-200'}`}>{t.label} ({itemsForTab(items,t.key).length})</button>)}</div><Input placeholder="Buscar item..." value={search} onChange={e=>setSearch(e.target.value)} className="max-w-md"/><div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[950px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Item','Categoria','Unidade','Estoque atual','Mínimo','Custo médio','Último custo','Fornecedor','Situação','Ação'].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{filtered.length?filtered.map(x=>{const lowItem=Number(x.current_stock||0)<=Number(x.minimum_stock||0);return <tr key={x.id}><td className="px-4 py-3 font-medium">{x.name}</td><td className="px-4 py-3">{x.category||'—'}</td><td className="px-4 py-3">{x.unit}</td><td className="px-4 py-3 font-semibold">{Number(x.current_stock||0).toLocaleString('pt-BR')}</td><td className="px-4 py-3">{Number(x.minimum_stock||0).toLocaleString('pt-BR')}</td><td className="px-4 py-3">{brl(x.average_cost)}</td><td className="px-4 py-3">{brl(x.last_cost)}</td><td className="px-4 py-3">{x.preferred_supplier_name||'—'}</td><td className="px-4 py-3">{lowItem?<span className="text-amber-700">Repor estoque</span>:<span className="text-emerald-700">Normal</span>}</td><td className="px-4 py-3"><div className="flex items-center gap-1"><Button size="sm" variant="outline" onClick={()=>setAdjusting(x)}>Ajustar</Button>{ehAtivo(x)?acaoExcluir(x):acaoReativar(x)}</div></td></tr>}):<tr><td colSpan={10} className="p-10 text-center text-slate-400">Nenhum item cadastrado.</td></tr>}</tbody></table></div></div><div className="rounded-xl border bg-white overflow-hidden"><div className="p-4 border-b"><h3 className="font-semibold">Movimentações recentes</h3></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Data','Item','Movimento','Quantidade','Custo','Saldo após','Responsável'].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{moves.slice(0,100).map(m=><tr key={m.id}><td className="px-4 py-3">{fmt(m.date)}</td><td className="px-4 py-3 font-medium">{m.item_name}</td><td className="px-4 py-3">{String(m.movement_type||'').replaceAll('_',' ')}</td><td className="px-4 py-3">{m.quantity} {m.unit}</td><td className="px-4 py-3">{brl(m.total_cost)}</td><td className="px-4 py-3">{m.balance_after??'—'}</td><td className="px-4 py-3">{m.responsible_user||'—'}</td></tr>)}</tbody></table></div></div><ItemDialog open={open} onClose={()=>setOpen(false)} suppliers={suppliers} onSaved={load}/><AdjustDialog item={adjusting} open={Boolean(adjusting)} onClose={()=>setAdjusting(null)} onSaved={load}/><ExcluirItemDialog aberto={Boolean(removing)} decisao={decisao} texto={textoExclusao} titulo={tituloExclusao} carregando={carregandoVinc} busy={removingBusy} erro={removeError} rotuloAcao={rotuloAcaoExclusao} onFechar={fecharExclusao} onConfirmar={confirmarExclusao}/><ReativarItemDialog aberto={Boolean(reacting)} texto={textoReativacao} busy={reactBusy} erro={reactError} onFechar={fecharReativacao} onConfirmar={confirmarReativar}/></div>
}
function Stat({label,value,icon:Icon,danger}){return <div className={`rounded-xl border p-4 ${danger?'border-amber-200 bg-amber-50':'bg-white border-slate-200'}`}><div className="flex justify-between"><div><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold mt-1">{value}</p></div><Icon className={`w-5 h-5 ${danger?'text-amber-600':'text-slate-400'}`}/></div></div>}
function ItemDialog({open,onClose,suppliers,onSaved}){const empty={name:'',sku:'',category:'',unit:'un',current_stock:0,minimum_stock:0,average_cost:0,last_cost:0,preferred_supplier_id:'',location:'',status:'ativo',observation:''};const [f,setF]=useState(empty);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const draft=usePersistentDraft({formKey:DRAFT_FORM_KEYS.ESTOQUE_ITEM_NOVO,enabled:open,value:f});useEffect(()=>{if(open){setF(draft.restoreInto(empty));setError('')}},[open,draft.restoreInto]);const set=(k,v)=>setF(x=>({...x,[k]:v}));const save=async()=>{if(!f.name)return;setSaving(true);setError('');try{const s=suppliers.find(x=>x.id===f.preferred_supplier_id);await criarItemComEstoqueInicial({item:{...f,minimum_stock:Number(f.minimum_stock||0),preferred_supplier_name:s?.trade_name||s?.name||''},openingQty:f.current_stock,responsibleUser:currentUserName()});draft.markSaved();onClose();await onSaved()}catch(e){draft.markFailed();setError(e?.message||'Não foi possível criar o item.')}finally{setSaving(false)}};const requestClose=()=>{if(saving)return;if(hasDraftChanged(f,empty)&&window.confirm(DRAFT_CANCEL_CONFIRM))draft.discard();else draft.keep();onClose()};return <Dialog open={open} onOpenChange={o=>!o&&requestClose()}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Novo item de estoque</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3"><Field l="Nome *"><Input value={f.name} onChange={e=>set('name',e.target.value)}/></Field><Field l="Código/SKU"><Input value={f.sku} onChange={e=>set('sku',e.target.value)}/></Field><Field l="Categoria"><Input value={f.category} onChange={e=>set('category',e.target.value)} placeholder="Ex.: Laticínios, carnes, secos..."/></Field><Field l="Unidade"><select className={inputCls} value={f.unit} onChange={e=>set('unit',e.target.value)}>{['un','kg','g','l','ml','cx','pct','fardo','outro'].map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field l="Estoque inicial" hint="Vira uma movimentação de entrada no histórico."><Input type="number" value={f.current_stock} onChange={e=>set('current_stock',e.target.value)}/></Field><Field l="Estoque mínimo"><Input type="number" value={f.minimum_stock} onChange={e=>set('minimum_stock',e.target.value)}/></Field><Field l="Fornecedor preferencial"><select className={inputCls} value={f.preferred_supplier_id} onChange={e=>set('preferred_supplier_id',e.target.value)}><option value="">Não definido</option>{suppliers.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.trade_name||x.name}</option>)}</select></Field><Field l="Localização"><Input value={f.location} onChange={e=>set('location',e.target.value)} placeholder="Ex.: freezer 2, prateleira A..."/></Field></div>{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}<DraftNotice status={draft.status} message={draft.message} onDiscard={draft.discard} onDismiss={draft.dismissNotice}/><DialogFooter><Button variant="outline" onClick={requestClose} disabled={saving}>Cancelar</Button><Button onClick={save} disabled={saving||!f.name}>{saving?'Salvando...':'Salvar item'}</Button></DialogFooter></DialogContent></Dialog>}
function AdjustDialog({item,open,onClose,onSaved}){const [qty,setQty]=useState('');const [reason,setReason]=useState('inventario');const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [token,setToken]=useState('');useEffect(()=>{if(open&&item){setQty(String(item.current_stock||0));setReason('inventario');setError('');setToken(newClientToken('ajuste'))}},[open,item]);if(!item)return null;const save=async()=>{const alvo=toNumberBR(qty);if(!Number.isFinite(alvo)){setError('Informe um saldo válido.');return}if(alvo<0){setError('O saldo não pode ser negativo.');return}setSaving(true);setError('');try{const r=await ajustarSaldo({item,targetBalance:alvo,type:reason,clientToken:token,responsibleUser:currentUserName(),observation:`Ajuste de inventário para ${alvo}`});onClose();await onSaved();return r}catch(e){setError(e?.message||'Não foi possível ajustar o estoque.');return null}finally{setSaving(false)}};return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Ajustar estoque</DialogTitle></DialogHeader><div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{item.name}</p><p className="text-sm text-slate-500">Saldo atual: {item.current_stock} {item.unit}</p></div><Field l="Novo saldo"><NumberInput value={qty} onChange={setQty} placeholder="0"/></Field><Field l="Motivo"><select className={inputCls} value={reason} onChange={e=>setReason(e.target.value)}><option value="inventario">Inventário</option><option value="entrada_ajuste">Entrada de ajuste</option><option value="saida_ajuste">Saída de ajuste</option><option value="saida_perda">Perda</option></select></Field>{error&&<p className="text-sm text-red-600">{error}</p>}<p className="text-xs text-slate-500">O saldo é ajustado a partir do valor atual do servidor, não do que está na tela: dois ajustes simultâneos não se sobrescrevem.</p></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving}>{saving?'Salvando...':'Confirmar ajuste'}</Button></DialogFooter></DialogContent></Dialog>}
// Diálogo de exclusão/desativação.
//
// Vive fora do JSX da tabela porque o texto muda conforme a decisão: exclusão
// física (definitiva), desativação (histórico a preservar) ou bloqueio (saldo).
// Enquanto os vínculos não voltaram do banco a decisão é DESCONHECIDA, e o botão
// de confirmar nem aparece — nunca oferecido às cegas.
function ExcluirItemDialog({aberto,decisao,titulo,texto,carregando,busy,erro,rotuloAcao,onFechar,onConfirmar}) {
  const bloqueado=!decisao||decisao.mode===DELETE_MODE.BLOCKED;
  const podeConfirmar=Boolean(decisao)&&!carregando&&!bloqueado;
  return (
    <AlertDialog open={aberto} onOpenChange={o=>{if(!o)onFechar()}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{texto}</AlertDialogDescription>
        </AlertDialogHeader>
        {carregando&&<p role="status" className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Verificando histórico e vínculos do item...</p>}
        {decisao?.blocker&&<p role="alert" className={`rounded-md border p-3 text-sm ${decisao.mode===DELETE_MODE.BLOCKED?'border-red-200 bg-red-50 text-red-700':'border-amber-200 bg-amber-50 text-amber-800'}`}>{decisao.blocker}{decisao.detalhe&&<span className="block mt-1 text-xs">Vínculos: {decisao.detalhe}</span>}</p>}
        {erro&&<p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          {podeConfirmar&&<AlertDialogAction onClick={onConfirmar} disabled={busy} className="bg-red-600 hover:bg-red-700">{busy?'Processando...':rotuloAcao}</AlertDialogAction>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Reativar o MESMO registro: nenhum item novo, nenhum histórico alterado.
function ReativarItemDialog({aberto,texto,busy,erro,onFechar,onConfirmar}) {
  return (
    <AlertDialog open={aberto} onOpenChange={o=>{if(!o)onFechar()}}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reativar item?</AlertDialogTitle>
          <AlertDialogDescription>{texto}</AlertDialogDescription>
        </AlertDialogHeader>
        {erro&&<p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirmar} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">{busy?'Reativando...':'Reativar item'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
function Field({l,hint,children}){return <div className="space-y-1"><Label className="text-xs">{l}</Label>{children}{hint&&<p className="text-xs text-slate-500">{hint}</p>}</div>}
