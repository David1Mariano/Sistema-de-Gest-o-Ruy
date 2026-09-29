// ---------------------------------------------------------------------------
// Resumo por Categoria — o "quanto foi gasto em cada categoria" do Histórico.
//
// Complementa a tela existente: NÃO é um segundo histórico, não duplica filtros e
// não cria consulta. Ele resume a MESMA lista que a tabela abaixo já mostra
// (`rows`, que já respeita período, busca, categoria, favorecido, situação,
// comprovante, origem e evento) e, ao clicar num card, escreve no filtro de
// categoria JÁ EXISTENTE. Uma lista, dois usos.
//
// Decisões que valem registro
// ---------------------------
// - Nenhuma categoria é hardcoded: os grupos vêm de `category_name` do próprio
//   gasto, então uma categoria criada hoje ("Troco de motoboy") aparece sozinha.
// - Gasto SEM categoria vira "Sem categoria" (mesma regra de
//   `summarizeByCategory`, que o painel do Gastos já usa).
// - Cancelados NÃO entram no total, porque `summarizeByCategory` já os ignora —
//   a mesma regra do resumo do painel. A tabela do histórico continua MOSTRANDO
//   o cancelado (é log de auditoria); o resumo diz o que foi efetivamente gasto.
//   A diferença é intencional e está rotulada na tela.
// - Agrupamento é LOCAL, em memória: uma tabela carregada, zero queries extras.
//   Nenhuma categoria gera uma requisição.
// - A soma usa o `Number(amount)` já normalizado na gravação, com arredondamento
//   de centavos ao final — nunca concatenação de string.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { summarizeByCategory, totalOf } from '@/lib/expenseCategories';
import {
  expenseMethodLabel, formatExpenseAmount, formatExpenseDate, hasExpenseProof,
} from '@/lib/dailyExpenses';

export default function CategoryDigest({ rows = [], periodLabel = '', onPick, selectedKey = '' }) {
  const [grupoAberto, setGrupoAberto] = useState(null);
  // Uma passada sobre a lista já filtrada. `incluirGastos` traz os lançamentos
  // por referência para o detalhamento, sem consultar nada.
  const grupos = useMemo(() => summarizeByCategory(rows, { incluirGastos: true }), [rows]);
  const total = useMemo(() => totalOf(rows), [rows]);

  if (!grupos.length) return null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3 space-y-3" aria-label="Resumo por categoria">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">
          Resumo por categoria{periodLabel ? ` — ${periodLabel}` : ''}
        </h4>
        <p className="text-sm text-slate-500">
          Total gasto: <span className="font-semibold text-slate-900">{formatExpenseAmount(total)}</span>
        </p>
      </div>

      {/* Grid responsivo: quebra em telas pequenas, sem tabela horizontal. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {grupos.map((grupo) => {
          const ativo = selectedKey === grupo.chave;
          return (
            <button
              key={grupo.chave}
              type="button"
              onClick={() => {
                // Clicar de novo desmarca: o card alterna, não só liga.
                const proximo = ativo ? '' : grupo.chave;
                onPick?.(proximo, grupo);
                setGrupoAberto(ativo ? null : grupo);
              }}
              aria-pressed={ativo}
              title={`Ver lançamentos de ${grupo.nome}`}
              className={`text-left rounded-lg border p-2.5 transition-colors ${
                ativo
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white'
              }`}
            >
              <p className={`text-xs font-medium truncate ${ativo ? 'text-slate-100' : 'text-slate-500'}`}>
                {grupo.nome}
              </p>
              <p className="text-sm font-semibold tabular-nums">{formatExpenseAmount(grupo.total)}</p>
              <p className={`text-xs ${ativo ? 'text-slate-300' : 'text-slate-400'}`}>
                {grupo.quantidade} lançamento{grupo.quantidade === 1 ? '' : 's'}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {selectedKey && (
          <button
            type="button"
            onClick={() => { onPick?.('', null); setGrupoAberto(null); }}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            <X className="w-3 h-3" /> Limpar filtro de categoria
          </button>
        )}
        <p className="text-xs text-slate-400">
          Gastos cancelados não entram nos totais, mas continuam visíveis na tabela abaixo.
        </p>
      </div>
      {/* Detalhamento sob o resumo: os lançamentos que formam aquele total.
          Não é um modal nem uma segunda lista permanente — é um desdobramento
          da área do resumo, some ao limpar o filtro e some ao fechar a tela. */}
      {grupoAberto && (
        <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-sm font-semibold text-slate-900">
              Lançamentos de {grupoAberto.nome}
            </h5>
            <button
              type="button"
              onClick={() => setAberto(null)}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            >
              <X className="w-3 h-3" /> Fechar detalhamento
            </button>
          </div>

          <ul className="divide-y rounded border border-slate-200 bg-white">
            {grupoAberto.gastos.map((g) => (
              <li key={g.id || `${g.date}-${g.description}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-slate-800">{g.description || 'Sem descrição'}</span>
                  <span className="text-xs text-slate-500">
                    {formatExpenseDate(g.date)}
                    {g.beneficiary_name ? ` · ${g.beneficiary_name}` : ''}
                    {g.payment_method ? ` · ${expenseMethodLabel(g)}` : ''}
                    {hasExpenseProof(g) ? ' · com comprovante' : ''}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-slate-900">{formatExpenseAmount(g.amount)}</span>
              </li>
            ))}
          </ul>

          <p className="text-sm text-slate-600">
            Total da categoria:{' '}
            <b className="text-slate-900">{formatExpenseAmount(grupoAberto.total)}</b>{' '}
            <span className="text-xs text-slate-400">
              ({grupoAberto.quantidade} lançamento{grupoAberto.quantidade === 1 ? '' : 's'})
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
