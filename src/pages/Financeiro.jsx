import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { currentUserName } from '@/lib/useCurrentUser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Wallet, Receipt, Users, Bike, Package, AlertTriangle, Plus, Upload, Paperclip, Search, Settings2, BadgeDollarSign, CalendarClock, CheckCircle2, Pencil } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { logAudit } from '@/lib/pontoUtils';
import { roundMoney } from '@/lib/numberUtils';
import FechamentoCaixaPanel from '@/components/financeiro/FechamentoCaixaPanel';
import SangriaPanel from '@/components/financeiro/SangriaPanel';
import CashMovementPanel from '@/components/financeiro/CashMovementPanel';
import { useUserRole } from '@/lib/useUserRole';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (v) => v ? String(v).slice(0,10).split('-').reverse().join('/') : '—';
const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const PAYMENT_LABELS = {
  salario: 'Salário', diaria_motoboy: 'Diária de motoboy', diaria_freelancer: 'Diária de freelancer',
  vale: 'Vale', adiantamento: 'Adiantamento', hora_extra: 'Hora extra', comissao: 'Comissão',
  ferias: 'Férias', decimo_terceiro: '13º salário', acerto: 'Acerto', outros: 'Outros',
};
const CLASS_LABELS = {
  despesa_operacional:'Despesa operacional', compra_insumo:'Compra de insumo', pagamento_colaborador:'Pagamento de colaborador',
  adiantamento_colaborador:'Vale/adiantamento', manutencao:'Manutenção', taxa_imposto:'Taxa/Imposto',
  conta_fixa:'Conta fixa', logistica_delivery:'Logística/Delivery', outros:'Outros',
};
const METHOD_LABELS = { dinheiro:'Dinheiro', pix:'Pix', cartao_debito:'Cartão débito', cartao_credito:'Cartão crédito', transferencia:'Transferência', boleto:'Boleto', outro:'Outro' };

