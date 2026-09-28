// Categorias de gasto.
//
// A entidade `ExpenseCategory` JÁ existe e é persistida pelo mesmo caminho de
// todas as demais entidades do sistema (Supabase `records` compartilhado entre
// máquinas, ou IndexedDB sem nuvem). Nenhuma tabela nova é necessária: criar
// uma categoria é um `ExpenseCategory.create`, exatamente como o cadastro
// generalize já faz no Financeiro.
//
// O gasto NUNCA guarda total: `FinancialExpense` só referencia `category_id`
// e `category_name`. Os totais por categoria são DERIVADOS dos gastos reais
// (ver `summarizeByCategory`), então editar, mover de categoria, cancelar ou
// excluir recalcula tudo sem risco de dessincronizar.
import { normalizeExpenseText, isCancelledExpense, formatExpenseAmount } from './dailyExpenses.js';

// Chave de comparação: sem acento, sem caixa e sem espaços extras.
// "Limpeza", "limpeza", " LIMPEZA " viram a MESMA categoria.
export function categoryKey(name) {
  return normalizeExpenseText(name).replace(/\s+/g, ' ');
}

export function sameCategoryName(a, b) {
  return Boolean(categoryKey(a)) && categoryKey(a) === categoryKey(b);
}

// Categoria equivalente já existente? Devolve o registro ou null.
export function findEquivalentCategory(categories = [], name) {
  const key = categoryKey(name);
  if (!key) return null;
  return (categories || []).find((category) => categoryKey(category?.name) === key) || null;
}

export function normalizeCategoryName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim();
}

// Categorias que o usuário pode escolher: ativas primeiro, sem repetir nomes
// equivalentes (protege contra duplicatas antigas já gravadas no banco).
export function selectableCategories(categories = []) {
  const seen = new Set();
  const ordered = [...(categories || [])].sort((a, b) => {
    const ativo = (b.status === 'ativo' ? 1 : 0) - (a.status === 'ativo' ? 1 : 0);
    if (ativo) return ativo;
    return String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR');
  });
  return ordered.filter((category) => {
    const key = categoryKey(category?.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Soma por categoria a partir dos gastos REAIS. Cancelados nunca entram.
// Retorna [{ chave, nome, total, quantidade }] ordenado pelo maior total.
export function summarizeByCategory(rows = []) {
  const byKey = new Map();
  for (const expense of rows || []) {
    if (isCancelledExpense(expense)) continue;
    const nome = String(expense.category_name || '').trim() || 'Sem categoria';
    const key = categoryKey(nome) || 'sem-categoria';
    const atual = byKey.get(key) || { chave: key, nome, total: 0, quantidade: 0 };
    atual.total += Number(expense.amount) || 0;
    atual.quantidade += 1;
    byKey.set(key, atual);
  }
  return [...byKey.values()]
    .map((row) => ({ ...row, total: Math.round(row.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Total geral: DERIVADO dos registros e SEMPRE coerente com o resumo por
// categoria — um gasto CANCELADO não entra em nenhum total, senão o número da
// tela não bateria com a lista. `includeCancelled` existe só para quem precisar
// do valor bruto.
export function totalOf(rows = [], { includeCancelled = false } = {}) {
  const base = includeCancelled ? (rows || []) : (rows || []).filter((e) => !isCancelledExpense(e));
  return Math.round(base.reduce((s, expense) => s + (Number(expense.amount) || 0), 0) * 100) / 100;
}

export const formatCategoryTotal = (value) => formatExpenseAmount(value);
