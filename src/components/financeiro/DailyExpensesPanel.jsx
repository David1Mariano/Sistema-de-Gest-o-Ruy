import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, Eye, FolderPlus, History, Pencil, Plus, Receipt, Search, Trash2, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { base44 } from '@/api/base44Client';
import DailyExpenseForm from '@/components/financeiro/DailyExpenseForm';
import ExpenseCategoryManager from '@/components/financeiro/ExpenseCategoryManager';
import { ExpenseAttachment } from '@/components/financeiro/ExpenseAttachment';
import {
  dailyExpenseIndicators, deleteDailyExpense, expenseCategoryLabel, expenseDeleteBlocker,
  expenseEditBlocker, expenseMethodLabel, expenseStatusLabel, filterExpenses, findActiveLinkedPayment,
  formatExpenseAmount, formatExpenseDate, hasExpenseProof, paymentMethodOptions, resolveExpensePeriod,
  EXPENSE_PERIOD_PRESETS, EXPENSE_ORIGIN_LABELS,
} from '@/lib/dailyExpenses';
import { selectableCategories, summarizeByCategory, totalOf } from '@/lib/expenseCategories';
import DailyExpenseHistory from '@/components/financeiro/DailyExpenseHistory';
import { useUserRole } from '@/lib/useUserRole';
import { currentUserName } from '@/lib/useCurrentUser';

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

// Resumo por categoria: SEMPRE derivado dos gastos reais, nunca guardado.
// Editar, mudar de categoria, cancelar ou excluir recalcula na hora.
function CategorySummary({ rows, total, loading }) {
  const porCategoria = useMemo(() => summarizeByCategory(rows), [rows]);
  return <div className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
      <h3 className="font-semibold text-slate-800">Resumo por categoria</h3>
      <p className="text-sm text-slate-500">
        Total do período: <span className="font-semibold text-slate-900">{formatExpenseAmount(total)}</span>
      </p>
    </div>
    {loading ? <p className="text-sm text-slate-400">Carregando...</p>
      : porCategoria.length ? <div className="divide-y">
        {porCategoria.map((item) => (
          <div key={item.chave} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="text-slate-700">{item.nome}<span className="text-slate-400 text-xs"> · {item.quantidade}</span></span>
            <span className="font-medium tabular-nums">{formatExpenseAmount(item.total)}</span>
          </div>
        ))}
      </div>
        : <p className="text-sm text-slate-400">Nenhum gasto no período selecionado.</p>}
  </div>;
}


