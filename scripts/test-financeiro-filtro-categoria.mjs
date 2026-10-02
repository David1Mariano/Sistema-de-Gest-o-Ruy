// Testes do filtro de CATEGORIA em Gastos e no Histórico.
//
// O bug: escolher uma categoria zerava a lista. Os gastos são gravados de duas
// formas ao longo do tempo — os novos levam `category_id`, os antigos só têm
// `category_name`. O filtro comparava só por `category_id`, então todo gasto
// antigo era descartado sem aviso.
//
// Esta suíte trava a REGRA ÚNICA (`combinaCategoria`), os dois filtros que a
// usam, a composição com os outros filtros, e o comportamento de carregamento
// em fases (gastos chegam antes das categorias).
//
// Fixtures sintéticos. Nenhum dado real. Nenhuma escrita.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHistoryRows,
  chaveCategoria,
  combinaCategoria,
  expenseCategoryLabel,
  filterExpenses,
  filterHistoryRows,
  resolverFiltroCategoria,
} from '../src/lib/dailyExpenses.js';

// ---------------------------------------------------------------------------
// Fixture controlada (item 14)
// ---------------------------------------------------------------------------
// Gasto 1 e 4: "Despesa operacional" pelo NOME (registro antigo, sem id).
// Gasto 2: "Diárias de motoboy" pelo ID (registro novo).
// Gasto 3: "Insumos" pelo NOME, com acento e caixa diferente.
// Gasto 5: sem categoria nenhuma.
// Gasto 6: tem id E nome — os dois precisam concordar.
const CATEGORIAS = [
  { id: 'cat-despesa', name: 'Despesa operacional', status: 'ativo' },
  { id: 'cat-diarias', name: 'Diárias de motoboy', status: 'ativo' },
  { id: 'cat-insumos', name: 'Insumos', status: 'ativo' },
  { id: 'cat-antiga', name: 'Categoria desativada', status: 'inativo' },
];

const GASTOS = [
  { id: 'g1', date: '2026-09-21', amount: 100, description: 'A', category_name: 'Despesa operacional' },
  { id: 'g2', date: '2026-09-22', amount: 200, description: 'B', category_id: 'cat-diarias', category_name: 'Diárias de motoboy' },
  { id: 'g3', date: '2026-09-23', amount: 300, description: 'C', category_name: 'Insumos' },
  { id: 'g4', date: '2026-09-24', amount: 400, description: 'D', category_name: 'Despesa Operacional' },
  { id: 'g5', date: '2026-09-25', amount: 500, description: 'E' },
  { id: 'g6', date: '2026-09-26', amount: 600, description: 'F', category_id: 'cat-insumos', category_name: 'Insumos' },
];

const ids = (lista) => lista.map((x) => x.id);

// ===========================================================================
// A REGRA
// ===========================================================================

test('C01 — "Todas" mantém tudo', () => {
  assert.equal(combinaCategoria(GASTOS[0], { id: '', nome: '' }), true);
  assert.equal(combinaCategoria(GASTOS[4], { id: '', nome: '' }), true, 'gasto sem categoria também passa');
  const todos = filterExpenses(GASTOS, { categoryId: '', categoryName: '' });
  assert.equal(todos.length, 6, 'sem filtro de categoria, tudo aparece');
});

test('C02 — categoria A mostra só a categoria A (registros por nome)', () => {
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  assert.equal(f.id, 'cat-despesa');
  assert.equal(f.nome, 'Despesa operacional');
  const r = filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome });
  assert.deepEqual(ids(r), ['g1', 'g4'], 'os dois registros por nome entraram — inclusive o que escreve "Operacional" com caixa diferente');
});

test('C03 — categoria B mostra só a categoria B (registros por id)', () => {
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-diarias');
  const r = filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome });
  assert.deepEqual(ids(r), ['g2'], 'o registro com category_id foi encontrado');
});

