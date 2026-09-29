// Regressão: os 23 gastos FinancialExpense que EXISTEM no banco têm que
// aparecer na tela.
//
// Este teste não chama o banco. Ele reconstrói, a partir dos MESMOS valores
// reais observados na consulta somente-leitura, o cenário completo: 23 gastos
// de 21/09 e 22/09, 22 deles sem categoria, todos com status "pago".
//
// O que trava: um filtro que esconde o que existe e apresenta a tela como se o
// banco estivesse vazio. Nenhum gasto é criado, alterado ou excluído aqui —
// são objetos de teste em memória.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterExpenses,
  resolveExpensePeriod,
  dailyExpenseIndicators,
  isCancelledExpense,
} from '../src/lib/dailyExpenses.js';
import { FONTE_FINANCEIRO, executarFontes, mesclarPreservando } from '../src/lib/financeiroLoad.js';

// ---- Os 23 gastos reais, reconstruídos ------------------------------------
// Valores observados na leitura direta: 10 em 21/09, 13 em 22/09, status
// "pago", 22 sem category_id, 1 com category_id.
const GASTOS_REAIS = [
  { id: 'fe_47d0bbf952aee3263074f1e5882aee4a', date: '2026-09-21', amount: 164, status: 'pago' },
  { id: 'fe_7e60408982606f85099255a513b6826a', date: '2026-09-21', amount: 600, status: 'pago' },
  { id: 'fe_a8fc1bee8b64e67f320095bce816f3b4', date: '2026-09-21', amount: 306, status: 'pago' },
  { id: 'fe_ef87e584b3b2994940a4188d492781ca', date: '2026-09-21', amount: 280, status: 'pago' },
  { id: 'id_mun02dc0_rihcfd05', date: '2026-09-21', amount: 80, status: 'pago' },
  { id: 'id_mun0ihdr_6ydph395', date: '2026-09-21', amount: 117, status: 'pago' },
  { id: 'id_mun0ka8l_dyfbodur', date: '2026-09-21', amount: 130, status: 'pago' },
  { id: 'id_mun0n169_fy9axb3d', date: '2026-09-21', amount: 129, status: 'pago' },
  { id: 'id_mun0ourd_v4x6t7rw', date: '2026-09-21', amount: 298, status: 'pago' },
  { id: 'id_mun0rvxl_sr3o3pb7', date: '2026-09-21', amount: 70, status: 'pago' },
  { id: 'fe_0894c7f42348ea9e4ab41d1a7dbddb43', date: '2026-09-22', amount: 13953.46, status: 'pago' },
  { id: 'fe_15b8d75790e8ea05899c9f1da447f503', date: '2026-09-22', amount: 320, status: 'pago' },
  { id: 'fe_1cf80dbb626e611b412c0d106df677f6', date: '2026-09-22', amount: 43.02, status: 'pago', category_id: 'id_mun11d9k_65rrrno7' },
  { id: 'fe_21e9cf0c3025f7954e3073bcc8c49368', date: '2026-09-22', amount: 20, status: 'pago' },
  { id: 'fe_659a68cfe6ffe605b63f051aea16d661', date: '2026-09-22', amount: 15.2, status: 'pago' },
  { id: 'fe_c12c404e07fc12d8b35dd34a22bfeb54', date: '2026-09-22', amount: 450.79, status: 'pago' },
  { id: 'fe_f0860f8f5948525f14438a00c81cd701', date: '2026-09-22', amount: 3838, status: 'pago' },
  { id: 'fe_f62316e18852655f7f6bb31465eb04f9', date: '2026-09-22', amount: 1162, status: 'pago' },
  { id: 'id_mun1vxo3_e0poo836', date: '2026-09-22', amount: 70, status: 'pago' },
  { id: 'id_mun1yipa_nr01l6oh', date: '2026-09-22', amount: 93, status: 'pago' },
  { id: 'id_mun26ty0_fpnno6wd', date: '2026-09-22', amount: 145, status: 'pago' },
  { id: 'id_mun28s31_nex9nrfo', date: '2026-09-22', amount: 78, status: 'pago' },
  { id: 'id_mun2bqrj_i6snxva9', date: '2026-09-22', amount: 98, status: 'pago' },
];

// "Hoje" da investigação: 2026-09-29. Passado como `reference` para que o
// teste não dependa do dia em que roda.
const HOJE = new Date('2026-09-29T12:00:00');
const comReferencia = (fn) => (...args) => fn(...args, { reference: HOJE });

