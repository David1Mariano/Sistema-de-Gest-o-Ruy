// ---------------------------------------------------------------------------
// Fonte única de verdade das movimentações de estoque.
//
// Antes, cada tela escrevia `InventoryItem.current_stock` por conta própria
// (Estoque.jsx, Compras.jsx) e criava o StockMovement com o saldo "chutado".
// Isso permitia saldo divergente, movimentação duplicada e perda de
// atualização quando duas máquinas lançavam ao mesmo tempo.
//
// Aqui o saldo do item é SEMPRE derivado de uma movimentação, e a gravação usa
// `transact` (transação no IndexedDB / compare-and-swap no Supabase), de modo
// que duas operações simultâneas não se sobrescrevem.
//
// As regras puras (tipos, direção, validação) ficam em stockRules.js.
// ---------------------------------------------------------------------------
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/pontoUtils';
import { roundMoney, roundQty } from '@/lib/numberUtils';
import {
  MOVEMENT_TYPES,
  StockError,
  costsAfter,
  movementTypeLabel,
  signedQuantity,
  stockDirection,
  todayISO,
  validateMovement,
} from '@/lib/stockRules';

// Reexportados para as telas importarem tudo de um lugar só.
export {
  MOVEMENT_LABELS,
  MOVEMENT_TYPES,
  StockError,
  UNITS,
  balanceFromMovements,
  movementTypeLabel,
  roundMoney,
  roundQty,
  signedQuantity,
  stockDirection,
  todayISO,
  validateMovement,
} from '@/lib/stockRules';

const nowISO = () => new Date().toISOString();

async function findByClientToken(token) {
  if (!token) return null;
  const rows = await base44.entities.StockMovement.filter({ client_token: token });
  return rows && rows.length ? rows[0] : null;
}

/**
 * Registra uma movimentação de estoque e atualiza o saldo do item de forma
 * atômica (nada de "atualizar quantidade" num lugar e movementar em outro).
 *
 * - `clientToken` torna a operação idempotente: reenvios (double clique, retry
 *   de rede) devolvem a movimentação já existente em vez de duplicar.
 * - Devolve `{ movement, item }` somente depois de gravar no banco.
 */
export async function registerMovement({
  item,
  type,
  quantity,
  date = todayISO(),
  unit,
  unitCost = 0,
  originType = 'manual',
  originId = '',
  reference = '',
  purchaseId = '',
  purchaseItemId = '',
  productionId = '',
  observation = '',
  responsibleUser = 'Sistema',
  clientToken = '',
  allowNegative = false,
}) {
  if (clientToken) {
    const already = await findByClientToken(clientToken);
    if (already) {
      const fresh = await base44.entities.InventoryItem.get(item.id);
      return { movement: already, item: fresh, duplicated: true };
    }
  }

  const qty = validateMovement({ item, type, quantity, unit, allowNegative });
  const unitName = String(item.unit || unit || 'un');
  const cost = Number.isFinite(roundMoney(unitCost)) ? roundMoney(unitCost) : 0;
  const direction = stockDirection(type);

  // 1) Saldo: leitura + gravação na mesma transação (IndexedDB) ou com
  //    compare-and-swap (Supabase). Nunca confiamos no valor do React.
  let before = null;
  let after = null;
  const updated = await base44.entities.InventoryItem.transact(
    item.id,
    (current) => {
      const currentQty = roundQty(current?.current_stock) || 0;
      const next = roundQty(direction === 'entrada' ? currentQty + qty : currentQty - qty);
      if (!allowNegative && next < 0) {
        throw new StockError(
          `Saldo insuficiente: "${current.name}" tem ${currentQty} ${current.unit || ''} e a saída é de ${qty} ${current.unit || ''}.`,
          'saldo_insuficiente'
        );
      }
      const { average, last } = costsAfter({ item: current, type, quantity: qty, unitCost: cost });
      before = currentQty;
      after = next;
      return { current_stock: next, average_cost: average, last_cost: last };
    },
    { retries: 8 }
  );

  // 2) Movimentação (histórico): saldo anterior/posterior vêm da transação,
  //    nunca de um chute feito antes dela.
  const payload = {
    date,
    inventory_item_id: item.id,
    item_name: item.name,
    movement_type: type,
    direction,
    quantity: qty,
    unit: unitName,
    unit_cost: cost,
    total_cost: roundMoney(qty * cost),
    balance_before: before,
    balance_after: after,
    average_cost_after: roundMoney(updated?.average_cost ?? cost),
    origin_type: originType,
    origin_id: originId,
    reference,
    ...(purchaseId ? { purchase_id: purchaseId } : {}),
    ...(purchaseItemId ? { purchase_item_id: purchaseItemId } : {}),
    ...(productionId ? { production_id: productionId } : {}),
    ...(clientToken ? { client_token: clientToken } : {}),
    observation,
    responsible_user: responsibleUser,
  };

  let movement;
  try {
    movement = await base44.entities.StockMovement.create(payload);
  } catch (err) {
    // O saldo já foi alterado: desfaz para não deixar estoque sem histórico.
    try {
      await base44.entities.InventoryItem.transact(
        item.id,
        (current) => ({ current_stock: roundQty(current?.current_stock) || 0 }),
        { retries: 8 }
      );
    } catch (rollbackErr) {
      console.error('[estoque] Falha ao desfazer o saldo após erro na movimentação:', rollbackErr);
    }
    throw err;
  }

  await logAudit({
    entity_type: 'StockMovement',
    entity_id: movement.id,
    action: 'criacao',
    field: 'quantity',
    old_value: `${before} ${unitName}`,
    new_value: `${movementTypeLabel(type)} ${qty} ${unitName} · saldo ${after}`,
    reason: observation,
    responsible_user: responsibleUser,
  });

  return { movement, item: updated, duplicated: false };
}

