// ===========================================================================
// RESUMO POR CATEGORIA — Financeiro > Gastos > Histórico
// ===========================================================================
//
// Complementa a tela existente: o resumo agrupa a MESMA lista que a tabela do
// histórico já mostra e, ao clicar num card, escreve no filtro de categoria que
// JÁ EXISTE. Nenhuma categoria é hardcoded, nenhuma consulta é criada e a regra
// de cancelados é a do sistema (fora dos totais, visível na lista).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const abs = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ler = (rel) => readFileSync(abs(rel), 'utf8');

const { summarizeByCategory, totalOf, findCategoryIdByKey, categoryKey } =
  await import(new URL('../src/lib/expenseCategories.js', import.meta.url).href);
const { filterExpenses } = await import(new URL('../src/lib/dailyExpenses.js', import.meta.url).href);

// O exemplo do usuário, como dado de teste.
const G = (cat, valor, extra = {}) => ({
  id: `g${cat}${valor}${extra.date || ''}`,
  date: '2026-09-29', category_name: cat, amount: valor, status: 'pago', ...extra,
});
const BASE = [
  G('Troco de motoboy', 380, { id: 'g1' }),
  G('Compras', 1250, { id: 'g2' }),
  G('Manutenção', 220, { id: 'g3' }),
  G('Alimentação', 175, { id: 'g4' }),
];

test('R1. agrupa os gastos por categoria', () => {
  const g = summarizeByCategory(BASE);
  assert.equal(g.length, 4, 'uma linha por categoria');
  assert.deepEqual(g.map((x) => x.nome).sort(), ['Alimentação', 'Compras', 'Manutenção', 'Troco de motoboy']);
});

test('R2. soma corretamente os valores de cada categoria', () => {
  const g = summarizeByCategory([G('Compras', 100, { id: 'a' }), G('Compras', 50, { id: 'b' })]);
  assert.equal(g[0].total, 150);
});

test('R3. total geral bate EXATAMENTE com a soma das categorias', () => {
  const g = summarizeByCategory(BASE);
  const soma = g.reduce((s, x) => s + x.total, 0);
  assert.equal(soma, 2025, '380+1250+220+175');
  assert.equal(totalOf(BASE), soma, 'total do período = soma dos cards');
});

test('R4. categoria criada dinamicamente funciona (sem hardcode)', () => {
  assert.equal(summarizeByCategory([G('Troco de motoboy', 99, { id: 'x' })])[0].nome, 'Troco de motoboy');
  assert.equal(summarizeByCategory([G('Qualquer Coisa Nova', 5, { id: 'y' })])[0].nome, 'Qualquer Coisa Nova');
});

test('R5. categoria sem gastos NÃO aparece; lista vazia não quebra', () => {
  const g = summarizeByCategory([G('Compras', 10, { id: 'a' })]);
  assert.equal(g.length, 1);
  assert.doesNotMatch(JSON.stringify(g), /Manutenção/);
  assert.deepEqual(summarizeByCategory([]), []);
  assert.equal(totalOf([]), 0);
});

test('R6. gasto sem categoria vira "Sem categoria"', () => {
  const g = summarizeByCategory([G('', 30, { id: 'a' }), G('Compras', 10, { id: 'b' })]);
  const sem = g.find((x) => x.nome === 'Sem categoria');
  assert.ok(sem, 'grupo existe');
  assert.equal(sem.total, 30);
  assert.equal(g.length, 2, 'não quebra o histórico');
  const g2 = summarizeByCategory([G('', 10, { id: 'a' }), G('  ', 20, { id: 'b' })]);
  assert.equal(g2.length, 1);
  assert.equal(g2[0].total, 30);
});

test('R7. quantidade de lançamentos por categoria está correta', () => {
  assert.equal(summarizeByCategory(BASE).find((x) => x.nome === 'Troco de motoboy').quantidade, 1);
  const many = summarizeByCategory([1, 2, 3, 4, 5].map((i) => G('Compras', 10, { id: `c${i}` })));
  assert.equal(many[0].quantidade, 5);
});

test('R8. nenhum gasto é contado duas vezes', () => {
  const g = summarizeByCategory(BASE, { incluirGastos: true });
  const ids = g.flatMap((x) => x.gastos).map((x) => x.id);
  assert.equal(ids.length, new Set(ids).size, 'nenhum id repetido entre grupos');
  assert.equal(ids.length, BASE.length, 'todo gasto aparece uma vez');
  assert.equal(g.reduce((s, x) => s + x.quantidade, 0), BASE.length, 'soma das quantidades = lançamentos');
});