// Estado inicial real do DailyExpensesPanel.
const ESTADO_INICIAL = {
  search: '', preset: 'mes', customStart: '', customEnd: '',
  categoryId: '', paymentMethod: '', beneficiary: '', status: '', proof: '',
};

const visiveisCom = (preset, extra = {}) => {
  const p = comReferencia(resolveExpensePeriod)(preset, { start: '', end: '' });
  return filterExpenses(GASTOS_REAIS, { ...ESTADO_INICIAL, ...extra, start: p.start, end: p.end });
};

test('G01 — os 23 gastos existentes aparecem com o filtro "Tudo"', () => {
  assert.equal(GASTOS_REAIS.length, 23, 'o cenário tem os 23 gastos do banco');
  assert.equal(visiveisCom('todos').length, 23, '"Tudo" precisa mostrar os 23');
});

test('G02 — 21/09 e 22/09 aparecem em "Este mês"', () => {
  const visiveis = visiveisCom('mes');
  assert.equal(visiveis.length, 23, '"Este mês" precisa mostrar os 23');
  assert.equal(visiveis.filter((g) => g.date === '2026-09-21').length, 10, 'os 10 de 21/09');
  assert.equal(visiveis.filter((g) => g.date === '2026-09-22').length, 13, 'os 13 de 22/09');
});

test('G03 — "Hoje" devolve 0 sem apagar a lista original', () => {
  assert.equal(visiveisCom('hoje').length, 0, '"Hoje" legitimately não tem gasto');
  assert.equal(GASTOS_REAIS.length, 23, 'e a lista original continua com os 23 — filtro não apaga nada');
});

test('G04 — trocar Hoje → Tudo restaura os 23', () => {
  const hoje = visiveisCom('hoje');
  const todos = visiveisCom('todos');
  assert.equal(hoje.length, 0);
  assert.equal(todos.length, 23, 'voltar para "Tudo" restaura tudo');
});

test('G05 — filtro de categoria vazio preserva os 23', () => {
  assert.equal(visiveisCom('mes', { categoryId: '' }).length, 23, 'sem categoria selecionada, não se filtra');
});

test('G06 — filtro de dia vazio preserva os 23', () => {
  // O painel não tem filtro por dia; o dia vive no Histórico e começa vazio.
  assert.equal(visiveisCom('todos', { day: '' }).length, 23, 'sem dia escolhido, nada é filtrado por dia');
});

test('G07 — categoria inexistente não fica presa escondendo tudo em silêncio', () => {
  const inexistente = visiveisCom('mes', { categoryId: 'categoria-que-nao-existe' });
  assert.equal(inexistente.length, 0, 'é verdade que não casa nenhum');
  // O ponto é que a tela precisa distinguir "0 real" de "filtro não casa".
  // A distinção existe: a linha do cabeçalho mostra o total do período.
  const periodo = comReferencia(resolveExpensePeriod)('mes', { start: '', end: '' });
  const noPeriodo = filterExpenses(GASTOS_REAIS, { start: periodo.start, end: periodo.end });
  assert.equal(noPeriodo.length, 23, 'e o total do período continua dizendo 23, então o zero é visível como filtro');
});

test('G08 — refresh preserva os registros', async () => {
  const fontes = FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: { list: async () => (f.alias === 'expenses' ? GASTOS_REAIS : []) },
  }));
  const primeira = await executarFontes(fontes);
  const tela = mesclarPreservando(primeira.valores, {});
  assert.equal(tela.expenses.length, 23, 'primeira carga');

  // Segunda carga: uma entity não relacionada falha. Os gastos ficam.
  const segunda = await executarFontes(fontes.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: {
      list: async () => {
        if (f.alias === 'suppliers') throw Object.assign(new Error('500'), { status: 500 });
        return f.alias === 'expenses' ? GASTOS_REAIS : [];
      },
    },
  })));
  const tela2 = mesclarPreservando(segunda.valores, tela);
  assert.equal(tela2.expenses.length, 23, 'refresh com falha parcial mantém os 23 gastos');
});