/**
 * Cancela uma movimentação gerando a movimentação inversa (estorno).
 * O registro original é preservado — nada de DELETE destrutivo, para o
 * histórico continuar explicando o saldo atual.
 */
export async function reverseMovement(movement, { reason, responsibleUser = 'Sistema', clientToken = '' }) {
  if (!movement) throw new StockError('Movimentação não encontrada.', 'movimentacao_inexistente');
  if (movement.reversed_by_movement_id) {
    throw new StockError('Esta movimentação já foi estornada.', 'ja_estornada');
  }
  const inverseType =
    stockDirection(movement.movement_type) === 'entrada'
      ? movement.movement_type === MOVEMENT_TYPES.ENTRADA_COMPRA
        ? MOVEMENT_TYPES.AJUSTE_SAIDA
        : MOVEMENT_TYPES.SAIDA_MANUAL
      : movement.movement_type === MOVEMENT_TYPES.PERDA
        ? MOVEMENT_TYPES.AJUSTE_ENTRADA
        : MOVEMENT_TYPES.ENTRADA_MANUAL;

  const item = await base44.entities.InventoryItem.get(movement.inventory_item_id);
  const result = await registerMovement({
    item,
    type: inverseType,
    quantity: roundQty(Math.abs(signedQuantity(movement))),
    date: todayISO(),
    unit: movement.unit,
    unitCost: 0,
    originType: 'estorno',
    originId: movement.id,
    reference: movement.reference || '',
    observation: `Estorno: ${reason || 'sem motivo informado'}`,
    responsibleUser,
    clientToken: clientToken || `reversao:${movement.id}`,
    allowNegative: stockDirection(inverseType) === 'saida',
  });

  await base44.entities.StockMovement.update(movement.id, {
    reversed_by_movement_id: result.movement.id,
    reversed_at: nowISO(),
    reversed_by: responsibleUser,
    reversal_reason: reason || '',
  });

  await logAudit({
    entity_type: 'StockMovement',
    entity_id: movement.id,
    action: 'estorno',
    field: 'reversed_by_movement_id',
    old_value: movementTypeLabel(movement.movement_type),
    new_value: result.movement.id,
    reason,
    responsible_user: responsibleUser,
  });

  return { movement: result.movement, item: result.item };
}

/**
 * Cria o item de estoque e, se houver saldo inicial, já grava a movimentação
 * de entrada correspondente (saldo anterior = 0). Assim nenhum saldo existe
 * sem lastro no histórico.
 */
export async function createInventoryItem({ item, responsibleUser = 'Sistema', clientToken = '' }) {
  const openingQty = roundQty(item?.current_stock) || 0;
  const unitCost = roundMoney(item?.average_cost) || 0;
  const created = await base44.entities.InventoryItem.create({ ...item, current_stock: 0 });

  await logAudit({
    entity_type: 'InventoryItem',
    entity_id: created.id,
    action: 'criacao',
    new_value: created.name,
    responsible_user: responsibleUser,
  });

  if (openingQty > 0) {
    await registerMovement({
      item: created,
      type: MOVEMENT_TYPES.AJUSTE_ENTRADA,
      quantity: openingQty,
      unitCost,
      originType: 'saldo_inicial',
      observation: 'Saldo inicial cadastrado junto com o item',
      responsibleUser,
      clientToken: clientToken || `abertura:${created.id}`,
      allowNegative: true,
    });
  }
  return created;
}

/** Atualiza o cadastro do item sem mexer no saldo (saldo só via movimentação). */
export async function updateInventoryItem(itemId, patch, { responsibleUser = 'Sistema' } = {}) {
  const forbidden = ['current_stock', 'id', 'created_date'];
  const safe = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => !forbidden.includes(k)));
  const updated = await base44.entities.InventoryItem.update(itemId, safe);
  await logAudit({
    entity_type: 'InventoryItem',
    entity_id: itemId,
    action: 'alteracao',
    field: Object.keys(safe).join(','),
    new_value: JSON.stringify(safe).slice(0, 300),
    responsible_user: responsibleUser,
  });
  return updated;
}