test('C04 — trocar A → B atualiza a lista', () => {
  const a = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  const b = resolverFiltroCategoria(CATEGORIAS, 'cat-diarias');
  const ra = filterExpenses(GASTOS, { categoryId: a.id, categoryName: a.nome });
  const rb = filterExpenses(GASTOS, { categoryId: b.id, categoryName: b.nome });
  assert.equal(ra.length, 2);
  assert.equal(rb.length, 1);
  assert.equal(ra.some((x) => rb.some((y) => y.id === x.id)), false, 'as duas listas não se misturam');
});

test('C05 — categoria sem registros devolve lista vazia (estado vazio real)', () => {
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-antiga');
  assert.equal(f.nome, 'Categoria desativada', 'categoria desativada continua oferecida no filtro');
  const r = filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome });
  assert.deepEqual(r, [], 'nenhum gasto pertence a ela — e isso é um resultado, não um erro');
});

test('C06 — "Sem categoria" é um grupo real, não "Todas"', () => {
  // O card do resumo mostra "Sem categoria". Sem id, e sem isso ele cairia em
  // "Todas" e mostraria tudo.
  const f = resolverFiltroCategoria(CATEGORIAS, '', 'sem categoria');
  assert.equal(f.id, '');
  assert.equal(f.nome, 'sem categoria');
  const r = filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome });
  assert.deepEqual(ids(r), ['g5'], 'só o gasto sem categoria bate');
});

// ===========================================================================
// COMPARAÇÃO: id manda, nome é o plano B
// ===========================================================================

test('C07 — quando o gasto TEM category_id, ele manda sobre o nome', () => {
  const inconsistente = { id: 'x', category_id: 'cat-diarias', category_name: 'Despesa operacional' };
  assert.equal(combinaCategoria(inconsistente, { id: 'cat-diarias', nome: 'Diárias de motoboy' }), true, 'pelo id, entra');
  assert.equal(combinaCategoria(inconsistente, { id: 'cat-despesa', nome: 'Despesa operacional' }), false, 'pelo nome NÃO entra: com id, o id é a verdade');
});

test('C08 — nome normalizado: acento, caixa e espaço não importam', () => {
  assert.equal(chaveCategoria('Diárias de Motoboy'), 'diarias de motoboy');
  assert.equal(chaveCategoria('  INSUMOS  '), 'insumos');
  const comAcento = [{ id: 'g', category_name: 'Diárias de Motoboy' }];
  const f = resolverFiltroCategoria([{ id: 'c', name: 'Diárias de motoboy' }], 'c');
  assert.equal(filterExpenses(comAcento, { categoryId: f.id, categoryName: f.nome }).length, 1, 'acento e caixa não quebram a comparação');
});

// ===========================================================================
// HISTÓRICO — o mesmo bug, o mesmo conserto
// ===========================================================================

test('C09 — o Histórico usa a MESMA regra e não zera mais', () => {
  const rows = buildHistoryRows(GASTOS, []);
  // Este é o caminho real: a tela resolve {id, nome} e passa os dois.
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');

  const todas = filterHistoryRows(rows, { categoryId: '', categoryName: '' });
  assert.equal(todas.length, 6, '"Todas as categorias" mostra tudo');

  const filtrada = filterHistoryRows(rows, { categoryId: f.id, categoryName: f.nome });
  assert.deepEqual(filtrada.map((r) => r.expense.id), ['g1', 'g4'], 'escolher uma categoria mostra os registros antigos também');

  // E o comportamento ANTES do conserto, registrado como prova do bug: passando
  // só o id (que é o que a tela fazia), os registros antigos desapareciam.
  const soComId = filterHistoryRows(rows, { categoryId: f.id });
  assert.deepEqual(soComId.map((r) => r.expense.id), [], 'com id e sem nome, os registros antigos somem — era exatamente o bug');
});