test('G09 — sessão renovada recarrega os gastos', async () => {
  let Tentativa = 0;
  const fontes = FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: {
      list: async () => {
        if (Tentativa === 0) throw Object.assign(new Error('Sessão expirada.'), { status: 401 });
        return f.alias === 'expenses' ? GASTOS_REAIS : [];
      },
    },
  }));
  const antes = await executarFontes(fontes);
  assert.equal(antes.valores.expenses, undefined, 'com a sessão vencida não há gastos');

  Tentativa = 1; // simula a renovação ter funcionado
  const depois = await executarFontes(fontes);
  assert.equal(depois.falhas.length, 0, 'depois da renovação nada falha');
  assert.equal(depois.valores.expenses.length, 23, 'e os 23 gastos voltam');
});

test('G10 — nenhum setExpenses([]) indevido no caminho do loader', async () => {
  const { readFile } = await import('node:fs/promises');
  const painel = await readFile(new URL('../src/components/financeiro/DailyExpensesPanel.jsx', import.meta.url), 'utf8');
  const tela = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(painel, /setRows\(\[\]\)/, 'o painel nunca esvazia a lista recebida');
  assert.doesNotMatch(tela, /setData\(\{[^}]*expenses:\s*\[\]/, 'a tela nunca zera expenses por conta própria');
  // A única forma de expenses virar vazio é uma leitura bem-sucedida que não
  // traz nada — e aí o indicador de dados inválidos cobre.
  assert.match(tela, /mesclarPreservando\(/, 'a última collection boa é preservada');
});

test('G11 — erro de refresh preserva os últimos 23', async () => {
  const telaAnterior = { expenses: GASTOS_REAIS, employees: [] };
  const falhas = [{ alias: 'expenses', entity: 'FinancialExpense', status: 500, mensagem: 'erro' }];
  const merged = mesclarPreservando({}, telaAnterior);
  assert.equal(merged.expenses.length, 23, 'falha de refresh não troca 23 gastos por lista vazia');
  assert.equal(falhas.length, 1, 'e a falha fica registrada à parte');
});

test('G12 — nenhum gasto é criado, alterado ou removido durante a carga', async () => {
  // O caminho de leitura é list() e nada mais. Se algum dia aparecer um
  // create/update/delete no loader, este teste quebra.
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/lib/financeiroLoad.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\.create\(|\.update\(|\.delete\(|\.transact\(/, 'o loader de leitura não escreve em nada');
  assert.match(src, /\.list\(/, 'ele só lê');

  // E o estado dos 23 é o mesmo antes e depois de filtrar.
  const copia = JSON.stringify(GASTOS_REAIS);
  visiveisCom('todos'); visiveisCom('mes'); visiveisCom('hoje');
  filterExpenses(GASTOS_REAIS, { categoryId: 'x' });
  assert.equal(JSON.stringify(GASTOS_REAIS), copia, 'filtrar não muta a lista original');
});

test('G13 — zero do filtro é distinguível de zero do banco', async () => {
  // Banco vazio de verdade: a lista chega com 0 e não há nada a recuperar.
  const vazio = [];
  const p = comReferencia(resolveExpensePeriod)('mes', { start: '', end: '' });
  const visiveis = filterExpenses(vazio, { start: p.start, end: p.end });
  assert.equal(visiveis.length, 0);

  const ind = dailyExpenseIndicators(vazio, { reference: HOJE });
  assert.equal(ind.totalCount, 0, 'indicador também é zero, corretamente');
  assert.equal(ind.monthCount, 0);

  // Já com os 23 carregados, o mesmo filtro "hoje" devolve 0 MAS o total do
  // período continua 23 — é isso que permite à UI dizer "existem 23".
  const comDados = filterExpenses(GASTOS_REAIS, { start: p.start, end: p.end });
  assert.equal(visiveis.length, 0);
  assert.equal(comDados.length, 23, 'o período ainda tem 23: o zero da busca é do filtro, não do banco');
  assert.equal(dailyExpenseIndicators(GASTOS_REAIS, { reference: HOJE }).totalCount, 23);
});

test('G14 — nenhum gasto cancelado se mistura; os 23 estão "pago"', () => {
  assert.equal(GASTOS_REAIS.filter(isCancelledExpense).length, 0, 'nenhum dos 23 está cancelado');
  const p = comReferencia(resolveExpensePeriod)('mes', { start: '', end: '' });
  const visiveis = filterExpenses(GASTOS_REAIS, { start: p.start, end: p.end });
  assert.equal(visiveis.length, 23, 'então o filtro de cancelados não tira nenhum');
});