export default function Financeiro() {
  const { isAdmin } = useUserRole();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'visao');
  const [loading, setLoading] = useState(true);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentEditing, setPaymentEditing] = useState(null);
  const [valeSelected, setValeSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [start, setStart] = useState(monthStart());
  const [end, setEnd] = useState(today());
  const [data, setData] = useState({ expenses:[], payments:[], employees:[], vales:[], consumptions:[], categories:[], centers:[], payables:[], accounts:[], recurrings:[], closes:[], fechamentosCaixa:[], sangrias:[], cashMovements:[] });
  const [batchOpen, setBatchOpen] = useState(false);
  const [consumptionOpen, setConsumptionOpen] = useState(false);
  const [expenseEditing, setExpenseEditing] = useState(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    setLoading(true);
    // A carga de gastos é obrigatória: se falhar, o usuário precisa saber
    // (antes o .catch(()=>[]) transformava falha de banco em "Nenhum gasto").
    setLoadError('');
    try {
      const expenses = await base44.entities.FinancialExpense.list('-date', 1000);
      const [payments, employees, vales, consumptions, categories, centers, payables, accounts, recurrings, closes, fechamentosCaixa, sangrias, cashMovements] = await Promise.all([
        base44.entities.EmployeePayment.list('-payment_date', 1000).catch(() => []),
        base44.entities.Employee.list('name', 500).catch(() => []),
        base44.entities.Vale.list('-date', 1000).catch(() => []),
        base44.entities.Consumption.list('-date', 1000).catch(() => []),
        base44.entities.ExpenseCategory.list('name', 300).catch(() => []),
        base44.entities.CostCenter.list('name', 300).catch(() => []),
        base44.entities.AccountsPayable.list('due_date', 1000).catch(() => []),
        base44.entities.FinancialAccount.list('name', 200).catch(() => []),
        base44.entities.RecurringExpense.list('next_due_date', 300).catch(() => []),
        base44.entities.DailyFinancialClose.list('-date', 300).catch(() => []),
        base44.entities.FechamentoCaixa.list('-date', 1000).catch(() => []),
        base44.entities.Sangria.list('-date', 1000).catch(() => []),
        isAdmin ? base44.entities.CashMovement.list('-date', 1500).catch(() => []) : Promise.resolve([]),
      ]);
      setData({ expenses, payments, employees, vales, consumptions, categories, centers, payables, accounts, recurrings, closes, fechamentosCaixa, sangrias, cashMovements });
    } catch (e) {
      setLoadError(e?.message || 'Não foi possível carregar os gastos.');
      toast({ title: 'Falha ao carregar o financeiro', description: e?.message || 'Verifique a conexão.', variant: 'destructive' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin) return undefined;
    // Reflete lançamentos feitos em outra aba/máquina sem exigir F5.
    const uns = ['CashMovement', 'FinancialExpense'].map((n) => base44.entities[n]?.subscribe?.(() => load()));
    return () => uns.forEach((u) => { try { u?.(); } catch { /* noop */ } });
  }, [isAdmin]);

  const periodExpenses = useMemo(() => data.expenses.filter(x => x.status !== 'cancelado' && x.date >= start && x.date <= end), [data.expenses,start,end]);
  // Cancelados saem dos totais, mas continuam consultáveis (rastreabilidade).
  const allPeriodExpenses = useMemo(() => data.expenses.filter(x => x.date >= start && x.date <= end), [data.expenses,start,end]);
  const expenseFiltered = useMemo(() => {
    const base = showCancelled ? allPeriodExpenses : periodExpenses;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(x => `${x.description||''} ${x.category_name||''} ${x.beneficiary_name||''}`.toLowerCase().includes(q));
  }, [allPeriodExpenses, periodExpenses, search, showCancelled]);

  // Cancelar é lógico (nunca DELETE): o lançamento continua no banco para
  // auditoria, apenas sai das somas — o mesmo padrão já usado em vales e
  // contas a pagar.
  const cancelExpense = async (expense) => {
    if (!expense?.id) return;
    if (!window.confirm(`Cancelar o gasto "${expense.description}" de ${brl(expense.amount)}?\n\nO lançamento será mantido no histórico e deixará de contar nos totais.`)) return;
    try {
      await base44.entities.FinancialExpense.update(expense.id, {
        status: 'cancelado',
        cancelled_at: new Date().toISOString(),
        cancelled_by: currentUserName(),
      });
      await logAudit({ entity_type: 'FinancialExpense', entity_id: expense.id, action: 'exclusao_logica', field: 'status', old_value: expense.status, new_value: 'cancelado', reason: 'Cancelado pelo usuário', responsible_user: currentUserName() });
      toast({ title: 'Gasto cancelado.' });
      await load();
    } catch (e) {
      toast({ title: 'Não foi possível cancelar', description: e?.message || 'Tente novamente.', variant: 'destructive' });
    }
  };
  const periodPayments = useMemo(() => data.payments.filter(x => x.status !== 'cancelado' && (x.payment_date || x.work_date || x.reference_start || '') >= start && (x.payment_date || x.work_date || x.reference_start || '') <= end), [data.payments,start,end]);
  const periodVales = useMemo(() => data.vales.filter(x => x.status !== 'cancelado' && x.date >= start && x.date <= end), [data.vales,start,end]);
  const periodConsumptions = useMemo(() => data.consumptions.filter(x => x.status !== 'cancelado' && x.date >= start && x.date <= end), [data.consumptions,start,end]);
  const employeePaymentSummary = useMemo(() => data.employees.map(employee => {
    const payments = periodPayments.filter(x => x.employee_id === employee.id);
    const vales = periodVales.filter(x => x.employee_id === employee.id);
    const consumptions = periodConsumptions.filter(x => x.employee_id === employee.id);
    const paymentsTotal = payments.reduce((sum, x) => sum + Number(x.net_amount || 0), 0);
    const pendingVales = vales.filter(x => x.status === 'pendente').reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const pendingConsumptions = consumptions.filter(x => x.status === 'registrado').reduce((sum, x) => sum + Number(x.amount || 0), 0);
    return { employee, payments, vales, consumptions, paymentsTotal, pendingVales, pendingConsumptions, pendingDiscounts: pendingVales + pendingConsumptions };
  }).filter(x => x.payments.length || x.vales.length || x.consumptions.length), [data.employees,periodPayments,periodVales,periodConsumptions]);
  const employeeSummaryFiltered = useMemo(() => employeePaymentSummary.filter(x => `${x.employee.name || ''} ${x.employee.sector || ''} ${x.employee.function || ''}`.toLowerCase().includes(search.toLowerCase())), [employeePaymentSummary,search]);
  const stats = useMemo(() => {
    const paid = periodExpenses.filter(x=>x.status==='pago').reduce((s,x)=>s+Number(x.amount||0),0);
    const personnel = periodExpenses.filter(x=>x.classification==='pagamento_colaborador').reduce((s,x)=>s+Number(x.amount||0),0);
    const advances = periodExpenses.filter(x=>x.classification==='adiantamento_colaborador').reduce((s,x)=>s+Number(x.amount||0),0);
    const inputs = periodExpenses.filter(x=>x.classification==='compra_insumo').reduce((s,x)=>s+Number(x.amount||0),0);
    const motoboy = periodPayments.filter(x=>x.payment_type==='diaria_motoboy' && x.status==='pago').reduce((s,x)=>s+Number(x.net_amount||0),0);
    const pending = periodExpenses.filter(x=>x.status==='pendente').reduce((s,x)=>s+Number(x.amount||0),0);
    const noProof = periodExpenses.filter(x=>x.status==='pago' && !x.proof_url).length;
    return { paid, personnel, advances, inputs, motoboy, pending, noProof };
  }, [periodExpenses, periodPayments]);

  const paymentFiltered = useMemo(() => periodPayments.filter(x => `${x.employee_name||''} ${PAYMENT_LABELS[x.payment_type]||''}`.toLowerCase().includes(search.toLowerCase())), [periodPayments,search]);

  return <div className="space-y-5">
    {tab !== 'caixasdelivery' && <>
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Financeiro · Gastos & Pagamentos</h1><p className="text-sm text-slate-500">Saídas da operação, pagamentos de pessoas, diárias, vales e comprovantes</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={()=>setPaymentOpen(true)} className="gap-2"><Users className="w-4 h-4"/> Pagamento</Button>
          <Button variant="outline" onClick={()=>setBatchOpen(true)} className="gap-2"><Users className="w-4 h-4"/> Lançar em lote</Button>
          <Button variant="outline" onClick={()=>setConsumptionOpen(true)} className="gap-2"><Package className="w-4 h-4"/> Novo consumo</Button>
          <Button onClick={()=>setExpenseOpen(true)} className="gap-2"><Plus className="w-4 h-4"/> Novo gasto</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Saídas pagas" value={brl(stats.paid)} icon={Wallet}/>
        <Stat label="Pagamentos de pessoas" value={brl(stats.personnel)} icon={Users}/>
        <Stat label="Diárias de motoboy" value={brl(stats.motoboy)} icon={Bike}/>
        <Stat label="Insumos" value={brl(stats.inputs)} icon={Package}/>
        <Stat label="Vales/adiantamentos" value={brl(stats.advances)} icon={BadgeDollarSign}/>
        <Stat label="Pendentes" value={brl(stats.pending)} icon={Receipt} danger={stats.pending>0}/>
        <Stat label="Pagos sem comprovante" value={stats.noProof} icon={AlertTriangle} danger={stats.noProof>0}/>
        <Stat label="Lançamentos no período" value={periodExpenses.length} icon={Receipt}/>
      </div>
    </>}

    {loadError&&<div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">Falha ao acessar o banco</p><p className="mt-1">{loadError}</p><Button size="sm" variant="outline" className="mt-2" onClick={()=>load()}>Tentar novamente</Button></div>}

    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3">
      <div className="space-y-1">
        <label className="text-xs text-slate-500">Data inicial</label>
        <Input type="date" value={start} onChange={e=>setStart(e.target.value)} className="h-9 w-44" />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-slate-500">Data final</label>
        <Input type="date" value={end} onChange={e=>setEnd(e.target.value)} className="h-9 w-44" />
      </div>
      <Button size="sm" variant="outline" onClick={()=>{setStart(monthStart());setEnd(today())}}>Este mês</Button>
      <Button size="sm" variant="outline" onClick={()=>{setStart(`${today().slice(0,7)}-01`);setEnd(`${today().slice(0,7)}-${new Date(Number(today().slice(0,4)),Number(today().slice(5,7)),0).getDate()}`)}}>Mês atual completo</Button>
      {start>end&&<span className="text-sm text-rose-600">A data inicial é posterior à final.</span>}
    </div>

    <div className="flex gap-1 overflow-x-auto">{[['visao','Visão geral'],...(isAdmin ? [['caixasdelivery','Caixas & Delivery']] : []),['contas','Contas a pagar'],['recorrentes','Recorrentes'],['gastos','Gastos'],['pagamentos','Pagamentos'],['vales','Vales'],['fechamento','Fechamento diário'],['fechamentocaixa','Fechamento de Caixa'],['sangrias','Sangrias'],['cadastros','Contas/Cadastros']].map(([k,l])=><button key={k} onClick={()=>setTab(k)} className={`whitespace-nowrap px-3.5 py-2 rounded-lg text-sm font-medium ${tab===k?'bg-slate-900 text-white':'bg-slate-100 text-slate-600'}`}>{l}</button>)}</div>

    {tab==='visao' && <Overview expenses={periodExpenses}/>} 
    {tab==='contas' && <PayablePanel rows={data.payables} data={data} onSaved={load}/>} 
    {tab==='recorrentes' && <RecurringPanel rows={data.recurrings} data={data} onSaved={load}/>} 
    {tab==='gastos' && <><SearchBox value={search} setValue={setSearch}/><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showCancelled} onChange={e=>setShowCancelled(e.target.checked)}/>Mostrar gastos cancelados</label><ExpenseTable rows={expenseFiltered} loading={loading} onEdit={x=>{setExpenseEditing(x);setExpenseOpen(true)}} onCancel={cancelExpense}/></>}
    {tab==='pagamentos' && <><SearchBox value={search} setValue={setSearch}/><EmployeePaymentSummary rows={employeeSummaryFiltered} loading={loading}/><div className="pt-2"><h3 className="font-semibold mb-2">Histórico de pagamentos registrados</h3><PaymentTable rows={paymentFiltered} loading={loading} onEdit={(r)=>{setPaymentEditing(r);setPaymentOpen(true)}}/></div></>}
    {tab==='vales' && <ValeFinanceTable rows={data.vales} onLaunch={setValeSelected}/>} 
    {tab==='fechamento' && <DailyClosePanel data={data} onSaved={load}/>} 
    {tab==='fechamentocaixa' && <FechamentoCaixaPanel records={data.fechamentosCaixa} onSaved={load}/>} 
    {tab==='sangrias' && <SangriaPanel records={data.sangrias} onSaved={load}/>} 
    {tab==='caixasdelivery' && isAdmin && <CashMovementPanel records={data.cashMovements} accounts={data.accounts} onSaved={load}/>} 
    {tab==='cadastros' && <Settings data={data} onSaved={load}/>} 

    <ExpenseDialog open={expenseOpen} onClose={()=>{setExpenseOpen(false);setExpenseEditing(null)}} onSaved={load} data={data} editing={expenseEditing}/>
    <PaymentDialog open={paymentOpen} onClose={()=>{setPaymentOpen(false);setPaymentEditing(null)}} onSaved={load} data={data} editing={paymentEditing}/>
    <BatchPaymentDialog open={batchOpen} onClose={()=>setBatchOpen(false)} onSaved={load} data={data}/>
    <ConsumptionDialog open={consumptionOpen} onClose={()=>setConsumptionOpen(false)} onSaved={load} data={data}/>
    <ValeFinanceDialog vale={valeSelected} open={Boolean(valeSelected)} onClose={()=>setValeSelected(null)} onSaved={load} data={data}/>
  </div>;
}

function Stat({label,value,icon:Icon,danger}) { return <div className={`rounded-xl border p-4 ${danger?'border-rose-200 bg-rose-50':'border-slate-200 bg-white'}`}><div className="flex justify-between"><div><p className={`text-xs ${danger?'text-rose-600':'text-slate-500'}`}>{label}</p><p className={`text-xl font-semibold mt-1 ${danger?'text-rose-700':'text-slate-900'}`}>{value}</p></div><Icon className={`w-5 h-5 ${danger?'text-rose-500':'text-amber-600'}`}/></div></div> }
function SearchBox({value,setValue}) { return <div className="relative max-w-md"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input className="pl-9" placeholder="Buscar..." value={value} onChange={e=>setValue(e.target.value)}/></div> }

function Overview({expenses}) {
  const map={}; expenses.forEach(x=>{const k=x.category_name||CLASS_LABELS[x.classification]||'Sem categoria'; map[k]=(map[k]||0)+Number(x.amount||0)});
  const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  return <div className="grid lg:grid-cols-2 gap-4"><div className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-3">Gastos por categoria</h3>{rows.length?rows.map(([k,v])=><div key={k} className="flex justify-between py-2 border-b text-sm"><span>{k}</span><strong>{brl(v)}</strong></div>):<p className="text-sm text-slate-400">Sem lançamentos no período.</p>}</div><div className="rounded-xl border bg-white p-4"><h3 className="font-semibold mb-2">Como usar</h3><div className="text-sm text-slate-600 space-y-2"><p>• Gastos comuns entram em <b>Novo gasto</b>.</p><p>• Salários, diárias, extras e acertos entram em <b>Pagamento</b>.</p><p>• Vales já cadastrados no RH são lançados pela aba <b>Vales</b>, evitando duplicidade.</p><p>• Todo pagamento pode receber comprovante e nota/documento fiscal.</p></div></div></div>
}

function ExpenseTable({rows,loading,onEdit,onCancel}) { return <div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[980px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Data','Descrição','Categoria','Centro de custo','Favorecido','Valor','Pagamento','Comprovante','Status','Ação'].map(h=><th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{loading?<tr><td colSpan={10} className="p-10 text-center text-slate-400">Carregando...</td></tr>:rows.length?rows.map(x=><tr key={x.id} className={x.status==='cancelado'?'opacity-50':''}><td className="px-4 py-3">{fmt(x.date)}</td><td className="px-4 py-3 font-medium">{x.description}</td><td className="px-4 py-3">{x.category_name||CLASS_LABELS[x.classification]||'—'}</td><td className="px-4 py-3">{x.cost_center_name||'—'}</td><td className="px-4 py-3">{x.beneficiary_name||'—'}</td><td className="px-4 py-3 font-semibold">{brl(x.amount)}</td><td className="px-4 py-3">{METHOD_LABELS[x.payment_method]||x.payment_method||'—'}</td><td className="px-4 py-3">{x.proof_url?<a className="text-emerald-700 underline" href={x.proof_url} target="_blank" rel="noreferrer">Abrir</a>:<span className="text-amber-600">Pendente</span>}</td><td className="px-4 py-3 capitalize">{x.status}</td><td className="px-4 py-3">{x.status!=='cancelado'&&<div className="flex items-center gap-1"><Button size="sm" variant="outline" onClick={()=>onEdit?.(x)}>Editar</Button><Button size="sm" variant="ghost" className="text-rose-600" onClick={()=>onCancel?.(x)}>Cancelar</Button></div>}</td></tr>):<tr><td colSpan={10} className="p-10 text-center text-slate-400">Nenhum gasto encontrado.</td></tr>}</tbody></table></div></div> }

function EmployeePaymentSummary({rows,loading}) {
  return <div className="rounded-xl border bg-white overflow-hidden"><div className="p-4 border-b"><h3 className="font-semibold">Resumo por colaborador</h3><p className="text-xs text-slate-500">Pagamentos, vales e consumos do período selecionado. Apenas vales pendentes e consumos registrados entram em “A descontar”.</p></div><div className="overflow-x-auto"><table className="w-full text-sm min-w-[900px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Colaborador','Setor/Função','Pagamentos','Vales','Consumos','A descontar','Saldo após descontos'].map(h=><th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{loading?<tr><td colSpan={7} className="p-10 text-center text-slate-400">Carregando...</td></tr>:rows.length?rows.map(x=><tr key={x.employee.id}><td className="px-4 py-3 font-medium">{x.employee.name}</td><td className="px-4 py-3 text-slate-600">{[x.employee.sector,x.employee.function].filter(Boolean).join(' · ')||'—'}</td><td className="px-4 py-3"><strong>{brl(x.paymentsTotal)}</strong><div className="text-xs text-slate-400">{x.payments.length} registro(s)</div></td><td className="px-4 py-3">{brl(x.vales.reduce((s,v)=>s+Number(v.amount||0),0))}<div className="text-xs text-amber-600">Pendente: {brl(x.pendingVales)}</div></td><td className="px-4 py-3">{brl(x.consumptions.reduce((s,c)=>s+Number(c.amount||0),0))}<div className="text-xs text-amber-600">A cobrar: {brl(x.pendingConsumptions)}</div></td><td className="px-4 py-3 font-semibold text-rose-700">{brl(x.pendingDiscounts)}</td><td className={`px-4 py-3 font-semibold ${x.paymentsTotal-x.pendingDiscounts<0?'text-rose-700':'text-emerald-700'}`}>{brl(x.paymentsTotal-x.pendingDiscounts)}</td></tr>):<tr><td colSpan={7} className="p-10 text-center text-slate-400">Nenhum pagamento, vale ou consumo encontrado no período.</td></tr>}</tbody></table></div></div>
}

function PaymentTable({rows,loading,onEdit}) { return <div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[900px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Data','Colaborador','Tipo','Referência','Valor','Forma','Comprovante','Status','Ação'].map(h=><th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{loading?<tr><td colSpan={9} className="p-10 text-center text-slate-400">Carregando...</td></tr>:rows.length?rows.map(x=><tr key={x.id}><td className="px-4 py-3">{fmt(x.payment_date||x.work_date)}</td><td className="px-4 py-3 font-medium">{x.employee_name}</td><td className="px-4 py-3">{PAYMENT_LABELS[x.payment_type]||x.payment_type}</td><td className="px-4 py-3">{x.work_date?fmt(x.work_date):`${fmt(x.reference_start)} a ${fmt(x.reference_end)}`}</td><td className="px-4 py-3 font-semibold">{brl(x.net_amount)}</td><td className="px-4 py-3">{METHOD_LABELS[x.payment_method]||x.payment_method}</td><td className="px-4 py-3">{x.proof_url?<a className="text-emerald-700 underline" href={x.proof_url} target="_blank" rel="noreferrer">Abrir</a>:<span className="text-amber-600">Pendente</span>}</td><td className="px-4 py-3 capitalize">{x.status}</td><td className="px-4 py-3"><button onClick={()=>onEdit?.(x)} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500" title="Editar"><Pencil className="w-4 h-4"/></button></td></tr>):<tr><td colSpan={9} className="p-10 text-center text-slate-400">Nenhum pagamento registrado.</td></tr>}</tbody></table></div></div> }

function ValeFinanceTable({rows,onLaunch}) { const list=rows.filter(x=>x.status!=='cancelado'); return <div className="rounded-xl border bg-white overflow-hidden"><div className="p-4 border-b"><h3 className="font-semibold">Vales do RH</h3><p className="text-xs text-slate-500">O vale continua controlado no RH; aqui registramos a saída financeira e o comprovante.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="text-left px-4 py-3">Data</th><th className="text-left px-4 py-3">Colaborador</th><th className="text-left px-4 py-3">Valor</th><th className="text-left px-4 py-3">Financeiro</th><th className="text-right px-4 py-3">Ação</th></tr></thead><tbody className="divide-y">{list.length?list.map(v=><tr key={v.id}><td className="px-4 py-3">{fmt(v.date)}</td><td className="px-4 py-3 font-medium">{v.employee_name}</td><td className="px-4 py-3">{brl(v.amount)}</td><td className="px-4 py-3">{v.financial_expense_id?<span className="text-emerald-700">Lançado ✓</span>:<span className="text-amber-600">Não lançado</span>}</td><td className="px-4 py-3 text-right">{!v.financial_expense_id&&<Button size="sm" variant="outline" onClick={()=>onLaunch(v)}>Lançar saída</Button>}</td></tr>):<tr><td colSpan={5} className="p-8 text-center text-slate-400">Nenhum vale cadastrado.</td></tr>}</tbody></table></div></div> }

function ExpenseDialog({open,onClose,onSaved,data,editing}) {
  const empty={date:today(),paid_date:today(),description:'',classification:'despesa_operacional',category_id:'',cost_center_id:'',beneficiary_type:'outro',beneficiary_name:'',employee_id:'',amount:'',payment_method:'pix',account:'',document_number:'',proof_url:'',invoice_url:'',status:'pago',observation:''};
  const isEdit=Boolean(editing&&editing.id);
  const [f,setF]=useState(empty); const [saving,setSaving]=useState(false); const [up,setUp]=useState(''); const [error,setError]=useState(''); const proof=useRef(); const invoice=useRef();
  useEffect(()=>{
    if(!open)return;
    setError('');
    if(isEdit)setF({...empty,...editing,amount:Number(editing.amount||0)||'',paid_date:editing.paid_date||editing.date||today()});
    else setF(empty);
  },[open,editing,isEdit]);
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const upload=async(file,key)=>{if(!file)return;setUp(key);try{const {file_url}=await base44.integrations.Core.UploadFile({file});set(key,file_url)}catch(e){setError(e?.message||'Falha ao anexar o arquivo.')}finally{setUp('')}};
  // Valores monetários são numéricos no estado e no banco; a vírgula só
  // existe na tela (CurrencyInput). "25,50" -> 25.5, nunca 2550 nem 25.
  const amount=Number(f.amount);
  const validate=()=>{
    if(!f.description?.trim())return 'Informe a descrição do gasto.';
    if(f.amount===''||f.amount===null||f.amount===undefined)return 'Informe o valor do gasto.';
    if(!Number.isFinite(amount))return 'Valor inválido.';
    if(amount<=0)return 'O valor precisa ser maior que zero.';
    if(f.date&&!/^\d{4}-\d{2}-\d{2}$/.test(f.date))return 'Data inválida.';
    if(f.beneficiary_type==='colaborador'&&!f.employee_id)return 'Selecione o colaborador.';
    return '';
  };
  const save=async()=>{
    if(saving)return;
    const problem=validate();if(problem){setError(problem);return;}
    setSaving(true);setError('');
    try{
      const cat=data.categories.find(x=>x.id===f.category_id), center=data.centers.find(x=>x.id===f.cost_center_id);
      const emp=f.beneficiary_type==='colaborador'?data.employees.find(x=>x.id===f.employee_id):null;
      const paidDate=f.status==='pago'?(f.paid_date||f.date):'';
      const payload={...f,description:f.description.trim(),amount:roundMoney(amount),category_name:cat?.name||'',cost_center_name:center?.name||'',beneficiary_id:emp?.id||'',beneficiary_name:emp?emp.name:f.beneficiary_name,paid_date:paidDate};
      if(isEdit){
        // Editar não recria o lançamento: o mesmo FinancialExpense é atualizado,
        // então o Financeiro continua contando o gasto uma única vez.
        await base44.entities.FinancialExpense.update(editing.id,{...payload,updated_by:currentUserName()});
        await logAudit({entity_type:'FinancialExpense',entity_id:editing.id,action:'alteracao',field:'amount',old_value:editing.amount,new_value:payload.amount,responsible_user:currentUserName()});
        toast({title:'Gasto atualizado.'});
      }else{
        const expense=await base44.entities.FinancialExpense.create({...payload,origin_type:'manual',responsible_user:currentUserName()});
        await logAudit({entity_type:'FinancialExpense',entity_id:expense.id,action:'criacao',new_value:`${payload.description} · R$ ${payload.amount}`,responsible_user:currentUserName()});
        // Quando o gasto é de um colaborador, também lança um pagamento vinculado a ele, para aparecer na ficha da pessoa.
        if(emp){
          const payType=f.classification==='adiantamento_colaborador'?'adiantamento':'outros';
          const pay=await base44.entities.EmployeePayment.create({employee_id:emp.id,employee_name:emp.name,sector:emp.sector||'',function:emp.function||'',payment_type:payType,reference_start:f.date,reference_end:f.date,work_date:f.date,days_quantity:1,daily_rate:0,gross_amount:payload.amount,discount_amount:0,net_amount:payload.amount,payment_date:paidDate||f.date,payment_method:f.payment_method,status:f.status,proof_url:f.proof_url,observation:f.observation,responsible_user:currentUserName()});
          await base44.entities.EmployeePayment.update(pay.id,{financial_expense_id:expense.id});
        }
        toast({title:'Gasto salvo.',description:`R$ ${brl(payload.amount)}`});
      }
      onClose();await onSaved();
    }catch(e){setError(e?.message||'Não foi possível salvar o gasto.');}
    finally{setSaving(false)}
  };
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{isEdit?'Editar gasto':'Novo gasto'}</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3"><Field l="Data"><Input type="date" value={f.date} onChange={e=>set('date',e.target.value)}/></Field><Field l="Status"><Select v={f.status} on={v=>set('status',v)} opts={[['pago','Pago'],['pendente','Pendente']]}/></Field><div className="sm:col-span-2"><Field l="Descrição"><Input value={f.description} onChange={e=>set('description',e.target.value)} placeholder="Ex.: Compra de queijo, gás, manutenção..."/></Field></div><Field l="Classificação"><Select v={f.classification} on={v=>set('classification',v)} opts={Object.entries(CLASS_LABELS)}/></Field><Field l="Categoria"><select className={inputCls} value={f.category_id} onChange={e=>set('category_id',e.target.value)}><option value="">Selecione...</option>{data.categories.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Centro de custo"><select className={inputCls} value={f.cost_center_id} onChange={e=>set('cost_center_id',e.target.value)}><option value="">Selecione...</option>{data.centers.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Tipo de favorecido"><Select v={f.beneficiary_type} on={v=>{set('beneficiary_type',v);set('employee_id','');set('beneficiary_name','')}} opts={[['fornecedor','Fornecedor'],['colaborador','Colaborador'],['outro','Outro']]}/></Field>{f.beneficiary_type==='colaborador'?<Field l="Colaborador"><select className={inputCls} value={f.employee_id} onChange={e=>{const emp=data.employees.find(x=>x.id===e.target.value);set('employee_id',e.target.value);set('beneficiary_name',emp?.name||'')}}><option value="">Selecione...</option>{data.employees.filter(x=>x.status!=='inativo').map(x=><option key={x.id} value={x.id}>{x.name} {x.function?`· ${x.function}`:''}</option>)}</select></Field>:<Field l="Favorecido"><Input value={f.beneficiary_name} onChange={e=>set('beneficiary_name',e.target.value)} placeholder="Fornecedor, pessoa, estabelecimento..."/></Field>}<Field l="Valor *"><CurrencyInput value={f.amount} onChange={v=>set('amount',v)}/></Field><Field l="Forma de pagamento"><Select v={f.payment_method} on={v=>set('payment_method',v)} opts={Object.entries(METHOD_LABELS)}/></Field><Field l="Conta/Caixa de origem"><Input value={f.account} onChange={e=>set('account',e.target.value)} placeholder="Ex.: Itaú, Caixa loja, Mercado Pago"/></Field>{f.status==='pago'&&<Field l="Data do pagamento"><Input type="date" value={f.paid_date} onChange={e=>set('paid_date',e.target.value)}/></Field>}<Field l="Nº NF/Documento"><Input value={f.document_number} onChange={e=>set('document_number',e.target.value)}/></Field><div className="sm:col-span-2"><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e=>set('observation',e.target.value)}/></Field></div><UploadField label="Comprovante" value={f.proof_url} busy={up==='proof_url'} refEl={proof} onFile={file=>upload(file,'proof_url')}/><UploadField label="Nota/Documento fiscal" value={f.invoice_url} busy={up==='invoice_url'} refEl={invoice} onFile={file=>upload(file,'invoice_url')}/></div>{error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}<DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||!!validate()}>{saving?'Salvando...':isEdit?'Salvar alterações':'Salvar gasto'}</Button></DialogFooter></DialogContent></Dialog>
}

function PaymentDialog({open,onClose,onSaved,data,editing}) {
  const empty={employee_id:'',payment_type:'salario',reference_start:monthStart(),reference_end:today(),work_date:today(),days_quantity:'1',daily_rate:'',gross_amount:'',discount_amount:'0',net_amount:'',payment_date:today(),payment_method:'pix',proof_url:'',observation:'',status:'pago'};
  const [f,setF]=useState(empty);const [saving,setSaving]=useState(false);const [uploading,setUploading]=useState(false);const fileRef=useRef();
  const [multi,setMulti]=useState(false); const [rows,setRows]=useState({});
  useEffect(()=>{if(open){if(editing){setF({...empty,...editing,days_quantity:String(editing.days_quantity||1),daily_rate:String(editing.daily_rate||''),gross_amount:String(editing.gross_amount||''),discount_amount:String(editing.discount_amount||0),net_amount:String(editing.net_amount||'')});setMulti(false)}else{setF(empty);setMulti(false);setRows({})}}},[open,editing]);const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const isDaily=['diaria_motoboy','diaria_freelancer'].includes(f.payment_type);
  useEffect(()=>{if(isDaily&&Number(f.daily_rate)){const gross=Number(f.days_quantity||1)*Number(f.daily_rate||0);setF(x=>({...x,gross_amount:String(gross),net_amount:String(gross-Number(x.discount_amount||0))}))}},[f.days_quantity,f.daily_rate,f.payment_type]);
  const upload=async(file)=>{if(!file)return;setUploading(true);try{const {file_url}=await base44.integrations.Core.UploadFile({file});set('proof_url',file_url)}finally{setUploading(false)}};
  const toggleRow=(id)=>setRows(r=>{const next={...r};if(next[id])delete next[id];else next[id]={amount:''};return next});
  const setRowAmount=(id,v)=>setRows(r=>({...r,[id]:{...r[id],amount:v}}));
  const selectedIds=Object.keys(rows).filter(id=>Number(rows[id]?.amount)>0);
  const save=async()=>{
    if(multi){
      if(!selectedIds.length)return;
      setSaving(true);
      try{
        const catName=f.payment_type==='diaria_motoboy'?'Diárias de motoboys':f.payment_type==='diaria_freelancer'?'Diárias de freelancers':(f.payment_type==='vale'||f.payment_type==='adiantamento')?'Vales e adiantamentos':f.payment_type==='hora_extra'?'Horas extras e adicionais':'Salários';
        const cat=data.categories.find(x=>x.name===catName);
        for(const id of selectedIds){
          const emp=data.employees.find(x=>x.id===id); if(!emp)continue;
          const net=Number(rows[id].amount);
          const pay=await base44.entities.EmployeePayment.create({employee_id:id,employee_name:emp.name,sector:emp.sector||'',function:emp.function||'',payment_type:f.payment_type,reference_start:f.reference_start,reference_end:f.reference_end,work_date:f.work_date,days_quantity:Number(f.days_quantity||1),daily_rate:Number(f.daily_rate||0),gross_amount:net,discount_amount:0,net_amount:net,payment_date:f.payment_date,payment_method:f.payment_method,status:f.status,proof_url:f.proof_url,observation:f.observation,responsible_user:currentUserName()});
          const expense=await base44.entities.FinancialExpense.create({date:f.payment_date||f.work_date||today(),paid_date:f.status==='pago'?(f.payment_date||today()):'',description:`${PAYMENT_LABELS[f.payment_type]||'Pagamento'} - ${emp.name}`,classification:['vale','adiantamento'].includes(f.payment_type)?'adiantamento_colaborador':f.payment_type==='diaria_motoboy'?'logistica_delivery':'pagamento_colaborador',category_id:cat?.id||'',category_name:catName,beneficiary_type:'colaborador',beneficiary_id:emp.id,beneficiary_name:emp.name,amount:net,payment_method:f.payment_method,proof_url:f.proof_url,origin_type:'pagamento_colaborador',origin_id:pay.id,status:f.status,responsible_user:currentUserName(),observation:f.observation});
          await base44.entities.EmployeePayment.update(pay.id,{financial_expense_id:expense.id});
        }
        onClose();await onSaved();
      }finally{setSaving(false)}
      return;
    }
    const emp=data.employees.find(x=>x.id===f.employee_id)||{name:editing?.employee_name||'',sector:editing?.sector||'',function:editing?.function||'',id:f.employee_id};if(!f.employee_id||!Number(f.net_amount))return;setSaving(true);try{const gross=Number(f.gross_amount||f.net_amount), discount=Number(f.discount_amount||0), net=Number(f.net_amount||gross-discount);const catName=f.payment_type==='diaria_motoboy'?'Diárias de motoboys':f.payment_type==='diaria_freelancer'?'Diárias de freelancers':f.payment_type==='vale'||f.payment_type==='adiantamento'?'Vales e adiantamentos':f.payment_type==='hora_extra'?'Horas extras e adicionais':'Salários';const cat=data.categories.find(x=>x.name===catName);if(editing){await base44.entities.EmployeePayment.update(editing.id,{...f,employee_name:emp.name,sector:emp.sector||'',function:emp.function||'',days_quantity:Number(f.days_quantity||1),daily_rate:Number(f.daily_rate||0),gross_amount:gross,discount_amount:discount,net_amount:net,responsible_user:currentUserName()});if(editing.financial_expense_id){await base44.entities.FinancialExpense.update(editing.financial_expense_id,{date:f.payment_date||f.work_date||today(),paid_date:f.status==='pago'?(f.payment_date||today()):'',description:`${PAYMENT_LABELS[f.payment_type]||'Pagamento'} - ${emp.name}`,amount:net,payment_method:f.payment_method,proof_url:f.proof_url,status:f.status,observation:f.observation})}}else{const pay=await base44.entities.EmployeePayment.create({...f,employee_name:emp.name,sector:emp.sector||'',function:emp.function||'',days_quantity:Number(f.days_quantity||1),daily_rate:Number(f.daily_rate||0),gross_amount:gross,discount_amount:discount,net_amount:net,responsible_user:currentUserName()});const expense=await base44.entities.FinancialExpense.create({date:f.payment_date||f.work_date||today(),paid_date:f.status==='pago'?(f.payment_date||today()):'',description:`${PAYMENT_LABELS[f.payment_type]||'Pagamento'} - ${emp.name}`,classification:['vale','adiantamento'].includes(f.payment_type)?'adiantamento_colaborador':f.payment_type==='diaria_motoboy'?'logistica_delivery':'pagamento_colaborador',category_id:cat?.id||'',category_name:catName,beneficiary_type:'colaborador',beneficiary_id:emp.id,beneficiary_name:emp.name,amount:net,payment_method:f.payment_method,proof_url:f.proof_url,origin_type:'pagamento_colaborador',origin_id:pay.id,status:f.status,responsible_user:currentUserName(),observation:f.observation});await base44.entities.EmployeePayment.update(pay.id,{financial_expense_id:expense.id})}onClose();await onSaved()}finally{setSaving(false)}
  };
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing?'Editar pagamento':multi?'Registrar pagamento para vários colaboradores':'Registrar pagamento de colaborador'}</DialogTitle></DialogHeader>
    {!editing&&<div className="flex items-center gap-2 mb-3"><input type="checkbox" id="multiPay" checked={multi} onChange={e=>setMulti(e.target.checked)}/><label htmlFor="multiPay" className="text-sm">Pagar para vários colaboradores de uma vez</label></div>}
    <div className="grid sm:grid-cols-2 gap-3">
      {!multi&&<Field l="Colaborador">{editing?<Input value={f.employee_name||editing.employee_name||''} disabled className="bg-slate-50"/>:<select className={inputCls} value={f.employee_id} onChange={e=>set('employee_id',e.target.value)}><option value="">Selecione...</option>{data.employees.filter(x=>x.status!=='inativo').map(x=><option key={x.id} value={x.id}>{x.name} {x.function?`· ${x.function}`:''}</option>)}</select>}</Field>}
      <Field l="Tipo"><Select v={f.payment_type} on={v=>set('payment_type',v)} opts={Object.entries(PAYMENT_LABELS)}/></Field>
      {isDaily?<><Field l="Data da diária"><Input type="date" value={f.work_date} onChange={e=>set('work_date',e.target.value)}/></Field><Field l="Quantidade de diárias"><Input type="number" value={f.days_quantity} onChange={e=>set('days_quantity',e.target.value)}/></Field>{!multi&&<Field l="Valor da diária"><CurrencyInput value={f.daily_rate} onChange={v=>set('daily_rate',v)}/></Field>}</>:<><Field l="Referência inicial"><Input type="date" value={f.reference_start} onChange={e=>set('reference_start',e.target.value)}/></Field><Field l="Referência final"><Input type="date" value={f.reference_end} onChange={e=>set('reference_end',e.target.value)}/></Field></>}
      {!multi&&<><Field l="Valor bruto"><CurrencyInput value={f.gross_amount} onChange={v=>{set('gross_amount',v);set('net_amount',String(Number(v||0)-Number(f.discount_amount||0)))}}/></Field><Field l="Descontos"><CurrencyInput value={f.discount_amount} onChange={v=>{set('discount_amount',v);set('net_amount',String(Number(f.gross_amount||0)-Number(v||0)))}}/></Field><Field l="Valor líquido"><CurrencyInput value={f.net_amount} onChange={v=>set('net_amount',v)}/></Field></>}
      <Field l="Data do pagamento"><Input type="date" value={f.payment_date} onChange={e=>set('payment_date',e.target.value)}/></Field>
      <Field l="Forma de pagamento"><Select v={f.payment_method} on={v=>set('payment_method',v)} opts={Object.entries(METHOD_LABELS).filter(([k])=>k!=='boleto')}/></Field>
      <Field l="Status"><Select v={f.status} on={v=>set('status',v)} opts={[['pago','Pago'],['pendente','Pendente']]}/></Field>
      <div className="sm:col-span-2"><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e=>set('observation',e.target.value)}/></Field></div>
      {!multi&&<div className="sm:col-span-2"><UploadField label="Comprovante de pagamento" value={f.proof_url} busy={uploading} refEl={fileRef} onFile={upload}/></div>}
      {multi&&<div className="sm:col-span-2"><Label className="text-xs">Colaboradores e valores</Label><div className="divide-y border rounded-lg mt-1 max-h-64 overflow-y-auto">{data.employees.filter(x=>x.status!=='inativo').map(emp=><div key={emp.id} className="flex items-center gap-3 p-2"><input type="checkbox" checked={!!rows[emp.id]} onChange={()=>toggleRow(emp.id)}/><span className="flex-1 text-sm">{emp.name} {emp.function?`· ${emp.function}`:''}</span>{rows[emp.id]&&<div className="w-32"><CurrencyInput value={rows[emp.id].amount} onChange={v=>setRowAmount(emp.id,v)}/></div>}</div>)}</div></div>}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||(multi?!selectedIds.length:(!f.employee_id||!Number(f.net_amount)))}>{saving?'Salvando...':editing?'Salvar alterações':multi?`Registrar ${selectedIds.length||''} pagamento(s)`:'Registrar pagamento'}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function BatchPaymentDialog({ open, onClose, onSaved, data }) {
  const [paymentType, setPaymentType] = useState('vale');
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [rows, setRows] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setRows({}); setPaymentDate(today()); setPaymentType('vale'); setPaymentMethod('pix'); }
  }, [open]);

  const toggle = (id) => setRows(r => {
    const next = { ...r };
    if (next[id]) delete next[id]; else next[id] = { amount: '' };
    return next;
  });
  const setAmount = (id, v) => setRows(r => ({ ...r, [id]: { ...r[id], amount: v } }));
  const selectedIds = Object.keys(rows).filter(id => Number(rows[id]?.amount) > 0);

  const save = async () => {
    if (!selectedIds.length) return;
    setSaving(true);
    try {
      const catName = (paymentType === 'vale' || paymentType === 'adiantamento') ? 'Vales e adiantamentos' : 'Salários';
      const cat = data.categories.find(x => x.name === catName);
      for (const id of selectedIds) {
        const emp = data.employees.find(x => x.id === id);
        if (!emp) continue;
        const amount = Number(rows[id].amount);
        const pay = await base44.entities.EmployeePayment.create({
          employee_id: id, employee_name: emp.name, sector: emp.sector || '', function: emp.function || '',
          payment_type: paymentType, reference_start: paymentDate, reference_end: paymentDate,
          work_date: paymentDate, days_quantity: 1, daily_rate: 0,
          gross_amount: amount, discount_amount: 0, net_amount: amount,
          payment_date: paymentDate, payment_method: paymentMethod, status: 'pago',
          responsible_user: currentUserName(),
        });
        const expense = await base44.entities.FinancialExpense.create({
          date: paymentDate, paid_date: paymentDate,
          description: `${PAYMENT_LABELS[paymentType] || 'Pagamento'} - ${emp.name}`,
          classification: 'adiantamento_colaborador',
          category_id: cat?.id || '', category_name: catName,
          beneficiary_type: 'colaborador', beneficiary_id: emp.id, beneficiary_name: emp.name,
          amount, payment_method: paymentMethod, origin_type: 'pagamento_colaborador',
          origin_id: pay.id, status: 'pago', responsible_user: currentUserName(),
        });
        await base44.entities.EmployeePayment.update(pay.id, { financial_expense_id: expense.id });
      }
      onClose();
      await onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Lançar vales em lote</DialogTitle></DialogHeader>
        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <Field l="Tipo"><Select v={paymentType} on={setPaymentType} opts={[['vale','Vale'],['adiantamento','Adiantamento']]}/></Field>
          <Field l="Data"><Input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></Field>
          <Field l="Forma de pagamento"><Select v={paymentMethod} on={setPaymentMethod} opts={Object.entries(METHOD_LABELS).filter(([k])=>k!=='boleto')}/></Field>
        </div>
        <div className="divide-y border rounded-lg">
          {data.employees.filter(x => x.status !== 'inativo').map(emp => (
            <div key={emp.id} className="flex items-center gap-3 p-2">
              <input type="checkbox" checked={!!rows[emp.id]} onChange={() => toggle(emp.id)} />
              <span className="flex-1 text-sm">{emp.name} {emp.function ? `· ${emp.function}` : ''}</span>
              {rows[emp.id] && (
                <div className="w-32">
                  <CurrencyInput value={rows[emp.id].amount} onChange={v => setAmount(emp.id, v)} />
                </div>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !selectedIds.length}>
            {saving ? 'Salvando...' : `Lançar ${selectedIds.length || ''} vale(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsumptionDialog({open,onClose,onSaved,data}) {
  const empty={employee_id:'',date:today(),time:'',product:'',quantity:'1',amount:''};
  const [f,setF]=useState(empty); const [saving,setSaving]=useState(false);
  useEffect(()=>{if(open)setF(empty)},[open]); const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const save=async()=>{
    const emp=data.employees.find(x=>x.id===f.employee_id);
    if(!emp||!f.product||!Number(f.amount))return;
    setSaving(true);
    try{
      await base44.entities.Consumption.create({employee_id:emp.id,employee_name:emp.name,sector:emp.sector||'',date:f.date,time:f.time,product:f.product,quantity:Number(f.quantity||1),amount:Number(f.amount),registered_by:currentUserName(),status:'registrado'});
      onClose();await onSaved();
    }finally{setSaving(false)}
  };
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Novo consumo</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3"><div className="sm:col-span-2"><Field l="Colaborador"><select className={inputCls} value={f.employee_id} onChange={e=>set('employee_id',e.target.value)}><option value="">Selecione...</option>{data.employees.filter(x=>x.status!=='inativo').map(x=><option key={x.id} value={x.id}>{x.name} {x.function?`· ${x.function}`:''}</option>)}</select></Field></div><Field l="Data"><Input type="date" value={f.date} onChange={e=>set('date',e.target.value)}/></Field><Field l="Horário"><Input type="time" value={f.time} onChange={e=>set('time',e.target.value)}/></Field><div className="sm:col-span-2"><Field l="Produto"><Input value={f.product} onChange={e=>set('product',e.target.value)} placeholder="Ex.: Marmita, refrigerante, lanche..."/></Field></div><Field l="Quantidade"><Input type="number" value={f.quantity} onChange={e=>set('quantity',e.target.value)}/></Field><Field l="Valor"><CurrencyInput value={f.amount} onChange={v=>set('amount',v)}/></Field></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||!f.employee_id||!f.product||!Number(f.amount)}>{saving?'Salvando...':'Registrar consumo'}</Button></DialogFooter></DialogContent></Dialog>
}

function ValeFinanceDialog({vale,open,onClose,onSaved,data}) {const [date,setDate]=useState(today());const [method,setMethod]=useState('pix');const [proofUrl,setProofUrl]=useState('');const [uploading,setUploading]=useState(false);const [saving,setSaving]=useState(false);const ref=useRef();useEffect(()=>{if(open){setDate(vale?.date||today());setMethod(vale?.payment_method||'pix');setProofUrl(vale?.proof_url||'')}},[open,vale]);if(!vale)return null;const upload=async(file)=>{if(!file)return;setUploading(true);try{const {file_url}=await base44.integrations.Core.UploadFile({file});setProofUrl(file_url)}finally{setUploading(false)}};const save=async()=>{setSaving(true);try{const emp=data.employees.find(x=>x.id===vale.employee_id);const pay=await base44.entities.EmployeePayment.create({employee_id:vale.employee_id,employee_name:vale.employee_name,sector:emp?.sector||vale.sector||'',function:emp?.function||'',payment_type:'vale',reference_start:vale.date,reference_end:vale.date,gross_amount:Number(vale.amount||0),discount_amount:0,net_amount:Number(vale.amount||0),payment_date:date,payment_method:method,proof_url:proofUrl,vale_id:vale.id,responsible_user:currentUserName(),status:'pago',observation:vale.motive||vale.observation||''});const cat=data.categories.find(x=>x.name==='Vales e adiantamentos');const expense=await base44.entities.FinancialExpense.create({date:vale.date,paid_date:date,description:`Vale - ${vale.employee_name}`,classification:'adiantamento_colaborador',category_id:cat?.id||'',category_name:'Vales e adiantamentos',beneficiary_type:'colaborador',beneficiary_id:vale.employee_id,beneficiary_name:vale.employee_name,amount:Number(vale.amount||0),payment_method:method,proof_url:proofUrl,origin_type:'vale',origin_id:vale.id,status:'pago',responsible_user:currentUserName(),observation:vale.motive||vale.observation||''});await base44.entities.EmployeePayment.update(pay.id,{financial_expense_id:expense.id});await base44.entities.Vale.update(vale.id,{paid_date:date,proof_url:proofUrl,financial_expense_id:expense.id,employee_payment_id:pay.id,payment_method:method});onClose();await onSaved()}finally{setSaving(false)}};return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Lançar vale no financeiro</DialogTitle></DialogHeader><div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{vale.employee_name}</p><p className="text-xl font-semibold">{brl(vale.amount)}</p></div><Field l="Data da saída"><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field><Field l="Forma de pagamento"><Select v={method} on={setMethod} opts={Object.entries(METHOD_LABELS).filter(([k])=>!['boleto','cartao_credito'].includes(k))}/></Field><UploadField label="Comprovante" value={proofUrl} busy={uploading} refEl={ref} onFile={upload}/><p className="text-xs text-slate-500">O status do vale no RH não será alterado. Ele continua pendente até ser descontado; aqui registramos apenas a saída do dinheiro.</p></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving}>{saving?'Salvando...':'Lançar saída'}</Button></DialogFooter></DialogContent></Dialog>}

function PayablePanel({rows,data,onSaved}) {
  const [createOpen,setCreateOpen]=useState(false); const [paying,setPaying]=useState(null); const [editing,setEditing]=useState(null);
  const pending=rows.filter(x=>!['pago','cancelado'].includes(x.status));
  const t=today(); const d7=new Date(); d7.setDate(d7.getDate()+7); const next7=d7.toISOString().slice(0,10);
  const overdue=pending.filter(x=>x.due_date<t); const dueToday=pending.filter(x=>x.due_date===t); const upcoming=pending.filter(x=>x.due_date>t&&x.due_date<=next7);
  const totalPending=pending.reduce((s,x)=>s+Number(x.amount||0),0);
  const statusFor=x=>x.status==='pago'?['Pago','text-emerald-700 bg-emerald-50']:x.status==='cancelado'?['Cancelado','text-slate-500 bg-slate-100']:x.due_date<t?['Vencida','text-rose-700 bg-rose-50']:x.due_date===t?['Vence hoje','text-amber-700 bg-amber-50']:['Pendente','text-blue-700 bg-blue-50'];
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between items-center gap-3"><div><h3 className="font-semibold text-slate-900">Contas a pagar</h3><p className="text-sm text-slate-500">Agenda de compromissos financeiros e vencimentos.</p></div><Button onClick={()=>setCreateOpen(true)} className="gap-2"><Plus className="w-4 h-4"/> Nova conta</Button></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="Total pendente" value={brl(totalPending)} icon={CalendarClock} danger={overdue.length>0}/><Stat label="Vencidas" value={overdue.length} icon={AlertTriangle} danger={overdue.length>0}/><Stat label="Vencem hoje" value={dueToday.length} icon={CalendarClock} danger={dueToday.length>0}/><Stat label="Próximos 7 dias" value={upcoming.length} icon={Receipt}/></div>
    {(overdue.length>0||dueToday.length>0)&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-900">Atenção financeira</p><p className="text-sm text-amber-800 mt-1">{overdue.length>0&&`${overdue.length} conta(s) vencida(s). `}{dueToday.length>0&&`${dueToday.length} conta(s) vencem hoje.`}</p></div>}
    <div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[950px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Vencimento','Descrição','Favorecido','Categoria','Centro de custo','Valor','Prioridade','Status','Ação'].map(h=><th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.length?rows.map(x=>{const st=statusFor(x);return <tr key={x.id} className={x.due_date<t&&!['pago','cancelado'].includes(x.status)?'bg-rose-50/40':''}><td className="px-4 py-3">{fmt(x.due_date)}</td><td className="px-4 py-3 font-medium">{x.description}</td><td className="px-4 py-3">{x.beneficiary_name||'—'}</td><td className="px-4 py-3">{x.category_name||'—'}</td><td className="px-4 py-3">{x.cost_center_name||'—'}</td><td className="px-4 py-3 font-semibold">{brl(x.amount)}</td><td className="px-4 py-3 capitalize">{x.priority||'normal'}</td><td className="px-4 py-3"><span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${st[1]}`}>{st[0]}</span></td><td className="px-4 py-3"><div className="flex items-center gap-1.5"><Button size="sm" variant="ghost" onClick={()=>setEditing(x)} className="gap-1 h-8 px-2"><Pencil className="w-3.5 h-3.5"/> Editar</Button>{!['pago','cancelado'].includes(x.status)?<Button size="sm" variant="outline" onClick={()=>setPaying(x)} className="gap-1"><CheckCircle2 className="w-3.5 h-3.5"/> Pagar</Button>:x.proof_url?<a href={x.proof_url} target="_blank" rel="noreferrer" className="text-emerald-700 underline text-xs">Comprovante</a>:null}</div></td></tr>}):<tr><td colSpan={9} className="p-10 text-center text-slate-400">Nenhuma conta a pagar cadastrada.</td></tr>}</tbody></table></div></div>
    <PayableCreateDialog open={createOpen} onClose={()=>setCreateOpen(false)} data={data} onSaved={onSaved}/>
    <PayableCreateDialog open={Boolean(editing)} editing={editing} onClose={()=>setEditing(null)} data={data} onSaved={onSaved}/>
    <PayablePaymentDialog payable={paying} open={Boolean(paying)} onClose={()=>setPaying(null)} data={data} onSaved={onSaved}/>
  </div>
}

function PayableCreateDialog({open,onClose,data,onSaved,editing}) {
  const empty={description:'',issue_date:today(),due_date:today(),amount:'',category_id:'',cost_center_id:'',beneficiary_name:'',beneficiary_type:'fornecedor',payment_method_planned:'pix',document_number:'',document_url:'',priority:'normal',status:'pendente',observation:''};
  const [f,setF]=useState(empty); const [saving,setSaving]=useState(false); const [uploading,setUploading]=useState(false); const ref=useRef();
  useEffect(()=>{if(open){if(editing){setF({...empty,...editing,amount:String(editing.amount||'')})}else{setF(empty)}}},[open,editing]);
  const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const upload=async file=>{if(!file)return;setUploading(true);try{const {file_url}=await base44.integrations.Core.UploadFile({file});set('document_url',file_url)}finally{setUploading(false)}};
  const save=async()=>{if(!f.description||!f.due_date||!Number(f.amount))return;if(editing&&!window.confirm('Deseja salvar as alterações deste boleto?'))return;setSaving(true);try{const cat=data.categories.find(x=>x.id===f.category_id),center=data.centers.find(x=>x.id===f.cost_center_id);const payload={description:f.description,issue_date:f.issue_date,due_date:f.due_date,amount:Number(f.amount),category_id:f.category_id,category_name:cat?.name||'',cost_center_id:f.cost_center_id,cost_center_name:center?.name||'',beneficiary_name:f.beneficiary_name,beneficiary_type:f.beneficiary_type,payment_method_planned:f.payment_method_planned,document_number:f.document_number,document_url:f.document_url,priority:f.priority,observation:f.observation,responsible_user:currentUserName()};if(editing){await base44.entities.AccountsPayable.update(editing.id,{...payload,status:f.status})}else{await base44.entities.AccountsPayable.create({...payload,status:'pendente'})}onClose();await onSaved()}finally{setSaving(false)}};
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{editing?'Editar conta a pagar':'Nova conta a pagar'}</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3"><div className="sm:col-span-2"><Field l="Descrição"><Input value={f.description} onChange={e=>set('description',e.target.value)} placeholder="Ex.: Fornecedor de queijo, conta de luz..."/></Field></div><Field l="Emissão"><Input type="date" value={f.issue_date} onChange={e=>set('issue_date',e.target.value)}/></Field><Field l="Vencimento"><Input type="date" value={f.due_date} onChange={e=>set('due_date',e.target.value)}/></Field><Field l="Valor"><CurrencyInput value={f.amount} onChange={v=>set('amount',v)}/></Field><Field l="Favorecido"><Input value={f.beneficiary_name} onChange={e=>set('beneficiary_name',e.target.value)} placeholder="Fornecedor ou pessoa"/></Field><Field l="Categoria"><select className={inputCls} value={f.category_id} onChange={e=>set('category_id',e.target.value)}><option value="">Selecione...</option>{data.categories.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Centro de custo"><select className={inputCls} value={f.cost_center_id} onChange={e=>set('cost_center_id',e.target.value)}><option value="">Selecione...</option>{data.centers.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Forma prevista"><Select v={f.payment_method_planned} on={v=>set('payment_method_planned',v)} opts={Object.entries(METHOD_LABELS)}/></Field>{editing&&<Field l="Status"><Select v={f.status} on={v=>set('status',v)} opts={[['pendente','Pendente'],['agendado','Agendado'],['pago','Pago'],['vencido','Vencido'],['cancelado','Cancelado']]}/></Field>}<Field l="Prioridade"><Select v={f.priority} on={v=>set('priority',v)} opts={[['baixa','Baixa'],['normal','Normal'],['alta','Alta'],['critica','Crítica']]}/></Field><Field l="Nº documento/NF"><Input value={f.document_number} onChange={e=>set('document_number',e.target.value)}/></Field><UploadField label="Boleto, nota ou documento" value={f.document_url} busy={uploading} refEl={ref} onFile={upload}/><div className="sm:col-span-2"><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e=>set('observation',e.target.value)}/></Field></div></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||!f.description||!f.due_date||!Number(f.amount)}>{saving?'Salvando...':editing?'Salvar alterações':'Cadastrar conta'}</Button></DialogFooter></DialogContent></Dialog>
}

function PayablePaymentDialog({payable,open,onClose,data,onSaved}) {
  const [date,setDate]=useState(today()); const [method,setMethod]=useState('pix'); const [accountId,setAccountId]=useState(''); const [proofUrl,setProofUrl]=useState(''); const [observation,setObservation]=useState(''); const [uploading,setUploading]=useState(false); const [saving,setSaving]=useState(false); const ref=useRef();
  useEffect(()=>{if(open&&payable){setDate(today());setMethod(payable.payment_method_planned||'pix');setAccountId(payable.financial_account_id||'');setProofUrl(payable.proof_url||'');setObservation('')}},[open,payable]); if(!payable)return null;
  const upload=async file=>{if(!file)return;setUploading(true);try{const {file_url}=await base44.integrations.Core.UploadFile({file});setProofUrl(file_url)}finally{setUploading(false)}};
  const save=async()=>{setSaving(true);try{const account=data.accounts.find(x=>x.id===accountId);const existing=data.expenses.find(x=>x.origin_type==='conta_pagar'&&x.origin_id===payable.id&&x.status!=='cancelado');let expense=existing;if(!existing){expense=await base44.entities.FinancialExpense.create({date:date,paid_date:date,due_date:payable.due_date,description:payable.description,classification:'despesa_operacional',category_id:payable.category_id||'',category_name:payable.category_name||'',cost_center_id:payable.cost_center_id||'',cost_center_name:payable.cost_center_name||'',beneficiary_type:payable.beneficiary_type||'fornecedor',beneficiary_name:payable.beneficiary_name||'',amount:Number(payable.amount||0),payment_method:method,financial_account_id:account?.id||'',financial_account_name:account?.name||'',account:account?.name||'',accounts_payable_id:payable.id,document_number:payable.document_number||'',proof_url:proofUrl,invoice_url:payable.document_url||'',origin_type:'conta_pagar',origin_id:payable.id,status:'pago',responsible_user:currentUserName(),observation:[payable.observation,observation].filter(Boolean).join(' | ')});}await base44.entities.AccountsPayable.update(payable.id,{status:'pago',paid_date:date,payment_method_planned:method,financial_account_id:account?.id||'',financial_account_name:account?.name||'',proof_url:proofUrl,financial_expense_id:expense?.id||existing?.id||'',responsible_user:currentUserName()});onClose();await onSaved()}finally{setSaving(false)}};
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Pagar conta</DialogTitle></DialogHeader><div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{payable.description}</p><div className="flex justify-between mt-1"><span className="text-sm text-slate-500">Vencimento {fmt(payable.due_date)}</span><strong>{brl(payable.amount)}</strong></div></div><Field l="Data do pagamento"><Input type="date" value={date} onChange={e=>setDate(e.target.value)}/></Field><Field l="Forma de pagamento"><Select v={method} on={setMethod} opts={Object.entries(METHOD_LABELS)}/></Field><Field l="Conta de origem"><select className={inputCls} value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Não informada</option>{data.accounts.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><UploadField label="Comprovante" value={proofUrl} busy={uploading} refEl={ref} onFile={upload}/><Field l="Observação"><Textarea rows={2} value={observation} onChange={e=>setObservation(e.target.value)}/></Field></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving}>{saving?'Pagando...':'Confirmar pagamento'}</Button></DialogFooter></DialogContent></Dialog>
}

function nextRecurringDate(date, frequency) {
  if (!date) return '';
  const [y,m,d]=date.split('-').map(Number); const dt=new Date(y,m-1,d);
  const days={semanal:7,quinzenal:15};
  if(days[frequency]) dt.setDate(dt.getDate()+days[frequency]);
  else { const months={mensal:1,bimestral:2,trimestral:3,semestral:6,anual:12}[frequency]||1; dt.setMonth(dt.getMonth()+months); }
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function RecurringPanel({rows,data,onSaved}) {
  const [open,setOpen]=useState(false); const [savingId,setSavingId]=useState('');
  const active=rows.filter(x=>x.status==='ativo'); const upcoming=[...active].sort((a,b)=>(a.next_due_date||'9999').localeCompare(b.next_due_date||'9999'));
  const generate=async r=>{if(!r.next_due_date||!Number(r.amount))return;setSavingId(r.id);try{const duplicate=data.payables.find(x=>x.recurring_expense_id===r.id&&x.due_date===r.next_due_date&&x.status!=='cancelado');if(!duplicate){await base44.entities.AccountsPayable.create({description:r.name,issue_date:today(),due_date:r.next_due_date,amount:Number(r.amount),category_id:r.category_id||'',category_name:r.category_name||'',cost_center_id:r.cost_center_id||'',cost_center_name:r.cost_center_name||'',beneficiary_name:r.beneficiary_name||'',beneficiary_type:'fornecedor',payment_method_planned:r.payment_method_planned||'pix',financial_account_id:r.financial_account_id||'',financial_account_name:r.financial_account_name||'',recurring_expense_id:r.id,status:'pendente',priority:'normal',responsible_user:currentUserName(),observation:`Gerada a partir da recorrência: ${r.name}`});}await base44.entities.RecurringExpense.update(r.id,{next_due_date:nextRecurringDate(r.next_due_date,r.frequency)});await onSaved()}finally{setSavingId('')}};
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Despesas recorrentes</h3><p className="text-sm text-slate-500">Cadastre uma vez e gere cada vencimento em Contas a Pagar.</p></div><Button onClick={()=>setOpen(true)} className="gap-2"><Plus className="w-4 h-4"/> Nova recorrência</Button></div><div className="grid grid-cols-2 lg:grid-cols-3 gap-3"><Stat label="Recorrências ativas" value={active.length} icon={CalendarClock}/><Stat label="Próximos 30 dias" value={active.filter(x=>x.next_due_date&&x.next_due_date>=today()&&x.next_due_date<=nextRecurringDate(today(),'mensal')).length} icon={Receipt}/><Stat label="Valor previsto ativo" value={brl(active.reduce((s,x)=>s+Number(x.amount||0),0))} icon={Wallet}/></div><div className="rounded-xl border bg-white overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm min-w-[850px]"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Despesa','Frequência','Próximo vencimento','Favorecido','Centro de custo','Valor previsto','Status','Ação'].map(h=><th key={h} className="px-4 py-3 text-left font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{upcoming.length?upcoming.map(r=><tr key={r.id}><td className="px-4 py-3 font-medium">{r.name}</td><td className="px-4 py-3 capitalize">{r.frequency}</td><td className="px-4 py-3">{fmt(r.next_due_date)}</td><td className="px-4 py-3">{r.beneficiary_name||'—'}</td><td className="px-4 py-3">{r.cost_center_name||'—'}</td><td className="px-4 py-3 font-semibold">{brl(r.amount)}</td><td className="px-4 py-3 capitalize">{r.status}</td><td className="px-4 py-3"><Button size="sm" variant="outline" disabled={savingId===r.id||!r.next_due_date||!Number(r.amount)} onClick={()=>generate(r)}>{savingId===r.id?'Gerando...':'Gerar conta'}</Button></td></tr>):<tr><td colSpan={8} className="p-10 text-center text-slate-400">Nenhuma recorrência ativa.</td></tr>}</tbody></table></div></div><RecurringDialog open={open} onClose={()=>setOpen(false)} data={data} onSaved={onSaved}/></div>
}

function RecurringDialog({open,onClose,data,onSaved}) {
  const empty={name:'',frequency:'mensal',day_of_month:'',amount:'',category_id:'',cost_center_id:'',beneficiary_name:'',financial_account_id:'',payment_method_planned:'pix',start_date:today(),next_due_date:today(),automatic_generation:false,status:'ativo',observation:''}; const [f,setF]=useState(empty); const [saving,setSaving]=useState(false); useEffect(()=>{if(open)setF(empty)},[open]); const set=(k,v)=>setF(x=>({...x,[k]:v}));
  const save=async()=>{if(!f.name||!Number(f.amount)||!f.next_due_date)return;setSaving(true);try{const cat=data.categories.find(x=>x.id===f.category_id),center=data.centers.find(x=>x.id===f.cost_center_id),account=data.accounts.find(x=>x.id===f.financial_account_id);await base44.entities.RecurringExpense.create({...f,amount:Number(f.amount),day_of_month:f.day_of_month?Number(f.day_of_month):null,category_name:cat?.name||'',cost_center_name:center?.name||'',financial_account_name:account?.name||''});onClose();await onSaved()}finally{setSaving(false)}};
  return <Dialog open={open} onOpenChange={o=>!o&&onClose()}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>Nova despesa recorrente</DialogTitle></DialogHeader><div className="grid sm:grid-cols-2 gap-3"><div className="sm:col-span-2"><Field l="Nome da despesa"><Input value={f.name} onChange={e=>set('name',e.target.value)} placeholder="Ex.: Aluguel, internet, contador..."/></Field></div><Field l="Frequência"><Select v={f.frequency} on={v=>set('frequency',v)} opts={[['semanal','Semanal'],['quinzenal','Quinzenal'],['mensal','Mensal'],['bimestral','Bimestral'],['trimestral','Trimestral'],['semestral','Semestral'],['anual','Anual']]}/></Field><Field l="Próximo vencimento"><Input type="date" value={f.next_due_date} onChange={e=>set('next_due_date',e.target.value)}/></Field><Field l="Valor previsto"><Input type="number" value={f.amount} onChange={e=>set('amount',e.target.value)}/></Field><Field l="Favorecido"><Input value={f.beneficiary_name} onChange={e=>set('beneficiary_name',e.target.value)}/></Field><Field l="Categoria"><select className={inputCls} value={f.category_id} onChange={e=>set('category_id',e.target.value)}><option value="">Selecione...</option>{data.categories.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Centro de custo"><select className={inputCls} value={f.cost_center_id} onChange={e=>set('cost_center_id',e.target.value)}><option value="">Selecione...</option>{data.centers.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Conta prevista"><select className={inputCls} value={f.financial_account_id} onChange={e=>set('financial_account_id',e.target.value)}><option value="">Não definida</option>{data.accounts.filter(x=>x.status==='ativo').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field l="Forma prevista"><Select v={f.payment_method_planned} on={v=>set('payment_method_planned',v)} opts={Object.entries(METHOD_LABELS)}/></Field><div className="sm:col-span-2"><Field l="Observação"><Textarea rows={2} value={f.observation} onChange={e=>set('observation',e.target.value)}/></Field></div></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={save} disabled={saving||!f.name||!Number(f.amount)||!f.next_due_date}>{saving?'Salvando...':'Salvar recorrência'}</Button></DialogFooter></DialogContent></Dialog>
}

function DailyClosePanel({data,onSaved}) {
  const [date,setDate]=useState(today()); const [closing,setClosing]=useState(false); const [pending,setPending]=useState(''); const [obs,setObs]=useState('');
  const expenses=data.expenses.filter(x=>x.status==='pago'&&(x.paid_date||x.date)===date); const total=expenses.reduce((s,x)=>s+Number(x.amount||0),0); const people=expenses.filter(x=>['pagamento_colaborador','adiantamento_colaborador','logistica_delivery'].includes(x.classification)).reduce((s,x)=>s+Number(x.amount||0),0); const vales=expenses.filter(x=>x.origin_type==='vale').reduce((s,x)=>s+Number(x.amount||0),0); const missing=expenses.filter(x=>!x.proof_url).length; const pendingPayables=data.payables.filter(x=>!['pago','cancelado'].includes(x.status)&&x.due_date<=date); const pendingTotal=pendingPayables.reduce((s,x)=>s+Number(x.amount||0),0); const existing=data.closes.find(x=>x.date===date);
  const save=async()=>{setClosing(true);try{const payload={date,expenses_total:total,employee_payments_total:people,vales_total:vales,pending_payables_total:pendingTotal,pending_items:pending,observation:obs,closed_by:currentUserName(),closed_at:new Date().toISOString(),status:(missing>0||pendingPayables.length>0)?'fechado_com_pendencia':'fechado'};if(existing)await base44.entities.DailyFinancialClose.update(existing.id,payload);else await base44.entities.DailyFinancialClose.create(payload);await onSaved()}finally{setClosing(false)}};
  return <div className="space-y-4"><div className="flex flex-wrap justify-between items-end gap-3"><div><h3 className="font-semibold">Fechamento financeiro diário</h3><p className="text-sm text-slate-500">Conferência das saídas, comprovantes e pendências do dia.</p></div><div><Label className="text-xs">Data</Label><Input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-44"/></div></div><div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Stat label="Saídas pagas" value={brl(total)} icon={Wallet}/><Stat label="Pagamentos de pessoas" value={brl(people)} icon={Users}/><Stat label="Sem comprovante" value={missing} icon={AlertTriangle} danger={missing>0}/><Stat label="Pendências vencidas/hoje" value={brl(pendingTotal)} icon={CalendarClock} danger={pendingPayables.length>0}/></div>{existing&&<div className={`rounded-xl border p-4 ${existing.status==='fechado'?'border-emerald-200 bg-emerald-50':'border-amber-200 bg-amber-50'}`}><p className="font-semibold">Fechamento já registrado: {existing.status==='fechado'?'Concluído':'Com pendências'}</p><p className="text-sm mt-1">Responsável: {existing.closed_by||'—'}</p></div>}<div className="rounded-xl border bg-white p-4 space-y-3"><Field l="Pendências para o próximo dia"><Textarea rows={3} value={pending} onChange={e=>setPending(e.target.value)} placeholder="Ex.: solicitar comprovante, pagar fornecedor, conferir diária..."/></Field><Field l="Observações do fechamento"><Textarea rows={3} value={obs} onChange={e=>setObs(e.target.value)}/></Field><div className="flex justify-end"><Button onClick={save} disabled={closing}>{closing?'Salvando...':existing?'Atualizar fechamento':'Fechar financeiro do dia'}</Button></div></div></div>
}

function FinancialAccountsConfig({records,onSaved}) { const [name,setName]=useState(''); const [type,setType]=useState('banco'); const [institution,setInstitution]=useState(''); const save=async()=>{if(!name.trim())return;await base44.entities.FinancialAccount.create({name:name.trim(),type,institution,status:'ativo',initial_balance:0,current_balance:0});setName('');setInstitution('');await onSaved()}; return <div className="rounded-xl border bg-white p-4 lg:col-span-2"><h3 className="font-semibold mb-3">Contas financeiras</h3><div className="grid sm:grid-cols-[1fr_180px_1fr_auto] gap-2"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome da conta"/><Select v={type} on={setType} opts={[['caixa','Caixa'],['banco','Banco'],['pix','Pix'],['carteira_digital','Carteira digital'],['cartao','Cartão'],['outro','Outro']]}/><Input value={institution} onChange={e=>setInstitution(e.target.value)} placeholder="Banco/Instituição"/><Button onClick={save}>Adicionar</Button></div><div className="grid md:grid-cols-3 gap-3 mt-4">{records.filter(x=>x.status==='ativo').map(x=><div key={x.id} className="rounded-lg border p-3"><p className="font-medium">{x.name}</p><p className="text-xs text-slate-500 capitalize">{x.type}{x.institution?` · ${x.institution}`:''}</p><p className="text-sm mt-2 text-slate-600">Saldo informado: <b>{brl(x.current_balance)}</b></p></div>)}</div></div> }

function Settings({data,onSaved}) { return <div className="grid lg:grid-cols-2 gap-4"><FinancialAccountsConfig records={data.accounts} onSaved={onSaved}/><QuickConfig title="Categorias de gastos" entity="ExpenseCategory" records={data.categories} extra={{group:'operacao',status:'ativo'}} onSaved={onSaved}/><QuickConfig title="Centros de custo" entity="CostCenter" records={data.centers} extra={{status:'ativo'}} onSaved={onSaved}/></div> }
function QuickConfig({title,entity,records,extra,onSaved}) {const [name,setName]=useState('');const save=async()=>{if(!name.trim())return;await base44.entities[entity].create({name:name.trim(),...extra});setName('');await onSaved()};return <div className="rounded-xl border bg-white p-4"><div className="flex items-center gap-2 mb-3"><Settings2 className="w-4 h-4"/><h3 className="font-semibold">{title}</h3></div><div className="flex gap-2"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Novo cadastro..."/><Button onClick={save}>Adicionar</Button></div><div className="mt-4 max-h-72 overflow-y-auto divide-y">{records.map(x=><div key={x.id} className="py-2 text-sm">{x.name}</div>)}</div></div>}
function Field({l,children}) { return <div className="space-y-1"><Label className="text-xs">{l}</Label>{children}</div> }
function Select({v,on,opts}) { return <select className={inputCls} value={v} onChange={e=>on(e.target.value)}>{opts.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select> }
function UploadField({label,value,busy,refEl,onFile}) { return <div className="space-y-1"><Label className="text-xs">{label}</Label><input ref={refEl} type="file" className="hidden" accept="image/*,.pdf" onChange={e=>onFile(e.target.files?.[0])}/><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={()=>refEl.current?.click()} disabled={busy} className="gap-2"><Upload className="w-4 h-4"/>{busy?'Enviando...':value?'Trocar arquivo':'Anexar arquivo'}</Button>{value&&<a href={value} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 flex items-center gap-1"><Paperclip className="w-3 h-3"/> Abrir</a>}</div></div> }
function CurrencyInput({value,onChange}) {
  const fmt=(v)=>{const n=Number(v);return (v||v===0)&&!isNaN(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):''};
  const [text,setText]=useState(''); const [focused,setFocused]=useState(false);
  useEffect(()=>{if(!focused)setText(fmt(value))},[value,focused]);
  const parse=(s)=>{const cleaned=String(s).replace(/\./g,'').replace(',','.').replace(/[^\d.]/g,'');return cleaned?Number(cleaned):''};
  return <Input inputMode="decimal" value={text} placeholder="0,00" onFocus={()=>{setFocused(true);setText(value?String(value).replace('.',','):'')}} onBlur={()=>setFocused(false)} onChange={e=>{setText(e.target.value);onChange(parse(e.target.value))}}/>;
}