test('C10 — trocar categoria no Histórico atualiza na hora (sem F5)', () => {
  const rows = buildHistoryRows(GASTOS, []);
  const a = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  const b = resolverFiltroCategoria(CATEGORIAS, 'cat-insumos');
  assert.deepEqual(filterHistoryRows(rows, { categoryId: a.id, categoryName: a.nome }).map((r) => r.expense.id), ['g1', 'g4']);
  assert.deepEqual(filterHistoryRows(rows, { categoryId: b.id, categoryName: b.nome }).map((r) => r.expense.id), ['g3', 'g6'], 'Insumos: um por nome e um por id');
});

// ===========================================================================
// COMPOSIÇÃO — os outros filtros continuam existindo
// ===========================================================================

test('C11 — categoria + período', () => {
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  const r = filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome, start: '2026-09-22', end: '2026-09-24' });
  assert.deepEqual(ids(r), ['g4'], 'categoria E período, juntos');
  const semPeriodo = filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome });
  assert.equal(semPeriodo.length, 2, 'sem o período, volta a ser 2');
});

test('C12 — categoria + busca textual (composição por E)', () => {
  const fDespesa = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  const fInsumos = resolverFiltroCategoria(CATEGORIAS, 'cat-insumos');

  // 'f' só aparece na descrição do g6: nenhum outro texto do fixture o contém.
  assert.equal(filterExpenses(GASTOS, { search: 'f' }).length, 1, 'a busca acha g6');
  assert.equal(filterExpenses(GASTOS, { search: 'f', categoryId: fDespesa.id, categoryName: fDespesa.nome }).length, 0, 'a categoria barra o achado');
  assert.equal(filterExpenses(GASTOS, { search: 'f', categoryId: fInsumos.id, categoryName: fInsumos.nome }).length, 1, 'com a categoria certa, entra');

  assert.equal(filterExpenses(GASTOS, { search: 'inexistente' }).length, 0);
  assert.equal(filterExpenses(GASTOS, { search: 'inexistente', categoryId: fDespesa.id, categoryName: fDespesa.nome }).length, 0);
});

test('C13 — categoria + status e categoria + cancelado', () => {
  const comStatus = [
    { id: 's1', category_id: 'cat-despesa', status: 'pago' },
    { id: 's2', category_id: 'cat-despesa', status: 'pendente' },
  ];
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  assert.deepEqual(ids(filterExpenses(comStatus, { categoryId: f.id, categoryName: f.nome, status: 'pago' })), ['s1']);
  // Cancelados ficam de fora do painel e entram no histórico — como sempre.
  const comCancelado = [{ id: 'c1', category_id: 'cat-despesa', status: 'cancelado' }];
  assert.equal(filterExpenses(comCancelado, { categoryId: f.id, categoryName: f.nome }).length, 0, 'cancelado fora do painel');
  assert.equal(filterExpenses(comCancelado, { categoryId: f.id, categoryName: f.nome, includeCancelled: true }).length, 1, 'cancelado dentro do histórico');
});

test('C14 — busca por nome de categoria ainda acha o gasto', () => {
  // `expenseSearchIndex` inclui category_name; o filtro por categoria não pode
  // ter quebrado isso.
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-insumos');
  const porBusca = filterExpenses(GASTOS, { search: 'insumos' });
  assert.deepEqual(ids(porBusca).sort(), ['g3', 'g6']);
  assert.deepEqual(ids(filterExpenses(GASTOS, { search: 'insumos', categoryId: f.id, categoryName: f.nome })).sort(), ['g3', 'g6']);
});

test('C15 — rótulo da categoria continua funcionando', () => {
  assert.equal(expenseCategoryLabel(GASTOS[1]), 'Diárias de motoboy', 'usa o nome');
  assert.equal(expenseCategoryLabel(GASTOS[0]), 'Despesa operacional');
  assert.equal(expenseCategoryLabel(GASTOS[4]), 'Sem categoria', 'gasto sem categoria mostra o rótulo padrão');
});

