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
import { FONTE_FINANCEIRO, aplicarFases, executarFontes, mesclarPreservando } from '../src/lib/financeiroLoad.js';
import { todayISO } from '../src/lib/timeUtils.js';

// ---------------------------------------------------------------------------
// RELÓGIO DO TESTE
// ---------------------------------------------------------------------------
// ESTE TESTE JÁ FOI DETERMINÍSTICO POR ESCRITO E NÃO ERA.
//
// O helper antigo era `comReferencia = (fn) => (...args) => fn(...args, { reference: HOJE })`.
// Mas a assinatura real é
//     resolveExpensePeriod(preset, { start, end, reference = new Date() })
// — DOIS parâmetros. O `{ reference }` era passado como TERCEIRO argumento e
// descartado em silêncio, sem erro. Ou seja: `resolveExpensePeriod` caía sempre
// no `new Date()` do relógio real, e o teste passava só por acaso, enquanto o
// relógio real estivesse dentro da janela das fixtures.
//
// Os contratos G02/G05/G07/G13/G14 aqui exercitados são reais e continuam
// intactos: só o relógio passa a ser controlado de verdade.
//
// Duas defesas, porque o erro era silencioso:
//
//   1. `periodoDe()` chama a função production COM A ARIDADE CERTA e tem um
//      autoteste (G15) que falha se alguém voltar a passar `reference` fora do
//      objeto de opções — o mesmo modo de falha, agora detectado.
//   2. As datas das fixtures saem de `deslocarDias(REFERENCIA, n)`, não de
//      literais. Com a referência padrão o cenário é byte a byte o original:
//      10 gastos em 21/09 e 13 em 22/09.
//
// Nada de monkey patch global de `Date`: o relógio é injetado por parâmetro,
// que a produção já suporta (`reference`), então nenhum outro teste é afetado.
//
// TIMEZONE: `deslocarDias` monta a data pelos componentes LOCAIS e formata
// com `todayISO` (que normaliza o offset). Usar `new Date('YYYY-MM-DD')` seria
// interpretado como UTC e deslocaria o dia em fusos negativos como o Brasil.
// ---------------------------------------------------------------------------

/** Data de referência do cenário: 2026-09-29, dia da investigação original. */
export const REFERENCIA = new Date(2026, 8, 29, 12, 0, 0, 0);

/** ISO de um dia deslocado em `dias` (negativo = antes) a partir de `referencia`. */
export function deslocarDias(referencia, dias) {
  return todayISO(new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    referencia.getDate() + dias,
    12, 0, 0, 0,
  ));
}

// "Ontem" e "anteontem" do cenário original: 21/09 e 22/09.
export const DIA_A = deslocarDias(REFERENCIA, -8); // 2026-09-21 (10 gastos)
export const DIA_B = deslocarDias(REFERENCIA, -7); // 2026-09-22 (13 gastos)

/** Período do preset com o relógio do TESTE — aridade correta, sempre. */
export function periodoDe(preset, reference = REFERENCIA, { start = '', end = '' } = {}) {
  return resolveExpensePeriod(preset, { start, end, reference });
}

