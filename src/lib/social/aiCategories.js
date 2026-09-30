// Allowlist ÚNICA de categorias da IA. Fonte da verdade compartilhada: o backend
// (`server/social/ai.mjs`) e a UI (`CommentPanel`) importam daqui, para não
// existirem duas listas divergentes.
//
// O modelo pode inventar string livre. A CENTRAL decide o que existe: categoria
// fora da lista é normalizada para `outro` e marcada como não reconhecida.
export const SOCIAL_AI_CATEGORIES = Object.freeze([
  'elogio', 'duvida', 'preco', 'horario', 'delivery', 'produto',
  'reclamacao', 'problema_pedido', 'disponibilidade', 'outro',
]);

// Compara sem acento, caixa e separador: 'Dúvida', 'DUVIDA' e 'duvida' caem
// na mesma chave, para o erro de digitação do modelo não virar categoria nova.
const CATEGORY_KEY = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[\s-]+/g, '_');

const CATEGORY_INDEX = new Map(SOCIAL_AI_CATEGORIES.map((c) => [CATEGORY_KEY(c), c]));

/**
 * Normaliza a categoria do modelo contra a allowlist.
 * @returns {{category: string, recognized: boolean}}
 */
export function normalizeCategory(value, fallback = 'outro') {
  const hit = CATEGORY_INDEX.get(CATEGORY_KEY(value));
  if (hit) return { category: hit, recognized: true };
  return { category: CATEGORY_INDEX.has(CATEGORY_KEY(fallback)) ? CATEGORY_KEY(fallback) : 'outro', recognized: false };
}