// ===========================================================================
// CARREGAMENTO EM FASES
// ===========================================================================

test('C16 — gastos chegam antes das categorias e o filtro recalcula', () => {
  // Fase 0: só expenses. Escolher uma categoria agora não deve quebrar.
  const fSemCategorias = resolverFiltroCategoria([], 'cat-despesa');
  assert.equal(fSemCategorias.nome, '', 'sem a lista de categorias, ainda não há nome');
  assert.equal(filterExpenses(GASTOS, { categoryId: fSemCategorias.id, categoryName: fSemCategorias.nome }).length, 0, 'e a lista fica vazia, sem quebrar');

  // Fase 1: as categorias chegam; agora o nome resolve.
  const fComCategorias = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  assert.equal(filterExpenses(GASTOS, { categoryId: fComCategorias.id, categoryName: fComCategorias.nome }).length, 2, 'a lista passa a encontrar os registros');
});

test('C17 — categoria escolhida antes de as categorias carregarem é preservada', () => {
  // O id escolhido não depende da lista de categorias: ele já está no estado.
  const escolhida = 'cat-despesa';
  const antes = resolverFiltroCategoria([], escolhida);
  const depois = resolverFiltroCategoria(CATEGORIAS, escolhida);
  assert.equal(antes.id, escolhida);
  assert.equal(depois.id, escolhida, 'o id continua o mesmo quando as categorias chegam');
  assert.equal(depois.nome, 'Despesa operacional', 'e o nome é resolvido depois');
});

test('C18 — resolverFiltroCategoria com id desconhecido não quebra', () => {
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-que-nao-existe');
  assert.equal(f.id, 'cat-que-nao-existe');
  assert.equal(f.nome, '', 'nome vazio — e a regra ainda casa gastos que tenham esse id');
  const comEsseId = [{ id: 'z', category_id: 'cat-que-nao-existe' }];
  assert.equal(filterExpenses(comEsseId, { categoryId: f.id, categoryName: f.nome }).length, 1, 'o id sozinho basta quando o gasto tem id');
});

test('C19 — a regra é uma só, usada nos dois filtros', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/lib/dailyExpenses.js', import.meta.url), 'utf8');
  // Nenhum filtro volta a comparar category_id direto.
  assert.doesNotMatch(src, /categoryId && expense\.category_id !== categoryId/, 'a comparação crua de id saiu dos filtros');
  // Só as CHAMADAS, não os comentários que citam o nome da regra.
  const chamadas = (src.match(/if \(!combinaCategoria\(expense/g) || []).length;
  assert.equal(chamadas, 2, 'os dois filtros (painel e histórico) usam a regra central');
});

// ===========================================================================
// NADA QUEBRADO
// ===========================================================================

test('C20 — filtro de categoria vazio mantém o comportamento antigo em todo mundo', () => {
  // Quem chama sem categoryName continua funcionando: a regra com id vazio e
  // nome vazio mantém tudo, exatamente como antes.
  assert.equal(filterExpenses(GASTOS, {}).length, 6);
  assert.equal(filterExpenses(GASTOS, { categoryId: '' }).length, 6);
  assert.equal(buildHistoryRows(GASTOS, []).length, 6);
});

test('C21 — nenhum dado é alterado: os fixtures são imutáveis', () => {
  const antes = JSON.stringify(GASTOS);
  const f = resolverFiltroCategoria(CATEGORIAS, 'cat-despesa');
  filterExpenses(GASTOS, { categoryId: f.id, categoryName: f.nome });
  filterHistoryRows(buildHistoryRows(GASTOS, []), { categoryId: f.id, categoryName: f.nome });
  resolverFiltroCategoria(CATEGORIAS, 'cat-diarias');
  assert.equal(JSON.stringify(GASTOS), antes, 'filtrar não muta os gastos');
});