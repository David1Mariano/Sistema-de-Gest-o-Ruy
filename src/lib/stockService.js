// ---------------------------------------------------------------------------
// Fonte única de verdade sobre o SALDO de estoque.
//
// Antes desta fase, cada tela escrevia `InventoryItem.current_stock` por conta
// própria: lia o saldo que já estava na tela, calculava o novo e chamava
// `update()`. Como o `update()` faz GET+PATCH sem condição, duas máquinas que
// movimentassem o mesmo item ao mesmo tempo sobrescreviam uma a outra: saldo
// 10, uma baixa 2 e a outra baixa 3, e o banco ficava com 8 ou 7 — a saída de
// 5 se perdia. Além disso nada impedia saldo e histórico de divergirem, porque
// a movimentação era gravada em outra chamada.
//
// Aqui o saldo só muda dentro de `transact`, que lê, calcula e grava de forma
// atômica (compare-and-swap na nuvem; transação única no IndexedDB). O cálculo
// usa SEMPRE o valor lido dentro da transação, nunca o que veio na tela. A
// movimentação correspondente é gravada na sequência.
//
// Ordem deliberada: saldo primeiro, histórico depois. Se o histórico falhar, o
// saldo é revertido, para não sobrar estoque sem lançamento (ver
// `compensarSaldo`). O inverso deixaria um lançamento apontando para um saldo
// que não existe.
//
// A garantia real de unicidade do `client_token` depende do índice único do
// banco (migration de integridade) — hoje ela é garantida aqui, na aplicação,
// pela checagem por token antes de qualquer escrita.
// ---------------------------------------------------------------------------
import { base44 } from '@/api/base44Client';
import {
  MOVEMENT_TYPES,
  StockError,
  costsAfter,
  roundMoney,
  roundQty,
  stockDirection,
  todayISO,
  validateMovement,
} from '@/lib/stockRules';
import { DELETE_MODE, itemDecision, itemDeletePatch } from '@/lib/stockItemUtils';

const InventoryItem = base44.entities.InventoryItem;
const StockMovement = base44.entities.StockMovement;
const PurchaseItem = base44.entities.PurchaseItem;
const RecipeIngredient = base44.entities.RecipeIngredient;

/**
 * Token de idempotência. Um duplo clique (ou um reenvio) do mesmo lançamento
 * precisa carregar o MESMO token, senão vira duas movimentações.
 */