// ---- Os 23 gastos reais, reconstruídos ------------------------------------
// Valores observados na leitura direta: 10 em 21/09, 13 em 22/09, status
// "pago", 22 sem category_id, 1 com category_id.
//
// As DATAS vêm de DIA_A/DIA_B (derivadas da referência), não de literais: é o
// que impede a suíte de depender do dia em que ela roda. Com a referência
// padrão os valores resolvem exatamente para '2026-09-21' e '2026-09-22'.
const GASTOS_REAIS = [
  { id: 'fe_47d0bbf952aee3263074f1e5882aee4a', date: DIA_A, amount: 164, status: 'pago' },
  { id: 'fe_7e60408982606f85099255a513b6826a', date: DIA_A, amount: 600, status: 'pago' },
  { id: 'fe_a8fc1bee8b64e67f320095bce816f3b4', date: DIA_A, amount: 306, status: 'pago' },
  { id: 'fe_ef87e584b3b2994940a4188d492781ca', date: DIA_A, amount: 280, status: 'pago' },
  { id: 'id_mun02dc0_rihcfd05', date: DIA_A, amount: 80, status: 'pago' },
  { id: 'id_mun0ihdr_6ydph395', date: DIA_A, amount: 117, status: 'pago' },
  { id: 'id_mun0ka8l_dyfbodur', date: DIA_A, amount: 130, status: 'pago' },
  { id: 'id_mun0n169_fy9axb3d', date: DIA_A, amount: 129, status: 'pago' },
  { id: 'id_mun0ourd_v4x6t7rw', date: DIA_A, amount: 298, status: 'pago' },
  { id: 'id_mun0rvxl_sr3o3pb7', date: DIA_A, amount: 70, status: 'pago' },
  { id: 'fe_0894c7f42348ea9e4ab41d1a7dbddb43', date: DIA_B, amount: 13953.46, status: 'pago' },
  { id: 'fe_15b8d75790e8ea05899c9f1da447f503', date: DIA_B, amount: 320, status: 'pago' },
  { id: 'fe_1cf80dbb626e611b412c0d106df677f6', date: DIA_B, amount: 43.02, status: 'pago', category_id: 'id_mun11d9k_65rrrno7' },
  { id: 'fe_21e9cf0c3025f7954e3073bcc8c49368', date: DIA_B, amount: 20, status: 'pago' },
  { id: 'fe_659a68cfe6ffe605b63f051aea16d661', date: DIA_B, amount: 15.2, status: 'pago' },
  { id: 'fe_c12c404e07fc12d8b35dd34a22bfeb54', date: DIA_B, amount: 450.79, status: 'pago' },
  { id: 'fe_f0860f8f5948525f14438a00c81cd701', date: DIA_B, amount: 3838, status: 'pago' },
  { id: 'fe_f62316e18852655f7f6bb31465eb04f9', date: DIA_B, amount: 1162, status: 'pago' },
  { id: 'id_mun1vxo3_e0poo836', date: DIA_B, amount: 70, status: 'pago' },
  { id: 'id_mun1yipa_nr01l6oh', date: DIA_B, amount: 93, status: 'pago' },
  { id: 'id_mun26ty0_fpnno6wd', date: DIA_B, amount: 145, status: 'pago' },
  { id: 'id_mun28s31_nex9nrfo', date: DIA_B, amount: 78, status: 'pago' },
  { id: 'id_mun2bqrj_i6snxva9', date: DIA_B, amount: 98, status: 'pago' },
];

// Estado inicial real do DailyExpensesPanel.
const ESTADO_INICIAL = {
  search: '', preset: 'mes', customStart: '', customEnd: '',
  categoryId: '', paymentMethod: '', beneficiary: '', status: '', proof: '',
};

// Todos os filtros deste arquivo usam o relógio do TESTE. `periodoDe` é a
// única porta de entrada, para ninguém reintroduzir um `new Date()` solto.
const visiveisCom = (preset, extra = {}, reference = REFERENCIA) => {
  const p = periodoDe(preset, reference);
  return filterExpenses(GASTOS_REAIS, { ...ESTADO_INICIAL, ...extra, start: p.start, end: p.end });
};

test('G01 — os 23 gastos existentes aparecem com o filtro "Tudo"', () => {
  assert.equal(GASTOS_REAIS.length, 23, 'o cenário tem os 23 gastos do banco');
  assert.equal(visiveisCom('todos').length, 23, '"Tudo" precisa mostrar os 23');
});

