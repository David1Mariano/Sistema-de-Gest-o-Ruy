import { useMemo, useState } from 'react';
import { Eye, History as HistoryIcon, Filter, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExpenseAttachment } from '@/components/financeiro/ExpenseAttachment';
import {
  EXPENSE_ORIGIN_LABELS, EXPENSE_AUDIT_LABELS, EXPENSE_PERIOD_PRESETS,
  buildHistoryRows, expenseCategoryLabel, expenseMethodLabel, expenseStatusLabel,
  filterHistoryRows, formatExpenseAmount, formatExpenseDate, hasExpenseProof,
  historyCategoryOptions, historyOriginOptions, resolveExpensePeriod, sortHistoryRows,
} from '@/lib/dailyExpenses';

const inputCls = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const DATA_HORA = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const COLUNAS = ['Data', 'Última alteração', 'Descrição', 'Categoria', 'Favorecido', 'Valor', 'Situação', 'Origem', 'Comprovante', 'Eventos', ''];

function Linha({ rotulo, valor }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{rotulo}</span>
      <span className="text-right font-medium text-slate-800">{valor || '—'}</span>
    </div>
  );
}


// Detalhe de uma linha: estado atual + eventos conhecidos. Modal em vez de nova
// página, para encaixar no design atual sem redesenhar a navegação.
function HistoryDetail({ row, onClose }) {
  if (!row) return null;
  const { expense, events } = row;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Detalhes do lançamento">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{expense.description || 'Sem descrição'}</h3>
            <p className="text-xs text-slate-500">Lançamento {expense.id}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Fechar detalhes">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Dados atuais</p>
          <Linha rotulo="Valor" valor={formatExpenseAmount(expense.amount)} />
          <Linha rotulo="Categoria" valor={expenseCategoryLabel(expense)} />
          <Linha rotulo="Favorecido" valor={expense.beneficiary_name} />
          <Linha rotulo="Situação" valor={expenseStatusLabel(expense)} />
          <Linha rotulo="Pagamento" valor={expenseMethodLabel(expense)} />
          <Linha rotulo="Data do gasto" valor={formatExpenseDate(expense.date)} />
          <Linha rotulo="Criado em" valor={DATA_HORA(expense.created_date)} />
          <Linha rotulo="Última alteração" valor={DATA_HORA(expense.updated_date)} />
          <Linha rotulo="Origem" valor={EXPENSE_ORIGIN_LABELS[expense.origin_type || 'manual'] || expense.origin_type} />
          <div className="py-1.5 text-sm">
            <span className="text-slate-500">Comprovante</span>
            <div className="mt-1">
              <ExpenseAttachment record={expense} field="proof_url" label="Comprovante" />
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Eventos de alteração</p>
          {events.length ? (
            <ol className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id || `${ev.at}-${ev.field}`} className="rounded-md bg-slate-50 p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-700">{ev.rotulo}</span>
                    {ev.field && <span className="text-xs text-slate-500">Campo: {ev.field}</span>}
                    <span className="ml-auto text-xs text-slate-400">{DATA_HORA(ev.at)}</span>
                  </div>
                  {ev.field && (
                    <p className="mt-1 text-slate-700">
                      {ev.oldValue || '—'}
                      <span className="text-slate-400"> → </span>
                      <span className="font-medium">{ev.newValue || '—'}</span>
                    </p>
                  )}
                  {ev.reason && <p className="mt-1 text-xs text-slate-500">{ev.reason}</p>}
                  {ev.responsibleUser && <p className="text-xs text-slate-400">Por: {ev.responsibleUser}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-500">
              Nenhum evento registrado para este lançamento. Edições feitas antes da ativação da auditoria não são reconstituíveis.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


// HISTÓRICO DE GASTOS — tabela dedicada de RASTREABILIDADE.
//
// Separado de "Gastos" de propósito: lá é o estado operacional do dia; aqui é
// a linha do tempo dos lançamentos. Tem título, filtros e tabela próprios.
export default function DailyExpenseHistory({
  expenses = [], categories = [], auditRecords = [], loading, refreshing,
}) {
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState('todos');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [status, setStatus] = useState('');
  const [proof, setProof] = useState('');
  const [origin, setOrigin] = useState('');
  const [event, setEvent] = useState('');
  const [selected, setSelected] = useState(null);

  const allRows = useMemo(() => buildHistoryRows(expenses, auditRecords), [expenses, auditRecords]);
  const period = useMemo(
    () => resolveExpensePeriod(preset, { start: customStart, end: customEnd }),
    [preset, customStart, customEnd],
  );
  // Categorias manuais entram junto: usamos TODAS as cadastradas, não só as ativas.
  const categoryOptions = useMemo(() => historyCategoryOptions(categories), [categories]);
  const originOptions = useMemo(() => historyOriginOptions(allRows), [allRows]);
  // Marca as desligadas para o usuário saber por que não deve lançar novo gasto
  // nela — sem esconder o registro antigo.
  const inactiveIds = useMemo(
    () => new Set((categories || []).filter((c) => c.status !== 'ativo').map((c) => c.id)),
    [categories],
  );
  const beneficiaries = useMemo(
    () => [...new Set(expenses.map((e) => e.beneficiary_name).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [expenses],
  );
  const visible = useMemo(() => sortHistoryRows(filterHistoryRows(allRows, {
    search, start: period.start, end: period.end, categoryId, beneficiary,
    status, proof, origin, event,
  })), [allRows, search, period.start, period.end, categoryId, beneficiary, status, proof, origin, event]);

  const limpar = () => {
    setSearch(''); setCategoryId(''); setBeneficiary(''); setStatus('');
    setProof(''); setOrigin(''); setEvent(''); setPreset('todos');
    setCustomStart(''); setCustomEnd('');
  };
  const temFiltro = Boolean(
    search || categoryId || beneficiary || status || proof || origin || event || customStart || customEnd,
  );

  return (
    <section className="space-y-4 rounded-xl border-2 border-slate-900 bg-slate-50/60 p-4" aria-label="Histórico de gastos">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <HistoryIcon className="w-5 h-5" /> Histórico de gastos
          </h3>
          <p className="text-sm text-slate-500">Rastreabilidade dos lançamentos, alterações e exclusões.</p>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && <span className="text-xs text-slate-400" role="status">Atualizando...</span>}
          {temFiltro && (
            <Button type="button" variant="outline" size="sm" onClick={limpar} className="gap-1">
              <Filter className="w-3 h-3" /> Limpar filtros
            </Button>
          )}
        </div>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Pesquisar por descrição, categoria, favorecido, observação ou valor..."
            aria-label="Pesquisar no histórico"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {EXPENSE_PERIOD_PRESETS.map((option) => (
            <button
              key={option.key} type="button" onClick={() => setPreset(option.key)} aria-pressed={preset === option.key}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${preset === option.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {preset === 'personalizado' && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs">Data inicial
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="text-xs">Data final
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs">Categoria
            <select className={`${inputCls} mt-1`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Todas as categorias</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.inativa ? ' (inativa)' : ''}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">Favorecido
            <select className={`${inputCls} mt-1`} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)}>
              <option value="">Todos os favorecidos</option>
              {beneficiaries.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="text-xs">Situação
            <select className={`${inputCls} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todas</option>
              <option value="pago">Pago</option>
              <option value="pendente">Pendente</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>
          <label className="text-xs">Tipo de evento
            <select className={`${inputCls} mt-1`} value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">Todos os eventos</option>
              {Object.entries(EXPENSE_AUDIT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">Origem
            <select className={`${inputCls} mt-1`} value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">Todas as origens</option>
              {originOptions.map((value) => (
                <option key={value} value={value}>{EXPENSE_ORIGIN_LABELS[value] || value}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">Comprovante
            <select className={`${inputCls} mt-1`} value={proof} onChange={(e) => setProof(e.target.value)}>
              <option value="">Todos</option>
              <option value="com">Com comprovante</option>
              <option value="sem">Sem comprovante</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500" role="status">
          {visible.length} lançamento(s) no histórico · ordenado do mais recente para o mais antigo
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1050px]">
            <thead className="bg-slate-100 text-xs uppercase text-slate-600">
              <tr>
                {COLUNAS.map((h) => <th key={h} className="text-left px-3 py-2.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr><td colSpan={11} className="p-10 text-center text-slate-400">Carregando gastos...</td></tr>
              )}
              {!loading && !visible.length && (
                <tr>
                  <td colSpan={11} className="p-10 text-center text-slate-500">
                    Nenhum lançamento encontrado com os filtros atuais.
                  </td>
                </tr>
              )}
              {visible.map((row) => {
                const e = row.expense;
                const resumo = row.events.length
                  ? `${row.events.slice(0, 3).map((ev) => ev.rotulo).join(', ')}${row.events.length > 3 ? ` +${row.events.length - 3}` : ''}`
                  : '—';
                return (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 whitespace-nowrap">{formatExpenseDate(e.date)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{DATA_HORA(e.updated_date)}</td>
                    <td className="px-3 py-2.5 font-medium">{e.description || '—'}</td>
                    <td className="px-3 py-2.5">
                      {expenseCategoryLabel(e)}
                      {inactiveIds.has(e.category_id) && (
                        <span className="block text-xs text-amber-600">categoria inativa</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{e.beneficiary_name || '—'}</td>
                    <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{formatExpenseAmount(e.amount)}</td>
                    <td className="px-3 py-2.5">
                      {expenseStatusLabel(e)}
                      {row.excluido && <span className="block text-xs text-rose-600">excluído</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">
                      {EXPENSE_ORIGIN_LABELS[e.origin_type || 'manual'] || e.origin_type}
                    </td>
                    <td className="px-3 py-2.5">
                      {hasExpenseProof(e) ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <Paperclip className="w-3 h-3" /> sim
                        </span>
                      ) : <span className="text-xs text-amber-600">não</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{resumo}</td>
                    <td className="px-3 py-2.5">
                      <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setSelected(row)}>
                        <Eye className="w-3.5 h-3.5" /> Ver detalhes
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <HistoryDetail row={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

