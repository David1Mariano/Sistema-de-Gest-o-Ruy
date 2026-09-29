// Itens de estoque (InventoryItem) — regras de exclusão, desativação e
// reativação.
//
// A distinção que importa:
//
//   EXCLUSÃO FÍSICA  só quando o item é descartável: saldo zero, sem
//                     movimentação e sem vínculo. Aí a linha não tem
//                     histórico a preservar, então apagar é seguro.
//
//   DESATIVAÇÃO      quando existe histórico (movimentações) ou vínculo
//                     operacional, mas o saldo é zero. Apagar deixaria
//                     StockMovement apontando para um item inexistente,
//                     então a linha é preservada e apenas sai das opções
//                     novas — reversível, e o histórico continua.
//
//   BLOQUEIO         quando o saldo não é zero: nem apagar nem desativar.
//     Desativar com saldo esconderia estoque real dos seletores de Compras e
//     Produção, que é pior do que o item continuar visível.
//
// Regra de ouro: `StockMovement` NUNCA é apagado e NADA é apagado em cascata.
// A única chamada de delete é a do próprio InventoryItem, e só no caminho de
// exclusão física.
//
// Este módulo é PURO (sem banco), como roleUtils, para poder ser testado.

export const DELETE_MODE = {
  DELETE: 'delete',          // exclusão física permitida
  DEACTIVATE: 'deactivate',  // só desativação lógica
  BLOCKED: 'blocked',        // nada a fazer
};

/** Saldo atual do item, tolerante a texto/ausência. */
export function itemSaldo(item) {
  const n = Number(item?.current_stock);
  return Number.isFinite(n) ? n : 0;
}

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export const SALDO_MSG =
  'Este item ainda possui saldo em estoque. Faça um ajuste para 0 antes de excluir ou desativar.';

/**
 * Decide o que pode ser feito com o item.
 *
 * `movements`, `purchaseItems` e `recipeIngredients` são as LINHAS que
 * referenciam ESTE item (a tela busca por `inventory_item_id`, sem depender
 * da lista resumida que já está em memória).
 *
 * @returns {{mode: string, blocker: string|null, detalhe?: string, podeApagar: boolean}}
 */
export function itemDecision(item, { movements = [], purchaseItems = [], recipeIngredient = [] } = {}) {
  if (!item || !item.id) {
    return { mode: DELETE_MODE.BLOCKED, blocker: 'Item de estoque não encontrado.', podeApagar: false };
  }

  // 1) Saldo diferente de zero bloqueia TUDO, antes de qualquer outra análise.
  if (itemSaldo(item) !== 0) {
    return { mode: DELETE_MODE.BLOCKED, blocker: SALDO_MSG, podeApagar: false };
  }

  // 2) Histórico/vínculo impedem apagar, mas ainda permitem desativar.
  const motivos = [];
  if (movements.length) motivos.push(`${plural(movements.length, 'movimentação', 'movimentações')} no histórico`);
  if (purchaseItems.length) motivos.push(`${plural(purchaseItems.length, 'item vinculado', 'itens vinculados')} em compras`);
  if (recipeIngredient.length) motivos.push(`${plural(recipeIngredient.length, 'ficha técnica', 'fichas técnicas')} de produção`);
  if (motivos.length) {
    return {
      mode: DELETE_MODE.DEACTIVATE,
      blocker: 'Este item possui histórico de movimentações e não pode ser apagado definitivamente. '
        + 'Você pode desativá-lo para preservar o histórico.',
      detalhe: motivos.join('; '),
      podeApagar: false,
    };
  }

  // 3) Item descartável: sem saldo, sem histórico, sem vínculo.
  return { mode: DELETE_MODE.DELETE, blocker: null, podeApagar: true };
}

/** Resumo curto dos vínculos, para a tela detalhar quem impede. */
export function itemVincSummary({ movements = [], purchaseItems = [], recipeIngredient = [] } = {}) {
  const partes = [];
  if (movements.length) partes.push(`${movements.length} movimentação(ões)`);
  if (purchaseItems.length) partes.push(`${purchaseItems.length} item(ns) de compra`);
  if (recipeIngredient.length) partes.push(`${recipeIngredient.length} ficha(s) técnica(s)`);
  return partes.join(' · ');
}

/** O que o botão "Excluir" grava no caminho de desativação. */
export const itemDeletePatch = () => ({ status: 'inativo' });

/** O que o botão "Reativar" grava — MESMO registro, nenhum item novo. */
export const itemReactivatePatch = () => ({ status: 'ativo' });

/** Itens visíveis numa aba da lista. `aba` = 'ativo' | 'inativo' | 'todos'. */
export function itemsForTab(items = [], aba = 'ativo') {
  const lista = items || [];
  if (aba === 'todos') return lista;
  const alvo = aba === 'inativo' ? 'inativo' : 'ativo';
  // Item sem `status` conta como ativo — é o que a tela já fazia.
  return lista.filter((x) => (x?.status || 'ativo') === alvo);
}

export const LIST_TABS = [
  { key: 'ativo', label: 'Ativos' },
  { key: 'inativo', label: 'Inativos' },
  { key: 'todos', label: 'Todos' },
];