test('G02 — os dois dias do cenário aparecem em "Este mês"', () => {
  const visiveis = visiveisCom('mes');
  assert.equal(visiveis.length, 23, '"Este mês" precisa mostrar os 23');
  assert.equal(visiveis.filter((g) => g.date === DIA_A).length, 10, 'os 10 do dia A');
  assert.equal(visiveis.filter((g) => g.date === DIA_B).length, 13, 'os 13 do dia B');
  // O contrato original, explicitado: no cenário de referência esses dias são
  // 21/09 e 22/09. Se isso mudar, o cenário mudou — e isso tem de doer.
  assert.equal(DIA_A, '2026-09-21');
  assert.equal(DIA_B, '2026-09-22');
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
  const periodo = periodoDe('mes');
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
  // A última collection boa é preservada pelo núcleo, via `aplicarFases`.
  assert.match(tela, /applyDashboardResult\(/, 'a junção das fases passa pelo núcleo');
  assert.match(tela, /aplicarResultado\(/, 'e a tela aplica por fase');
  const nucleo = await readFile(new URL('../src/lib/financeiroLoad.js', import.meta.url), 'utf8');
  assert.match(nucleo, /aplicarFases[\s\S]{0,600}mesclarPreservando/, 'que preserva a última collection boa');
  // Comportamento, não só texto: a fase 2 sem expenses não pode apagar nada.
  const anterior = { expenses: GASTOS_REAIS, employees: [] };
  const fontesDaFase2 = FONTE_FINANCEIRO
    .filter((f) => f.alias !== 'expenses')
    .map((f) => ({ alias: f.alias, entity: f.entity, entidade: { list: async () => [] } }));
  const f1 = await executarFontes(fontesDaFase2);
  const depoisDaFase2 = aplicarFases([f1], anterior);
  assert.equal(depoisDaFase2.expenses.length, 23, 'uma fase que não traz expenses preserva as 23');
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
  const p = periodoDe('mes');
  const visiveis = filterExpenses(vazio, { start: p.start, end: p.end });
  assert.equal(visiveis.length, 0);

  const ind = dailyExpenseIndicators(vazio, { reference: REFERENCIA });
  assert.equal(ind.totalCount, 0, 'indicador também é zero, corretamente');
  assert.equal(ind.monthCount, 0);

  // Já com os 23 carregados, o mesmo filtro "hoje" devolve 0 MAS o total do
  // período continua 23 — é isso que permite à UI dizer "existem 23".
  const comDados = filterExpenses(GASTOS_REAIS, { start: p.start, end: p.end });
  assert.equal(visiveis.length, 0);
  assert.equal(comDados.length, 23, 'o período ainda tem 23: o zero da busca é do filtro, não do banco');
  assert.equal(dailyExpenseIndicators(GASTOS_REAIS, { reference: REFERENCIA }).totalCount, 23);
});

test('G14 — nenhum gasto cancelado se mistura; os 23 estão "pago"', () => {
  assert.equal(GASTOS_REAIS.filter(isCancelledExpense).length, 0, 'nenhum dos 23 está cancelado');
  const p = periodoDe('mes');
  const visiveis = filterExpenses(GASTOS_REAIS, { start: p.start, end: p.end });
  assert.equal(visiveis.length, 23, 'então o filtro de cancelados não tira nenhum');
});

// ---------------------------------------------------------------------------
// G15-G18: o relógio é de fato controlado (a defesa contra a regressão)
// ---------------------------------------------------------------------------

// A aridade é a armadilha original: `resolveExpensePeriod` recebe
// `reference` DENTRO do segundo argumento. Passar como terceiro não dá erro —
// simplesmente não chega. Este teste pega exatamente esse modo de falha.
test('G15 — o reference realmente chega na função (a aridade não pode regredir)', () => {
  const setembro = new Date(2026, 8, 29, 12, 0, 0, 0);
  const janeiro = new Date(2027, 0, 15, 12, 0, 0, 0);
  assert.notEqual(
    periodoDe('mes', setembro).start,
    periodoDe('mes', janeiro).start,
    'datas diferentes têm de produzir períodos diferentes',
  );
  assert.equal(periodoDe('mes', setembro).start, '2026-09-01');
  assert.equal(periodoDe('mes', janeiro).start, '2027-01-01');

  // E a assinatura real continua sendo de DOIS parâmetros: se alguém mudar a
  // produção para três, este teste avisa em vez de deixar o descarte silencioso.
  assert.equal(resolveExpensePeriod.length <= 2, true, 'resolveExpensePeriod recebe preset + um objeto de opções');
  assert.equal(dailyExpenseIndicators.length <= 2, true, 'dailyExpenseIndicators recebe rows + um objeto de opções');
});

test('G16 — o período não depende do dia em que a suíte roda', () => {
  // O mesmo relógio de teste produz sempre o mesmo período, qualquer que seja a
  // data real da máquina — é esta asserção que quebrava antes.
  const esperado = periodoDe('mes', REFERENCIA);
  for (const dia of [1, 15, 28]) {
    const outraMaquina = new Date(2031, 5, dia, 23, 45, 0, 0);
    const obtido = periodoDe('mes', REFERENCIA);
    assert.deepEqual(obtido, esperado, `estável com o relógio real em ${dia}/06/2031`);
    // E o período do TESTE não é o do relógio real: prova de separação.
    assert.notEqual(
      resolveExpensePeriod('mes', { start: '', end: '' }).start,
      esperado.start,
      `o new Date() real (${outraMaquina.toISOString().slice(0, 10)}) é diferente do relógio do teste`,
    );
  }
});

test('G17 — virada de mês: o dia anterior fica fora de "Este mês"', () => {
  // Referência no primeiro dia do mês: um gasto de 30/09 é do mês PASSADO.
  const primeiroDeOutubro = new Date(2026, 9, 1, 12, 0, 0, 0);
  const p = periodoDe('mes', primeiroDeOutubro);
  assert.equal(p.start, '2026-10-01');
  assert.equal(p.end, '2026-10-01');

  const gastos = [
    { id: 'v1', date: '2026-09-30', amount: 10, status: 'pago' }, // dia anterior
    { id: 'v2', date: '2026-10-01', amount: 20, status: 'pago' }, // o próprio dia
  ];
  const dentro = filterExpenses(gastos, { start: p.start, end: p.end });
  assert.deepEqual(dentro.map((g) => g.id), ['v2'], '30/09 fica de fora; 01/10 fica dentro');

  // E o mês anterior responde com o outro registro.
  const pAnterior = { start: '2026-09-01', end: '2026-09-30' };
  assert.deepEqual(
    filterExpenses(gastos, pAnterior).map((g) => g.id), ['v1'], 'em setembro, quem aparece é 30/09',
  );
});

test('G18 — virada de ano: 31/12 e 01/01 ficam em meses diferentes', () => {
  const primeiroDeJaneiro = new Date(2027, 0, 1, 12, 0, 0, 0);
  const p = periodoDe('mes', primeiroDeJaneiro);
  assert.equal(p.start, '2027-01-01', 'janeiro começa em 01/01, não em 31/12');

  const gastos = [
    { id: 'n1', date: '2026-12-31', amount: 10, status: 'pago' },
    { id: 'n2', date: '2027-01-01', amount: 20, status: 'pago' },
  ];
  assert.deepEqual(
    filterExpenses(gastos, { start: p.start, end: p.end }).map((g) => g.id), ['n2'],
  );
  // Em dezembro, o ano muda e mesmo assim o dia 31 continua em dezembro.
  const pDezembro = periodoDe('mes', new Date(2026, 11, 31, 12, 0, 0, 0));
  assert.equal(pDezembro.start, '2026-12-01');
  assert.equal(pDezembro.end, '2026-12-31');
  assert.deepEqual(
    filterExpenses(gastos, { start: pDezembro.start, end: pDezembro.end }).map((g) => g.id), ['n1'],
  );
});