export function newClientToken(prefix = 'mov') {
  const rnd = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`)
    .replaceAll('-', '')
    .slice(0, 18);
  return `${prefix}_${rnd}`;
}

/** Movimentação já gravada com este token? (proteção contra duplo envio) */
export async function findMovementByClientToken(clientToken) {
  if (!clientToken) return null;
  const rows = await StockMovement.filter({ client_token: clientToken });
  return rows && rows.length ? rows[0] : null;
}

function assertFresh(item) {
  if (!item || !item.id) throw new StockError('Selecione o item de estoque.', 'item_obrigatorio');
}

/**
 * Aplica uma movimentação de estoque de forma segura contra concorrência.
 *
 * `quantity` é sempre a MAGNITUDE (3, não -3); a direção vem do tipo. Para
 * ajuste de saldo use `targetBalance`, que fixa o saldo final.
 */
async function aplicarMovimentacao({
  item,
  type,
  quantity,
  targetBalance = null,
  unitCost = 0,
  date,
  originType = 'manual',
  originId = '',
  observation = '',
  clientToken = '',
  responsibleUser = '',
  retries = 6,
}) {
  assertFresh(item);

  // Idempotência: se este token já foi usado, não mexe em nada.
  const jaExiste = await findMovementByClientToken(clientToken);
  if (jaExiste) {
    return { movement: jaExiste, item: await InventoryItem.get(item.id), duplicated: true };
  }

  // A FORMA do lançamento é validada aqui fora (a mensagem é a mesma). O SALDO,
  // esse sim, só pode ser conferido dentro da transação, usando o valor atual:
  // conferir aqui usaria um número velho e deixaria passar uma saída maior do
  // que o saldo existente.
  const ehAjusteDeSaldo = targetBalance !== null && targetBalance !== undefined;
  // No ajuste de inventário não existe "quantidade": o usuário informa o SALDO
  // final. A diferença para o saldo atual é calculada dentro da transação, e é
  // ela que vira a quantidade da movimentação.
  const qty = ehAjusteDeSaldo ? 0 : validateMovement({ item, type, quantity, unit: item.unit, allowNegative: true });
  let saldoAntes = null;
  let saldoDepois = null;
  let custoDepois = { average: null, last: null };

  if (ehAjusteDeSaldo) {
    const alvo = roundQty(targetBalance);
    if (!Number.isFinite(alvo)) throw new StockError('Saldo de ajuste inválido.', 'quantidade_invalida');
    if (alvo < 0) throw new StockError('O saldo de ajuste não pode ser negativo.', 'saldo_invalido');
  }

  // ---- 1. Saldo: uma única operação atômica -------------------------------
  // `mutate` precisa ser PURA: o compare-and-swap a chama de novo quando há
  // conflito, e um efeito colateral aqui viraria lançamento duplicado.
  const atualizado = await InventoryItem.transact(
    item.id,
    (atual) => {
      const current = roundQty(atual?.current_stock) || 0;
      const next = ehAjusteDeSaldo
        ? roundQty(targetBalance)
        : roundQty(stockDirection(type) === 'entrada' ? current + qty : current - qty);
      if (!Number.isFinite(next)) throw new StockError('Saldo calculado ficou inválido.', 'quantidade_invalida');
      if (next < 0) {
        throw new StockError(
          `Saldo insuficiente: "${item.name}" tem ${current} ${item.unit || ''} e a saída é de ${qty} ${item.unit || ''}.`,
          'saldo_insuficiente'
        );
      }
      // No ajuste de inventário o custo NÃO muda: o usuário contou o que tem,
      // não entrou mercadoria. Deixar `costsAfter` recalcular com qty 0
      // zeraria o custo médio do item.
      const custos = ehAjusteDeSaldo
        ? { average: roundMoney(atual?.average_cost) || 0, last: roundMoney(atual?.last_cost) || 0 }
        : costsAfter({ item: atual, type, quantity: qty, unitCost });
      saldoAntes = current;
      saldoDepois = next;
      custoDepois = custos;
      const patch = { current_stock: next, updated_date: new Date().toISOString() };
      if (custos.average !== null && custos.average !== undefined) {
        patch.average_cost = custos.average;
        patch.last_cost = custos.last;
      }
      return patch;
    },
    { retries }
  );

  // ---- 2. Histórico -------------------------------------------------------
  // No ajuste, o delta é a diferença entre o saldo alvo e o saldo que a
  // transação REALMENTE leu — não o que a tela mostrava.
  const magnitude = ehAjusteDeSaldo ? Math.abs(roundQty(saldoDepois - saldoAntes)) : qty;
  const custoUnit = roundMoney(unitCost) || 0;

  const payload = {
    date: date || todayISO(),
    inventory_item_id: item.id,
    item_name: item.name,
    movement_type: type,
    direction: stockDirection(type),
    quantity: magnitude,
    unit: item.unit,
    unit_cost: custoUnit,
    total_cost: roundMoney(magnitude * custoUnit) || 0,
    balance_before: saldoAntes,
    balance_after: saldoDepois,
    origin_type: originType,
    origin_id: originId,
    responsible_user: responsibleUser,
    observation,
    ...(clientToken ? { client_token: clientToken } : {}),
  };

  let movimento;
  try {
    movimento = await StockMovement.create(payload);
  } catch (err) {
    // O saldo já mudou: desfaz para não deixar estoque sem histórico.
    await compensarSaldo({ itemId: item.id, from: saldoDepois, to: saldoAntes, custo: custoDepois, retries });
    throw new StockError(
      `O saldo foi revertido porque a movimentação não pôde ser gravada: ${err.message || err}`,
      'movimento_falhou'
    );
  }

  return { movement: movimento, item: atualizado, duplicated: false };
}

/** Desfaz o saldo quando o histórico falha, para não ficar inconsistente. */
async function compensarSaldo({ itemId, from, to, custo, retries = 6 }) {
  try {
    await InventoryItem.transact(
      itemId,
      (atual) => {
        // Só reverte se o saldo ainda for o que esta operação gravou; se alguém
        // mexeu depois, mexer aqui apagaria a movimentação alheia.
        if (roundQty(atual?.current_stock) !== from) return null;
        return {
          current_stock: roundQty(to) || 0,
          ...(custo && custo.average !== null && custo.average !== undefined
            ? { average_cost: custo.average, last_cost: custo.last }
            : {}),
          updated_date: new Date().toISOString(),
        };
      },
      { retries }
    );
  } catch (err) {
    // Falhou a compensação: registro o problema em vez de esconder.
    console.error('[stockService] Falha ao compensar o saldo de', itemId, err);
  }
}


// ---------------------------------------------------------------------------
// API pública. Cada operação real de estoque passa por aqui; nenhuma tela
// escreve `current_stock` direto.
// ---------------------------------------------------------------------------

/** Entrada, saída e perda. A quantidade é a magnitude; a direção vem do tipo. */
export function registrarMovimentacao(args) {
  return aplicarMovimentacao(args);
}

/** Atalho de entrada de estoque. */
export function registrarEntrada(args) {
  return aplicarMovimentacao({ ...args, type: MOVEMENT_TYPES.ENTRADA_MANUAL });
}

/** Atalho de saída de estoque. */
export function registrarSaida(args) {
  return aplicarMovimentacao({ ...args, type: MOVEMENT_TYPES.SAIDA_MANUAL });
}

/** Atalho de perda. Uma perda é uma saída cujo motivo fica no histórico. */
export function registrarPerda(args) {
  return aplicarMovimentacao({ ...args, type: MOVEMENT_TYPES.PERDA });
}

/**
 * Ajuste de inventário: fixa o SALDO final, em vez de somar uma quantidade.
 * A diferença para o saldo atual é calculada dentro da transação, então dois
 * inventários simultâneos não se sobrescrevem.
 */
export function ajustarSaldo({ item, targetBalance, type = MOVEMENT_TYPES.AJUSTE, ...resto }) {
  return aplicarMovimentacao({ ...resto, item, targetBalance, type });
}

/** Entrada de estoque originada por uma compra recebida. */
export function registrarEntradaDeCompra(args) {
  return aplicarMovimentacao({ ...args, type: MOVEMENT_TYPES.ENTRADA_COMPRA, originType: 'compra' });
}

/**
 * Cria um item de estoque e, se ele nascer com saldo, registra a MOVIMENTAÇÃO
 * de saldo inicial.
 *
 * Antes, a tela fazia `InventoryItem.create({ current_stock: 50 })`: o item
 * passava a existir com 50 unidades e o histórico ficava vazio. Respondendo
 * "por que este produto está com saldo 50?" só se consultasse o cadastro —
 * não havia lançamento explicando a entrada. Isso quebra a rastreabilidade
 * que o resto do serviço promete.
 *
 * Decisões:
 * - Saldo zero (ou vazio) NÃO gera movimentação: um lançamento de 0 só polui
 *   o histórico. O item nasce em 0, como sempre.
 * - O item é SEMPRE criado começando em 0, e o saldo entra pelo mesmo caminho
 *   de qualquer outra entrada (`aplicarMovimentacao`). Assim o saldo inicial
 *   passa pelo mesmo compare-and-swap, gera o mesmo formato de histórico e
 *   respeita a mesma proteção de saldo insuficiente.
 * - O movimento usa `AJUSTE_ENTRADA` (entrada de ajuste) com
 *   `origin_type: 'saldo_inicial'`. O vocabulário é o que já existe no
 *   projeto: nenhum tipo novo foi inventado.
 *
 * FALHA PARCIAL — leia antes de usar:
 * Não existe transação entre duas entidades. Se o item for criado e a
 * movimentação falhar, o item fica sem histórico. Preferimos isso a deletar
 * o item: perder o cadastro do usuário seria pior, e o serviço DEVOLVE o erro
 * (com `codigo: 'saldo_inicial_sem_historico'`) para a tela avisar, em vez de
 * fingir sucesso. A correção definitiva é a RPC transacional preparada em
 * `supabase/migrations/` — ainda não aplicada.
 */
export async function criarItemComEstoqueInicial({
  item,
  openingQty = 0,
  unitCost = 0,
  date,
  responsibleUser = '',
  observation = '',
  clientToken = '',
  retries = 6,
}) {
  if (!item || !item.name) throw new StockError('Informe o nome do item de estoque.', 'item_obrigatorio');

  const abertura = roundQty(openingQty);
  if (openingQty !== '' && openingQty !== null && openingQty !== undefined && !Number.isFinite(abertura)) {
    throw new StockError('Estoque inicial inválido.', 'quantidade_invalida');
  }
  const qty = Number.isFinite(abertura) ? abertura : 0;
  if (qty < 0) throw new StockError('O estoque inicial não pode ser negativo.', 'saldo_invalido');

  // Nasce sempre em zero. O saldo entra como movimentação logo abaixo.
  const criado = await InventoryItem.create({ ...item, current_stock: 0 });

  if (qty === 0) {
    return { item: criado, movement: null, itemId: criado.id, openingQty: 0 };
  }

  // Token estável para o mesmo item: reenviar a mesma criação não duplica a
  // entrada. O prefixo `abertura:` é exclusivo deste fluxo.
  const token = clientToken || `abertura:${criado.id}`;

  try {
    const r = await aplicarMovimentacao({
      item: criado,
      type: MOVEMENT_TYPES.AJUSTE_ENTRADA,
      quantity: qty,
      unitCost: Number.isFinite(roundMoney(unitCost)) ? roundMoney(unitCost) : 0,
      date,
      originType: 'saldo_inicial',
      originId: criado.id,
      observation: observation || 'Estoque inicial no cadastro do item',
      // `responsibleUser` só é repassado se existir de verdade: inventar um
      // responsável no histórico seria pior do que deixá-lo vazio.
      responsibleUser: responsibleUser || '',
      clientToken: token,
      retries,
    });
    // `duplicated` vem do `aplicarMovimentacao`: um reenvio com o mesmo token
    // não mexe no saldo e devolve o movimento já existente.
    return {
      item: r.item,
      movement: r.movement,
      itemId: criado.id,
      openingQty: qty,
      duplicated: r.duplicated === true,
    };
  } catch (err) {
    throw new StockError(
      `O item "${criado.name}" foi criado, mas o lançamento de estoque inicial não pôde ser gravado (${err.message || err}). `
      + 'Abra o ajuste de inventário para registrar a entrada.',
      'saldo_inicial_sem_historico'
    );
  }
}

// ---------------------------------------------------------------------------
// Exclusão, desativação e reativação de item de estoque.
//
// A mutação de `status` mora AQUI, e não na tela, por dois motivos:
//
// 1. `check:stock` (scripts/check-stock-integrity.mjs) proíbe `InventoryItem.
//    update(...)` fora deste arquivo. A regra existe porque o update sem
//    condição reescreve a linha inteira e, com `current_stock` junto, destrói
//    saldo. Passar por aqui mantém o saldo sob `transact`.
// 2. A decisão de apagar ou desativar precisa ser reavaliada contra o banco no
//    momento da escrita, não contra a linha que a tela tinha em memória. Entre
//    abrir o modal e clicar em confirmar, alguém pode ter registrado uma
//    movimentação. A tela decide para dar o feedback certo; aqui decide de novo
//    para não confiar na tela.
//
// `StockMovement` nunca é apagado e nada é apagado em cascata, em nenhum
// caminho. A única chamada de `delete` é a do próprio `InventoryItem`, e
// apenas quando o item é comprovadamente descartável.
// ---------------------------------------------------------------------------

/**
 * Vínculos queREFERENCIAM um item: histórico de movimentação, itens de compra e
 * ingredientes de ficha técnica.
 *
 * Sem `.catch`: se a consulta falhar, o erro sobe e a operação é abortada.
 * Tratar falha como "sem vínculos" liberaria exclusão física de um item que
 * talvez tenha histórico — o pior resultado possível aqui.
 */
export async function buscarVinculosDoItem(itemId) {
  const [movements, purchaseItems, recipeIngredient] = await Promise.all([
    StockMovement.filter({ inventory_item_id: itemId }),
    PurchaseItem.filter({ inventory_item_id: itemId }),
    RecipeIngredient.filter({ inventory_item_id: itemId }),
  ]);
  return {
    movements: movements || [],
    purchaseItems: purchaseItems || [],
    recipeIngredient: recipeIngredient || [],
  };
}

/** Relê o item do banco: a decisão de apagar nunca usa a linha da tela. */
async function relerItem(item) {
  if (!item || !item.id) throw new StockError('Selecione o item de estoque.', 'item_obrigatorio');
  if (typeof InventoryItem.get === 'function') {
    const atual = await InventoryItem.get(item.id);
    if (atual) return atual;
  }
  const linhas = await InventoryItem.filter({ id: item.id });
  return (linhas && linhas[0]) || item;
}

/**
 * Executa a decisão de exclusão, revalidando tudo no banco.
 *
 * @param {object} mode  `DELETE_MODE.DELETE` ou `DELETE_MODE.DEACTIVATE`.
 * @throws {StockError} se a revalidação não sustentar o caminho pedido.
 */
export async function excluirOuDesativarItem({ item, mode }) {
  const atual = await relerItem(item);
  const vinculos = await buscarVinculosDoItem(atual.id);
  const esperado = itemDecision(atual, vinculos);

  // O caminho pedido precisa ser exatamente o que o banco autoriza agora. Se
  // qualquer um dos dois for `blocked`, não há nada a fazer.
  if (esperado.mode === DELETE_MODE.BLOCKED || esperado.mode !== mode) {
    throw new StockError(
      esperado.blocker || 'Não é possível concluir a operação com o estado atual do item.',
      'exclusao_bloqueada'
    );
  }

  if (mode === DELETE_MODE.DELETE) {
    await InventoryItem.delete(atual.id);
    return { itemId: atual.id, mode: DELETE_MODE.DELETE, name: atual.name };
  }

  const patch = itemDeletePatch();
  await InventoryItem.update(atual.id, patch);
  return { itemId: atual.id, mode: DELETE_MODE.DEACTIVATE, name: atual.name, status: patch.status };
}

/**
 * Reativa o MESMO registro — nenhum item novo é criado e o histórico é mantido.
 * Só o `status` volta a `ativo`; o saldo não é tocado.
 */
export async function reativarItem({ item }) {
  const atual = await relerItem(item);
  await InventoryItem.update(atual.id, { status: 'ativo' });
  return { itemId: atual.id, status: 'ativo', name: atual.name };
}

