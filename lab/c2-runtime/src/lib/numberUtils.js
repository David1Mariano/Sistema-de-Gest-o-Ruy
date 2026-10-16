// Utilitários numéricos compartilhados entre Estoque, Financeiro e Compras.
//
// Regra do projeto: na TELA o valor é pt-BR com vírgula ("25,50"); no
// ESTADO e no BANCO é número. Nenhum cálculo monetário é feito com string
// formatada.

/** Arredonda quantidade sem arrastar erro de ponto flutuante (0.1 + 0.2). */
export function roundQty(value) {
  const n = toNumberBR(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1e6) / 1e6;
}

/** Arredonda dinheiro para centavos. */
export function roundMoney(value) {
  const n = toNumberBR(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100) / 100;
}

/**
 * Converte texto digitado em número, aceitando a vírgula decimal brasileira.
 *
 * Regra (determinística e documentada):
 *   - COM vírgula → a vírgula é o decimal e o ponto é separador de milhar:
 *     "25,50" -> 25.5   ·   "1.234,50" -> 1234.5
 *   - SEM vírgula → o ponto é decimal (é o que o navegador entrega):
 *     "25.50" -> 25.5   ·   "1.500" -> 1.5
 *   - "" / "-" / texto -> '' (vazio, nunca 0 e nunca NaN), para o formulário
 *     saber que o campo não foi preenchido.
 */
export function parseDecimalBR(raw) {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : '';
  let s = String(raw).trim();
  if (s === '') return '';
  s = s.replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return '';
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1) {
    // vírgula presente: pontos anteriores viram milhar.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1 && s.indexOf('.') !== lastDot) {
    // sem vírgula e com mais de um ponto: pontos são milhar ("1.500.250").
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : '';
}

/** Coage para número aceitando texto pt-BR; devolve NaN se não for número. */
export function toNumberBR(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const parsed = parseDecimalBR(value);
  return parsed === '' ? NaN : parsed;
}

/** Formata número no padrão pt-BR para exibição em campo de texto. */
export function formatDecimalBR(value, fractionDigits = 3) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}