function Indicator({ label, value, icon: Icon, hint, danger }) {
  return <div className={`rounded-xl border p-4 ${danger ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}>
    <div className="flex justify-between gap-2">
      <div>
        <p className={`text-xs ${danger ? 'text-rose-600' : 'text-slate-500'}`}>{label}</p>
        <p className={`text-xl font-semibold mt-1 ${danger ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p>
        {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
      </div>
      <Icon className={`w-5 h-5 shrink-0 ${danger ? 'text-rose-500' : 'text-amber-600'}`} />
    </div>
  </div>;
}

// Ações por LINHA, e não mais por `origin === 'manual'`.
//
// Um gasto criado na tela de Pagamentos (diária de motoboy, adiantamento,
// etc.) chega aqui com `origin_type: 'pagamento_colaborador'` e ficava
// desabilitado — a tela dona é a de pagamentos, mas o REGISTRO FINANCEIRO é um
// FinancialExpense normal e precisa poder ser corrigido aqui.
//
// Continuam protegidos: Vale, Conta a Pagar, recorrência e lote, além de
// qualquer gasto com vínculo de Vale (são eles que devem ser alterados na tela
// dona, para não quebrar a rastreabilidade).
function ExpenseRow({ expense, editBlocker, deleteBlocker, onEdit, onRemove }) {
  const canEdit = !editBlocker;
  const canDelete = !deleteBlocker;
  const origem = expense.origin_type || 'manual';
  return <tr className="hover:bg-slate-50">
    <td className="px-4 py-3 whitespace-nowrap">{formatExpenseDate(expense.date)}</td>
    <td className="px-4 py-3 font-medium">
      {expense.description || '—'}
      {expense.beneficiary_name && <span className="block text-xs font-normal text-slate-500">{expense.beneficiary_name}</span>}
      {origem !== 'manual' && <span className="block text-xs font-normal text-slate-400">Origem: {EXPENSE_ORIGIN_LABELS[origem] || origem}</span>}
    </td>
    <td className="px-4 py-3">
      {expenseCategoryLabel(expense)}
      <span className="block text-xs text-slate-400">{expenseStatusLabel(expense)}</span>
    </td>
    <td className="px-4 py-3 font-semibold whitespace-nowrap">{formatExpenseAmount(expense.amount)}</td>
    <td className="px-4 py-3">{expenseMethodLabel(expense)}</td>
    <td className="px-4 py-3">{expense.responsible_user || '—'}</td>
    <td className="px-4 py-3">
      <div className="flex items-center gap-2">
        <ExpenseAttachment record={expense} field="proof_url" label="Comprovante" />
        <ExpenseAttachment record={expense} field="invoice_url" label="Nota fiscal" />
        {!hasExpenseProof(expense) && <span className="text-amber-600 text-xs">Sem anexo</span>}
      </div>
    </td>
    <td className="px-4 py-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onEdit(expense)} title="Visualizar"
          aria-label={`Ver gasto ${expense.description || ''}`}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"><Eye className="w-4 h-4" /></button>
        <button type="button" onClick={() => onEdit(expense)} disabled={!canEdit}
          title={canEdit ? 'Editar' : editBlocker} aria-label={`Editar gasto ${expense.description || ''}`}
          className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"><Pencil className="w-4 h-4" /></button>
        <button type="button" onClick={() => onRemove(expense)} disabled={!canDelete}
          title={canDelete ? 'Excluir' : deleteBlocker} aria-label={`Excluir gasto ${expense.description || ''}`}
          className="p-1.5 rounded-md hover:bg-rose-50 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 className="w-4 h-4" /></button>
      </div>
    </td>
  </tr>;
}


function SearchAndFilters({
  search, setSearch, preset, setPreset, customStart, setCustomStart, customEnd, setCustomEnd,
  categoryId, setCategoryId, paymentMethod, setPaymentMethod, beneficiary, setBeneficiary,
  status, setStatus, proof, setProof, categories, beneficiaries, visible, visibleSum,
  loading, filtersActive, onClear,
}) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
    <div className="relative">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input className="pl-9" placeholder="Pesquisar gasto..." aria-label="Pesquisar gasto" value={search}
        onChange={(event) => setSearch(event.target.value)} />
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {EXPENSE_PERIOD_PRESETS.map((option) => <button key={option.key} type="button" onClick={() => setPreset(option.key)}
        aria-pressed={preset === option.key}
        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${preset === option.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
        {option.label}
      </button>)}
    </div>
    {preset === 'personalizado' && <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs">De
        <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className={`${inputCls} mt-1`} />
      </label>
      <label className="text-xs">Até
        <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className={`${inputCls} mt-1`} />
      </label>
    </div>}
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <label className="text-xs">Categoria
        {/* `|| ''` é defesa no ponto de consumo: mesmo que algum chamador
            escrevesse `undefined` no estado, o select continuaria controlado. */}
        <select className={`${inputCls} mt-1`} value={categoryId || ''} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label className="text-xs">Forma de pagamento
        <select className={`${inputCls} mt-1`} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
          <option value="">Todas as formas</option>
          {paymentMethodOptions().map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-xs">Favorecido
        <select className={`${inputCls} mt-1`} value={beneficiary} onChange={(event) => setBeneficiary(event.target.value)}>
          <option value="">Todos os favorecidos</option>
          {beneficiaries.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="text-xs">Situação
        <select className={`${inputCls} mt-1`} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todas</option>
          <option value="pago">Pago</option>
          <option value="pendente">Pendente</option>
          <option value="cancelado">Cancelado</option>
        </select>
      </label>
      <label className="text-xs">Comprovante
        <select className={`${inputCls} mt-1`} value={proof} onChange={(event) => setProof(event.target.value)}>
          <option value="">Todos</option>
          <option value="com">Com comprovante</option>
          <option value="sem">Sem comprovante</option>
        </select>
      </label>
      <div className="flex items-end justify-between gap-2">
        <p className="text-xs text-slate-500 pb-2" role="status">
          {loading ? 'Carregando...' : `${visible.length} gasto(s) · ${formatExpenseAmount(visibleSum)}`}
        </p>
        {filtersActive && <Button variant="ghost" size="sm" onClick={onClear} className="gap-1">
          <X className="w-3 h-3" /> Limpar
        </Button>}
      </div>
    </div>
  </div>;
}

export default function DailyExpensesPanel({ rows = [], loading, refreshing = false, failure = '', semDadosConfirmados = true, data, onSaved, onCategoriesChanged, openSignal = 0 }) {
  // A auditoria de FinancialExpense é sensível (mostra valores e favorecidos de
  // todo mundo). Só quem já pode administer o Financeiro acessa o histórico,
  // com o MESMO critério de acesso da tela global de Auditoria.
  const { isAdmin } = useUserRole();
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState('mes');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [status, setStatus] = useState('');
  const [proof, setProof] = useState('');
  const [view, setView] = useState('painel'); // 'painel' | 'historico' | 'categorias'
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [removingBusy, setRemovingBusy] = useState(false);

  // No histórico a busca é livre (sem a trava de período padrão), senão o
  // funcionário não acha um lançamento antigo. Os totais da tela continuam
  // ignorando cancelados; só a LISTA do histórico os mostra.
  const effectivePreset = view === 'historico' && preset === 'mes' ? 'todos' : preset;
  const effectivePeriod = useMemo(
    () => resolveExpensePeriod(effectivePreset, { start: customStart, end: customEnd }),
    [effectivePreset, customStart, customEnd],
  );

  const visible = useMemo(() => filterExpenses(rows, {
    search, start: effectivePeriod.start, end: effectivePeriod.end, categoryId, paymentMethod,
    beneficiary, status, proof, includeCancelled: view === 'historico',
  }), [rows, search, effectivePeriod.start, effectivePeriod.end, categoryId, paymentMethod, beneficiary, status, proof, view]);

  // Indicadores sobre todos os gastos carregados, não sobre a busca filtrada.
  const indicators = useMemo(() => dailyExpenseIndicators(rows), [rows]);
  // Deduplica por nome equivalente, então categoria antiga repetida não aparece
  // duas vezes na seleção.
  const categories = useMemo(() => selectableCategories(data.categories), [data.categories]);
  const beneficiaries = useMemo(
    () => [...new Set(rows.map((r) => r.beneficiary_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [rows],
  );
  const blocker = removing ? expenseDeleteBlocker(removing, { payments: data.payments, vales: data.vales }) : null;
  // Há pagamento ATIVO vinculado? A exclusão não é bloqueada, mas o diálogo
  // precisa avisar que ele será cancelado (e não apagado).
  const linkedPaymentOf = (expense) => findActiveLinkedPayment(data.payments, expense?.id);
  // Bloqueios por linha: é isto que habilita editar/excluir gastos criados em
  // outras telas, mantendo de fora apenas o que é gerenciado por outro módulo.
  const editBlockers = useMemo(() => {
    const mapa = new Map();
    for (const expense of rows) mapa.set(expense.id, expenseEditBlocker(expense, { vales: data.vales }));
    return mapa;
  }, [rows, data.vales]);
  const deleteBlockers = useMemo(() => {
    const mapa = new Map();
    for (const expense of rows) mapa.set(expense.id, expenseDeleteBlocker(expense, { payments: data.payments, vales: data.vales }));
    return mapa;
  }, [rows, data.payments, data.vales]);
  const visibleSum = useMemo(() => totalOf(visible), [visible]);
  const periodRows = useMemo(
    () => filterExpenses(rows, { start: effectivePeriod.start, end: effectivePeriod.end }),
    [rows, effectivePeriod.start, effectivePeriod.end],
  );
  const periodTotal = useMemo(() => totalOf(periodRows), [periodRows]);
  const filtersActive = Boolean(search || categoryId || paymentMethod || beneficiary || status || proof || preset !== 'mes');

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (expense) => { setEditing(expense); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditing(null); };
  const clearFilters = () => {
    setSearch(''); setCategoryId(''); setPaymentMethod('');
    setBeneficiary(''); setStatus(''); setProof(''); setPreset('mes');
  };

  // O botão "Novo gasto" do cabeçalho do Financeiro abre este formulário
  // incrementando o contador; assim o funcionário não precisa procurar a aba.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    setEditing(null);
    setFormOpen(true);
  }, [openSignal]);

  const confirmRemove = async () => {
    if (!removing || blocker) return;
    setRemovingBusy(true);
    setRemoveError('');
    try {
      await deleteDailyExpense({
        entities: base44.entities,
        expense: removing,
        payments: data.payments,
        vales: data.vales,
        responsibleUser: currentUserName(),
      });
      setRemoving(null);
      await onSaved();
    } catch (err) {
      setRemoveError(err?.message || 'Não foi possível excluir o gasto. Tente novamente.');
    } finally { setRemovingBusy(false); }
  };

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          {view === 'historico' ? 'Histórico de Gastos' : 'Gastos Diários'}
        </h2>
        <p className="text-sm text-slate-500">
          {view === 'historico'
            ? 'Rastreabilidade dos lançamentos, alterações e exclusões.'
            : 'Registre e consulte as despesas do dia a dia da operação.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {refreshing && <span className="text-xs text-slate-400" role="status">Atualizando...</span>}
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Novo gasto</Button>
        <Button variant={view === 'historico' ? 'default' : 'outline'} onClick={() => setView(view === 'historico' ? 'painel' : 'historico')} className="gap-2">
          <History className="w-4 h-4" /> Histórico
        </Button>
        <Button variant={view === 'categorias' ? 'default' : 'outline'} onClick={() => setView(view === 'categorias' ? 'painel' : 'categorias')} className="gap-2">
          <FolderPlus className="w-4 h-4" /> Categorias
        </Button>
      </div>
    </div>

    {view === 'historico' && !isAdmin && (
      <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        O histórico de gastos é restrito a administradores, como a tela de Auditoria do sistema.
      </p>
    )}

    {/* Falha de refresh é aviso, não tela vazia: fica acima das visões para
        aparecer também no histórico, e os gastos já carregados continuam. */}
    {failure && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{failure}</p>}

    {view === 'categorias' && <ExpenseCategoryManager
      categories={data.categories}
      onSaved={onCategoriesChanged || onSaved}
      onSelect={setCategoryId}
    />}

    {view === 'historico' && isAdmin && <DailyExpenseHistory
      expenses={rows}
      categories={data.categories}
      auditRecords={data.auditRecords}
      loading={loading}
      refreshing={refreshing}
    />}

    {view !== 'historico' && <>
    {/* "R$ 0,00" e "não consegui ler" são coisas diferentes. Quando a
        collection de gastos não foi lida, mostrar zero seria afirmar que não
        existe gasto nenhum — o que é uma mentira bem mais perigosa que um
        aviso. Nestes cards, zero só aparece quando os dados foram lidos. */}
    {!semDadosConfirmados ? (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Valores indisponíveis — os gastos não foram carregados.</p>
        <p className="mt-1">
          Os números abaixo ficam ocultos de propósito: sem conseguir ler a lista, qualquer total
          seria uma estimativa inventada. Tente atualizar ou entre novamente.
        </p>
      </div>
    ) : (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Indicator label="Gastos de hoje" value={formatExpenseAmount(indicators.todayTotal)} icon={Wallet}
        hint={indicators.todayCount ? `${indicators.todayCount} lançamento(s)` : 'Nenhum lançamento hoje'} />
      <Indicator label="Gastos do mês" value={formatExpenseAmount(indicators.monthTotal)} icon={CalendarDays}
        hint={`${indicators.monthCount} lançamento(s)`} />
      <Indicator label="Lançamentos" value={indicators.totalCount} icon={Receipt} hint="Total de gastos registrados" />
      <Indicator label="Pagos sem comprovante" value={indicators.noProofCount} icon={AlertTriangle}
        danger={indicators.noProofCount > 0} hint="Pendentes de anexo" />
    </div>
    )}

    <SearchAndFilters
      search={search} setSearch={setSearch}
      preset={preset} setPreset={setPreset}
      customStart={customStart} setCustomStart={setCustomStart}
      customEnd={customEnd} setCustomEnd={setCustomEnd}
      categoryId={categoryId} setCategoryId={setCategoryId}
      paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
      beneficiary={beneficiary} setBeneficiary={setBeneficiary}
      status={status} setStatus={setStatus}
      proof={proof} setProof={setProof}
      categories={categories} beneficiaries={beneficiaries}
      visible={visible} visibleSum={visibleSum}
      loading={loading} filtersActive={filtersActive} onClear={clearFilters} />

    {/* Resumo do PERÍODO (sem a busca) x total da SELEÇÃO atual, identificados
        separadamente para não misturar os dois números. */}
    <div className="grid lg:grid-cols-2 gap-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Total do período selecionado</p>
          <p className="text-2xl font-semibold text-slate-900">{formatExpenseAmount(periodTotal)}</p>
        </div>
        <p className="text-xs text-slate-400 text-right">
          {periodRows.length} gasto(s)<br />canceleados não entram
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Total da busca atual</p>
          <p className="text-2xl font-semibold text-slate-900">{formatExpenseAmount(visibleSum)}</p>
        </div>
        <p className="text-xs text-slate-400 text-right">{visible.length} resultado(s)</p>
      </div>
    </div>

    <CategorySummary rows={view === 'historico' ? visible : periodRows} total={view === 'historico' ? visibleSum : periodTotal} loading={loading} />

    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[950px]">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>{['Data', 'Descrição', 'Categoria', 'Valor', 'Pagamento', 'Responsável', 'Comprovante', 'Ações'].map((header) => (
              <th key={header} className="text-left px-4 py-3 font-medium">{header}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y">
            {/* Só a CARGA INICIAL substitui a tabela. Em um refresh os dados
                antigos continuam visíveis: nada de "Carregando gastos..."
                derrubando a lista e os totais (era o bug de instabilidade). */}
            {loading && <tr><td colSpan={8} className="p-10 text-center text-slate-400">Carregando gastos...</td></tr>}
            {!loading && !visible.length && <tr><td colSpan={8} className="p-10 text-center text-slate-500">
              <p className="font-medium text-slate-700">Nenhum gasto encontrado.</p>
              <p className="text-sm mt-1">Ajuste a busca ou os filtros, ou registre um novo gasto.</p>
              <Button className="mt-4 gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> Novo gasto</Button>
            </td></tr>}
            {visible.map((expense) => <ExpenseRow key={expense.id} expense={expense}
              editBlocker={editBlockers.get(expense.id)}
              deleteBlocker={deleteBlockers.get(expense.id)}
              onEdit={openEdit}
              onRemove={(target) => { setRemoveError(''); setRemoving(target); }} />)}
          </tbody>
        </table>
      </div>
    </div>
    </>}

    <DailyExpenseForm open={formOpen} onClose={closeForm} onSaved={onSaved} data={data} editing={editing} />

    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !removingBusy) { setRemoving(null); setRemoveError(''); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir gasto diário?</AlertDialogTitle>
          <AlertDialogDescription>
            {removing ? `"${removing.description || 'Sem descrição'}" de ${formatExpenseAmount(removing.amount)} em ${formatExpenseDate(removing.date)} será removido em definitivo. Esta ação não pode ser desfeita.` : ''}
            {removing && linkedPaymentOf(removing) && ' O pagamento do colaborador vinculado será cancelado e continuará visível no histórico dele.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {blocker && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{blocker}</p>}
        {removeError && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{removeError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removingBusy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirmRemove} disabled={removingBusy || Boolean(blocker)} className="bg-red-600 hover:bg-red-700">
            {removingBusy ? 'Excluindo...' : 'Excluir gasto'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

