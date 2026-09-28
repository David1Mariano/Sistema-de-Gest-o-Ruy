// ---------------------------------------------------------------------------
// Regras puras de estoque: tipos, direção, sinal, saldo e validações.
// Não importa nada do banco — por isso roda igual no Node (testes) e no
// navegador (app).
// ---------------------------------------------------------------------------
// Import relativo (e não o alias '@/') de propósito: assim este módulo roda
// igual no app (Vite) e no Node (scripts/test-estoque-gastos.mjs).
import { roundMoney, roundQty } from './numberUtils.js';

// Reexportados: quem importa as regras de estoque também precisa arredondar
// quantidade/dinheiro com a MESMA função (evita duas rotinas de arredondamento).
export { roundMoney, roundQty };
export { formatDecimalBR, parseDecimalBR, toNumberBR } from './numberUtils.js';

// Vocabulário de tipos já usado pelo projeto (entrada_compra, saida_perda,
// inventario, entrada_ajuste, saida_ajuste) mais os dois tipos manuais que
// faltavam para o dia a dia. Nenhum enum novo: os valores antigos continuam
// válidos e legíveis.
export const MOVEMENT_TYPES = {
  ENTRADA_MANUAL: 'entrada_manual',
  ENTRADA_COMPRA: 'entrada_compra',
  SAIDA_MANUAL: 'saida_manual',
  PERDA: 'saida_perda',
  AJUSTE: 'inventario',
  AJUSTE_ENTRADA: 'entrada_ajuste',
  AJUSTE_SAIDA: 'saida_ajuste',
  CONSUMO_PRODUCAO: 'consumo_producao',
};

const ENTRADA_TYPES = new Set([
  MOVEMENT_TYPES.ENTRADA_MANUAL,
  MOVEMENT_TYPES.ENTRADA_COMPRA,
  MOVEMENT_TYPES.AJUSTE_ENTRADA,
]);

export const MOVEMENT_LABELS = {
  [MOVEMENT_TYPES.ENTRADA_MANUAL]: 'Entrada manual',
  [MOVEMENT_TYPES.ENTRADA_COMPRA]: 'Entrada por compra',
  [MOVEMENT_TYPES.SAIDA_MANUAL]: 'Saída manual',
  [MOVEMENT_TYPES.PERDA]: 'Perda',
  [MOVEMENT_TYPES.AJUSTE]: 'Ajuste de inventário',
  [MOVEMENT_TYPES.AJUSTE_ENTRADA]: 'Entrada de ajuste',
  [MOVEMENT_TYPES.AJUSTE_SAIDA]: 'Saída de ajuste',
  [MOVEMENT_TYPES.CONSUMO_PRODUCAO]: 'Consumo de produção',
};

export const UNITS = ['un', 'kg', 'g', 'l', 'ml', 'cx', 'pct', 'fardo', 'outro'];

export function stockDirection(movementType) {
  return ENTRADA_TYPES.has(movementType) ? 'entrada' : 'saida';
}

export function movementTypeLabel(type) {
  return MOVEMENT_LABELS[type] || String(type || '').replaceAll('_', ' ');
}

/**
 * Quantidade com sinal de uma movimentação.
 * Registros antigos gravavam a quantidade já com sinal (ex.: -3) e não tinham
 * `direction`; os novos gravam a magnitude e a direção. Esta função enxerga
 * os dois formatos para o histórico nunca "mentir".
 */
export function signedQuantity(movement) {
  const q = roundQty(movement?.quantity) || 0;
  if (movement?.direction) return movement.direction === 'saida' ? -Math.abs(q) : Math.abs(q);
  return q;
}

/** Saldo esperado do item somando todas as suas movimentações. */
export function balanceFromMovements(movements, inventoryItemId) {
  return roundQty(
    (movements || [])
      .filter((m) => m && m.inventory_item_id === inventoryItemId)
      .reduce((sum, m) => sum + signedQuantity(m), 0)
  );
}

export class StockError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StockError';
    this.code = code || 'estoque_invalido';
  }
}

/**
 * Valida a entrada de uma movimentação. Usado tanto pela tela quanto pelo
 * serviço, para o dado inválido nunca chegar ao banco.
 */
export function validateMovement({ item, type, quantity, unit, allowNegative = false }) {
  if (!item || !item.id) throw new StockError('Selecione o item de estoque.', 'item_obrigatorio');
  if (!MOVEMENT_LABELS[type]) throw new StockError('Tipo de movimentação inválido.', 'tipo_invalido');

  // "não informado" precisa ser diferente de "zero": Number(null) é 0 e
  // Number('') é 0, o que esconderia o campo em branco.
  if (quantity === null || quantity === undefined || quantity === '') {
    throw new StockError('Informe a quantidade.', 'quantidade_invalida');
  }
  const qty = roundQty(quantity);
  if (!Number.isFinite(qty)) throw new StockError('Quantidade inválida.', 'quantidade_invalida');
  if (qty <= 0) throw new StockError('A quantidade precisa ser maior que zero.', 'quantidade_nao_positiva');

  const itemUnit = String(item.unit || '').trim();
  const askedUnit = String(unit || itemUnit).trim();
  if (itemUnit && askedUnit && itemUnit !== askedUnit) {
    throw new StockError(
      `Unidade incompatível: o item "${item.name}" é controlado em "${itemUnit}", mas a movimentação está em "${askedUnit}".`,
      'unidade_incompativel'
    );
  }

  if (!allowNegative && stockDirection(type) === 'saida') {
    const current = roundQty(item.current_stock) || 0;
    if (current - qty < 0) {
      throw new StockError(
        `Saldo insuficiente: "${item.name}" tem ${current} ${itemUnit} e a saída é de ${qty} ${itemUnit}.`,
        'saldo_insuficiente'
      );
    }
  }
  return qty;
}

/** Custo médio e último custo após uma entrada com custo. */
export function costsAfter({ item, type, quantity, unitCost }) {
  const currentQty = roundQty(item?.current_stock) || 0;
  const currentAvg = roundMoney(item?.average_cost) || 0;
  const cost = roundMoney(unitCost);
  if (stockDirection(type) !== 'entrada' || !Number.isFinite(cost) || cost <= 0) {
    return { average: currentAvg, last: currentAvg };
  }
  const nextQty = roundQty(currentQty + quantity);
  if (nextQty <= 0) return { average: cost, last: cost };
  return {
    average: roundMoney((currentQty * currentAvg + quantity * cost) / nextQty),
    last: cost,
  };
}

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