test('R9. filtro por dia restringe o resumo ao dia', () => {
  const comOutroDia = [...BASE, G('Compras', 999, { id: 'z', date: '2026-09-30' })];
  const doDia = filterExpenses(comOutroDia, { start: '2026-09-29', end: '2026-09-29' });
  const g = summarizeByCategory(doDia);
  assert.equal(totalOf(doDia), 2025, 'só 29/09');
  assert.equal(g.find((x) => x.nome === 'Compras').total, 1250, 'não puxou o dia seguinte');
});

test('R10. filtro por período (intervalo) funciona', () => {
  const dados = [
    G('A', 10, { id: '1', date: '2026-09-01' }),
    G('B', 20, { id: '2', date: '2026-09-15' }),
    G('C', 30, { id: '3', date: '2026-10-01' }),
  ];
  const setembro = filterExpenses(dados, { start: '2026-09-01', end: '2026-09-30' });
  assert.equal(totalOf(setembro), 30, 'só setembro');
  assert.equal(summarizeByCategory(setembro).length, 2);
});

test('R11. clicar na categoria filtra os registros da lista', () => {
  const comId = BASE.map((g) => ({ ...g, category_id: `c-${g.category_name}` }));
  const filtrado = filterExpenses(comId, { categoryId: 'c-Troco de motoboy' });
  assert.equal(filtrado.length, 1, 'só o da categoria escolhida');
  assert.equal(filtrado[0].category_name, 'Troco de motoboy');
  // Período continua valendo junto com o filtro de categoria.
  const ambos = filterExpenses(comId, { categoryId: 'c-Troco de motoboy', start: '2026-09-29', end: '2026-09-29' });
  assert.equal(ambos.length, 1);
});

test('R12. limpar o filtro de categoria restaura a lista', () => {
  const comId = BASE.map((g) => ({ ...g, category_id: `c-${g.category_name}` }));
  const filtrado = filterExpenses(comId, { categoryId: 'c-Compras' });
  const restaurado = filterExpenses(comId, { categoryId: '' });
  assert.equal(restaurado.length, BASE.length, 'sem filtro volta tudo');
  assert.ok(restaurado.length > filtrado.length);
});

test('R13. ordenação é do maior para o menor valor', () => {
  const g = summarizeByCategory(BASE);
  const totais = g.map((x) => x.total);
  assert.deepEqual(totais, [1250, 380, 220, 175], 'Compras > Troco > Manutenção > Alimentação');
  for (let i = 1; i < totais.length; i++) assert.ok(totais[i - 1] >= totais[i], 'ordem decrescente');
});

test('R14. centavos corretos, sem erro de ponto flutuante', () => {
  const g = summarizeByCategory([0.1, 0.2].map((v, i) => G('Compras', v, { id: `c${i}` })));
  assert.equal(g[0].total, 0.3, '0.1+0.2 = 0.3');
  const t = summarizeByCategory([1.005, 2.005, 3.005].map((v, i) => G('X', v, { id: `x${i}` })));
  assert.equal(t[0].total, 6.02, 'arredonda para centavos');
});

test('R15. valor em string é normalizado, nunca concatenado', () => {
  // Com concatenação, "10" + "20" viraria "1020". Aqui tem de dar 30.
  const g = summarizeByCategory([G('Compras', '10', { id: 's1' }), G('Compras', '20', { id: 's2' })]);
  assert.equal(g[0].total, 30, 'string vira número antes de somar');
});

test('R16. lista vazia e entrada indefinida não quebram', () => {
  assert.deepEqual(summarizeByCategory([]), []);
  assert.equal(totalOf([]), 0);
  assert.deepEqual(summarizeByCategory(undefined), []);
});

test('R17. cancelado segue a regra existente: fora do total, visível na lista', () => {
  const comCancelado = [...BASE, G('Compras', 999, { id: 'canc', status: 'cancelado' })];
  const g = summarizeByCategory(comCancelado);
  assert.equal(g.find((x) => x.nome === 'Compras').total, 1250, 'cancelado não soma');
  assert.equal(totalOf(comCancelado), 2025, 'total ignora cancelado');
  // O histórico continua enxergando o registro cancelado (auditoria).
  const visiveis = filterExpenses(comCancelado, { includeCancelled: true });
  assert.equal(visiveis.length, BASE.length + 1, 'a lista mostra o cancelado');
  assert.ok(visiveis.some((e) => e.status === 'cancelado'));
});

