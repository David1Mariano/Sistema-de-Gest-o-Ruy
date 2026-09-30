// Carregamento do Financeiro: o que roda, como uma entity que falha NÃO
// derruba as outras, e como a tela diz a VERDADE quando não conseguiu ler.
//
// Este módulo é puro e sem alias para poder ser testado por `node --test`.
// Ele não sabe falar com o banco: recebe as entidades prontas.

/**
 * As 15 fontes do Financeiro, na ordem e com os mesmos limites usados pela
 * tela. `alias` é o nome que a tela usa; `entity` é a entity real consultada.
 * Manter os dois aqui evita a divergência "o card diz expenses mas o banco
 * não tem DailyExpense" que existia antes.
 */
export const FONTE_FINANCEIRO = Object.freeze([
  { alias: 'expenses', entity: 'FinancialExpense', sort: '-date', limit: 1000 },
  { alias: 'payments', entity: 'EmployeePayment', sort: '-payment_date', limit: 1000 },
  { alias: 'employees', entity: 'Employee', sort: 'name', limit: 500 },
  { alias: 'vales', entity: 'Vale', sort: '-date', limit: 1000 },
  { alias: 'consumptions', entity: 'Consumption', sort: '-date', limit: 1000 },
  { alias: 'categories', entity: 'ExpenseCategory', sort: 'name', limit: 300 },
  { alias: 'centers', entity: 'CostCenter', sort: 'name', limit: 300 },
  { alias: 'payables', entity: 'AccountsPayable', sort: 'due_date', limit: 1000 },
  { alias: 'accounts', entity: 'FinancialAccount', sort: 'name', limit: 200 },
  { alias: 'recurrings', entity: 'RecurringExpense', sort: 'next_due_date', limit: 300 },
  { alias: 'closes', entity: 'DailyFinancialClose', sort: '-date', limit: 300 },
  { alias: 'fechamentosCaixa', entity: 'FechamentoCaixa', sort: '-date', limit: 1000 },
  { alias: 'sangrias', entity: 'Sangria', sort: '-date', limit: 1000 },
  { alias: 'cashMovements', entity: 'CashMovement', sort: '-date', limit: 1500 },
  { alias: 'suppliers', entity: 'Supplier', sort: 'name', limit: 500 },
]);

// Uma entity que falha NÃO pode derrubar as outras. É o que permite que uma
// falha de sessão, que atinge todas, ainda assim ser vista como "uma causa"
// em vez de "quinze entidades quebradas".
const isolar = async (promessa) => {
  try {
    return { ok: true, valor: await promessa };
  } catch (erro) {
    return {
      ok: false,
      status: erro?.status ?? null,
      mensagem: erro?.message ?? String(erro),
    };
  }
};

/**
 * Executa as fontes em paralelo, isolando cada uma.
 * @param {Array<{alias:string, entidade:object, sort:string, limit:number}>} fontes
 * @returns {Promise<{valores:object, falhas:Array<{alias:string,entity:string,status:?number,mensagem:string}>}>}
 */
export async function executarFontes(fontes) {
  const resultados = await Promise.all(
    fontes.map(async (fonte) => {
      const r = await isolar(fonte.entidade.list(fonte.sort, fonte.limit));
      return { alias: fonte.alias, entity: fonte.entity, ...r };
    }),
  );
  const valores = {};
  const falhas = [];
  for (const r of resultados) {
    if (r.ok) valores[r.alias] = r.valor;
    else falhas.push({ alias: r.alias, entity: r.entity, status: r.status, mensagem: r.mensagem });
  }
  return { valores, falhas };
}

/**
 * Monta os valores para aplicar na tela.
 * Uma collection que falhou NÃO é sobrescrita por `undefined`/`[]`: o último
 * valor bom é mantido. Sem isso, uma falha de sessão trocava 23 gastos reais
 * por uma lista vazia.
 */
export function mesclarPreservando(valores, anterior) {
  const anteriorSeguro = anterior && typeof anterior === 'object' ? anterior : {};
  const out = {};
  for (const fonte of FONTE_FINANCEIRO) {
    const temNovo = Object.prototype.hasOwnProperty.call(valores, fonte.alias);
    out[fonte.alias] = temNovo ? valores[fonte.alias] : (anteriorSeguro[fonte.alias] ?? []);
  }
  return out;
}

/** A falha é de sessão/autorização (e não de dados)? */
export const ehFalhaDeSessao = (falhas) => (
  Array.isArray(falhas)
  && falhas.length > 0
  && falhas.every((f) => f.status === 401 || /sess[aã]o|unauthorized|jwt|token/i.test(f.mensagem || ''))
);

/** Quantas entities caíram por uma MESMA causa (mensagem idêntica). */
export function agruparPorCausa(falhas) {
  const grupos = new Map();
  for (const f of falhas) {
    const chave = `${f.status ?? 'sem-status'} ${f.mensagem}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(f.alias);
  }
  return [...grupos.entries()].map(([causa, aliases]) => ({ causa, aliases }));
}

/**
 * A mensagem que a tela mostra.
 *
 * Antes: "Não foi possível atualizar: expenses, payments, ..." — quinze nomes
 * e nenhuma informação útil. Quem via isso não sabia se era rede, permissão
 * ou sessão, e ainda podia achar que era quinze defeitos independentes.
 *
 * Agora: a causa real (status + mensagem) vem primeiro, as entities ficam
 * agrupadas por causa, e a tela diz explicitamente se os números na tela são
 * do último carregamento bom ou se nunca houve nenhum.
 */
export function resumirFalhas(falhas, { carregouAntes = true } = {}) {
  if (!Array.isArray(falhas) || !falhas.length) return '';
  const grupos = agruparPorCausa(falhas);
  const partes = grupos.map(({ causa, aliases }) => {
    const [status, ...resto] = causa.split(' ');
    const msg = resto.join(' ');
    const lista = aliases.length > 4 ? `${aliases.length} telas (${aliases.slice(0, 3).join(', ')}…)` : aliases.join(', ');
    return `[${status}] ${msg} — afetou: ${lista}`;
  });
  const rodape = carregouAntes
    ? ' Exibindo os últimos dados carregados.'
    : ' Nenhum dado foi carregado até agora; os valores abaixo não são confiáveis.';
  return `Não foi possível atualizar o Financeiro. ${partes.join(' | ')}${rodape}`;
}

/** Uma entity falhou = os números dela não devem aparecer como verdade. */
export function aliasesInvalidos(falhas) {
  return new Set((falhas || []).map((f) => f.alias));
}
