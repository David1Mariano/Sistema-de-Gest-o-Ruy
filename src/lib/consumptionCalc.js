// Cálculo da conferência de consumo de insumos (FASE 2A).
//
// SOMENTE LEITURA/CÁLCULO. Este módulo não persiste nada, não cria
// StockMovement e não altera current_stock nem InventoryItem.
//
// Fonte do cálculo: RecipeIngredient (ficha técnica).
//   quantidade_consumo = quantidade_da_ficha * (quantidade_produzida / yield_quantity)
//
// Estruturas esperadas (nomes de campo já existentes no projeto):
//   ProductionProduct:  { id, name, yield_quantity, yield_unit, status }
//   RecipeIngredient:   { product_id, product_name, inventory_item_id,
//                         inventory_item_name, quantity, unit, unit_cost, total_cost }
//   InventoryItem:      { id, name, unit, current_stock, status }
//   DailyProduction:    { id, product_id, product_name, produced_quantity, date }

export const CONSUMPTION_STATES = {
  OK: 'ok',
  NO_RECIPE: 'no-recipe',
  BAD_YIELD: 'bad-yield',
};

export const STOCK_STATES = {
  AVAILABLE: 'available',
  INSUFFICIENT: 'insufficient',
  MISSING: 'missing',
};

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcula o consumo previsto de insumos para um registro de produção.
 * @returns {state, rows, factor, yieldQuantity, producedQuantity}
 *   state 'ok'        → rows com { ingredient, needed }
 *   state 'no-recipe' → produto sem RecipeIngredient (não bloqueia nada)
 *   state 'bad-yield' → yield_quantity inexistente/zero/inválido
 */
export function computeConsumption({ record, product, ingredients }) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const produced = toNumber(record?.produced_quantity);

  if (!product || list.length === 0) {
    return {
      state: CONSUMPTION_STATES.NO_RECIPE,
      rows: [],
      factor: 0,
      yieldQuantity: 0,
      producedQuantity: produced,
    };
  }

  const yieldQuantity = toNumber(product?.yield_quantity);
  if (!(yieldQuantity > 0)) {
    return {
      state: CONSUMPTION_STATES.BAD_YIELD,
      rows: [],
      factor: 0,
      yieldQuantity,
      producedQuantity: produced,
    };
  }

  const factor = produced / yieldQuantity;
  const rows = list.map((ing) => ({
    ingredient: ing,
    needed: toNumber(ing?.quantity) * factor,
  }));

  return { state: CONSUMPTION_STATES.OK, rows, factor, yieldQuantity, producedQuantity: produced };
}

/**
 * Situação informativa de um ingrediente frente ao estoque atual.
 * Nunca altera nada: apenas classifica para exibição.
 */
export function stockStatus({ needed, inventoryItem }) {
  if (!inventoryItem) return STOCK_STATES.MISSING;
  return toNumber(inventoryItem.current_stock) >= toNumber(needed)
    ? STOCK_STATES.AVAILABLE
    : STOCK_STATES.INSUFFICIENT;
}

export function findInventoryItem(inventoryItems, inventoryItemId) {
  if (!inventoryItemId) return null;
  return (inventoryItems || []).find((item) => item.id === inventoryItemId) || null;
}