test('R18. busca e os filtros atuais continuam funcionando', () => {
  const busca = filterExpenses(BASE, { search: 'motoboy' });
  assert.equal(busca.length, 1, 'busca por texto segue valendo');
  const resumo = summarizeByCategory(busca);
  assert.equal(resumo.length, 1);
  assert.equal(resumo[0].total, 380);
  const comMetodo = BASE.map((g) => ({ ...g, payment_method: 'pix' }));
  assert.equal(filterExpenses(comMetodo, { paymentMethod: 'pix' }).length, BASE.length);
});

test('R19. escrita diferente da mesma categoria não vira grupo duplicado', () => {
  const g = summarizeByCategory([
    G('Manutenção', 100, { id: 'a' }), G('  manutencao ', 50, { id: 'b' }), G('MANUTENÇÃO', 25, { id: 'c' }),
  ]);
  assert.equal(g.length, 1, 'caixa/espaço/acento não duplicam');
  assert.equal(g[0].total, 175);
  assert.equal(g[0].quantidade, 3);
});

test('R20. nenhuma categoria é hardcoded no código da tela', () => {
  const bruto = ler('src/components/financeiro/CategoryDigest.jsx');
  // Só o código EXECUTÁVEL: o cabeçalho pode citar o exemplo do pedido.
  const codigo = bruto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
  assert.doesNotMatch(codigo, /Troco de motoboy|Compras|Manutenção|Alimentação|Manutencao/, 'nenhuma categoria real no código');
  assert.match(codigo, /summarizeByCategory/, 'usa o agrupamento genérico');
  // "Sem categoria" é rótulo do sistema, não uma categoria cadastrada.
  assert.doesNotMatch(codigo, /SEM_CATEGORIA\s*=\s*'(Troco|Compras|Manutenção|Alimentação)/, 'sem lista fixa de categorias');
});

test('R21. a chave do grupo volta para o category_id persistido', () => {
  const rows = [
    { expense: { category_name: 'Troco de motoboy', category_id: 'c-troco' } },
    { expense: { category_name: 'Compras', category_id: 'c-compras' } },
  ];
  const g = summarizeByCategory([G('Troco de motoboy', 380, { id: 'a', category_id: 'c-troco' })]);
  assert.equal(findCategoryIdByKey(rows, g[0].chave), 'c-troco', 'acha o id real pelo nome');
  assert.equal(findCategoryIdByKey(rows, 'nao-existe'), '');
  assert.equal(findCategoryIdByKey(rows, ''), '');
  assert.equal(categoryKey('Manutenção'), categoryKey('  manutencao '), 'ponte tolera variação de escrita');
});

test('R22. o resumo não cria consulta por categoria (performance)', () => {
  const digest = ler('src/components/financeiro/CategoryDigest.jsx');
  // Nenhuma entity/base44 dentro do resumo: ele só agrupa a lista já carregada.
  assert.doesNotMatch(digest, /base44|entities\.|\.list\(|\.filter\(\{/, 'nenhuma query no resumo');
  assert.equal((digest.match(/summarizeByCategory\(/g) || []).length, 1, 'um agrupamento só');
});

test('R23. o resumo está no Histórico e reaproveita o filtro existente', () => {
  const hist = ler('src/components/financeiro/DailyExpenseHistory.jsx');
  assert.match(hist, /<CategoryDigest/, 'o resumo está no histórico');
  assert.match(hist, /setCategoryId\(findCategoryIdByKey/, 'o clique escreve no filtro real');
  for (const filtro of ['setSearch', 'setBeneficiary', 'setStatus', 'setProof', 'setOrigin', 'setEvent']) {
    assert.ok(hist.includes(filtro), `filtro preservado: ${filtro}`);
  }
  assert.match(hist, /HistoryDetail/, 'detalhe por lançamento preservado');
  // O dia é um filtro de verdade, não um cálculo paralelo.
  assert.match(hist, /dia\s*\?\s*\{\s*start: dia, end: dia \}/, 'dia sobrepõe o período');
});

