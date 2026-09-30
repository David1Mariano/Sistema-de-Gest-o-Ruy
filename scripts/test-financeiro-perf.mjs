// Testes de performance/UX do carregamento do Financeiro.
//
// O problema medido: as 15 entidades em paralelo seguram a aba Gastos por
// segundos, mas a FinancialExpense sozinha responde bem antes — e a lista de
// gastos não usa nenhuma das outras 14 para desenhar.
//
// Estes testes travam o comportamento: a aba prioritária desenha assim que a
// SUA consulta termina, e nada no caminho pode devolver isso ao "espere tudo".
//
// Fixtures sintéticos com latência controlada. Nenhuma chamada de rede.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  FONTE_FINANCEIRO,
  PRIORIDADE_POR_ABA,
  aliasesInvalidos,
  aplicarFases,
  ehFalhaDeSessao,
  executarFontes,
  juntarFalhas,
  mesclarPreservando,
  resumirFalhas,
  separarPorPrioridade,
} from '../src/lib/financeiroLoad.js';

const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Fonte com latência e resultado controlados.
const fonte = (alias, entity, { ms = 0, dados = [], falha = null } = {}) => ({
  alias,
  entity,
  entidade: {
    list: async () => {
      if (ms) await esperar(ms);
      if (falha) throw falha;
      return dados;
    },
  },
});

const construir = (opcoes = {}) => FONTE_FINANCEIRO.map((f) => fonte(
  f.alias,
  f.entity,
  opcoes[f.alias] || {},
));

test('P01 — a FinancialExpense não espera as outras 14 entidades', async () => {
  const fontes = construir({
    expenses: { ms: 60, dados: [{ id: 'e1' }, { id: 'e2' }] },
    // As outras 14 são bem mais lentas que a lista de gastos.
    employees: { ms: 900, dados: [{ id: 'p1' }] },
    vales: { ms: 900, dados: [] },
    consumptions: { ms: 900, dados: [] },
  });
  const { prioridade, resto } = separarPorPrioridade(fontes, 'gastos');

  assert.ok(prioridade.some((f) => f.alias === 'expenses'), 'expenses está na fase 1 de Gastos');
  assert.equal(resto.some((f) => f.alias === 'expenses'), false, 'expenses não está na fase 2');
  assert.ok(resto.some((f) => f.alias === 'employees'), 'employees vai para o segundo plano');

  const inicio = performance.now();
  const f1 = await executarFontes(prioridade);
  const tempoPrioritario = performance.now() - inicio;

  assert.equal(f1.valores.expenses.length, 2, 'os gastos chegaram');
  assert.equal(f1.valores.employees, undefined, 'os colaboradores NÃO fazia parte desta fase');
  assert.equal(tempoPrioritario < 400, true, `a fase 1 levou ${Math.round(tempoPrioritario)}ms; não pode esperar as outras 14`);
});

test('P02 — setExpenses pode acontecer antes do loader global terminar', async () => {
  // Reproduz as duas fases como o componente faz.
  const fontes = construir({
    expenses: { ms: 30, dados: [{ id: 'e1' }] },
    categories: { ms: 30, dados: [{ id: 'c1' }] },
    payables: { ms: 1200, dados: [] },
    closes: { ms: 1200, dados: [] },
  });
  const { prioridade, resto } = separarPorPrioridade(fontes, 'gastos');

  const linhaDoTempo = [];
  const f1 = await executarFontes(prioridade);
  linhaDoTempo.push({ fase: 'prioritario', t: performance.now(), expenses: f1.valores.expenses?.length });

  const promessaResto = executarFontes(resto);
  // Neste instante a lista JÁ pode ser desenhada com 1 gasto, enquanto 4
  // entities ainda estão na rede.
  assert.equal(f1.valores.expenses.length, 1, 'a lista está disponível antes do resto');
  assert.equal((await promessaResto).valores.expenses, undefined, 'e o resto não traz gastos para sobrescrever');

  const f2 = await promessaResto;
  const aplicado = aplicarFases([f1, f2], {});
  assert.equal(aplicado.expenses.length, 1, 'ao final, os gastos continuam');
  assert.equal(Array.isArray(aplicado.payables), true, 'e as entidades de fundo também chegaram');
  assert.ok(linhaDoTempo.length === 1);
});

test('P03 — voltar à aba preserva a lista (sem vazio + loading)', async () => {
  const Expense = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];
  const fontes = construir({ expenses: { dados: Expense } });

  // Primeira visita: carregou.
  const f1 = await executarFontes(fontes);
  const telaAposPrimeira = mesclarPreservando(f1.valores, {});

  // O usuário sai da aba. `data` continua em memória — nada zera.
  assert.equal(telaAposPrimeira.expenses.length, 3, 'a lista segue em memória ao sair da aba');

  // Volta: a fase prioritária roda de novo, mas ANTES dela a tela já tem o que
  // mostrar. A regra da tela é `loading && !expenses.length`.
  const f2 = await executarFontes(separarPorPrioridade(fontes, 'gastos').prioridade);
  const telaAoVoltar = mesclarPreservando(f2.valores, telaAposPrimeira);
  assert.equal(telaAoVoltar.expenses.length, 3, 'ao voltar, a lista está lá — não houve tela vazia');
});

test('P04 — refresh não zera a lista', async () => {
  const antes = { expenses: [{ id: 'e1' }], employees: [{ id: 'p1' }] };
  // Refresh que falha em tudo.
  const falhou = await executarFontes(construir({
    expenses: { falha: Object.assign(new Error('500'), { status: 500 }) },
  }));
  const depois = mesclarPreservando(falhou.valores, antes);
  assert.equal(depois.expenses.length, 1, 'os gastos continuam mesmo com falha no refresh');
  assert.equal(aliasesInvalidos(falhou.falhas).has('expenses'), true, 'e a tela sabe que são dados velhos');
});

test('P05 — uma entidade lenta não atrasa Gastos', async () => {
  const fontes = construir({
    expenses: { ms: 20, dados: [{ id: 'e1' }] },
    // Uma entity de fundo absurdamente lenta.
    fechamentosCaixa: { ms: 3000, dados: [] },
  });
  const { prioridade, resto } = separarPorPrioridade(fontes, 'gastos');
  assert.equal(resto.some((f) => f.alias === 'fechamentosCaixa'), true, 'fechamentosCaixa é de fundo');

  const inicio = performance.now();
  const f1 = await executarFontes(prioridade);
  assert.equal(performance.now() - inicio < 300, true, 'Gastos não espera a entity lenta');
  assert.equal(f1.valores.expenses.length, 1);
});

test('P06 — uma entity quebrada não atrasa Gastos', async () => {
  const fontes = construir({
    expenses: { ms: 20, dados: [{ id: 'e1' }] },
    payables: { falha: Object.assign(new Error('relation not found'), { status: 404 }) },
  });
  const { prioridade, resto } = separarPorPrioridade(fontes, 'gastos');
  const f1 = await executarFontes(prioridade);
  const f2 = await executarFontes(resto);

  assert.equal(f1.falhas.length, 0, 'a fase 1 passou limpa');
  assert.equal(f2.falhas.length, 1, 'a falha ficou isolada na fase 2');
  const aplicado = aplicarFases([f1, f2], {});
  assert.equal(aplicado.expenses.length, 1, 'e os gastos apareceram mesmo assim');
});

test('P07 — sessão expirada com cache válido mantém a lista', async () => {
  const comCache = { expenses: [{ id: 'e1' }, { id: 'e2' }] };
  const expirada = Object.assign(new Error('Sessão expirada.'), { status: 401 });
  const f1 = await executarFontes(construir({ expenses: { falha: expirada } }));

  assert.equal(ehFalhaDeSessao(f1.falhas), true, 'a tela reconhece que é sessão');
  const mantido = mesclarPreservando(f1.valores, comCache);
  assert.equal(mantido.expenses.length, 2, 'o cache válido continua na tela durante a renovação');
  const aviso = resumirFalhas(f1.falhas, { carregouAntes: true });
  assert.match(aviso, /401/, 'e o aviso continua dizendo a causa');
});

test('P08 — o retry acontece em background, sem apagar o que já está na tela', async () => {
  const comCache = { expenses: [{ id: 'e1' }] };
  let renovou = false;
  // Fase 1 falha (sessão), o componente renova e repete; o cache fica o
  // tempo todo. O que importa: nenhuma etapa escreve lista vazia.
  const falhou = await executarFontes(construir({
    expenses: { falha: Object.assign(new Error('Sessão expirada.'), { status: 401 }) },
  }));
  const durante = mesclarPreservando(falhou.valores, comCache);
  assert.equal(durante.expenses.length, 1, 'durante a renovação, a lista antiga segue visível');

  if (ehFalhaDeSessao(falhou.falhas)) { renovou = true; await esperar(20); }
  const depois = await executarFontes(construir({ expenses: { dados: [{ id: 'e1' }, { id: 'e2' }] } }));
  const final = mesclarPreservando(depois.valores, durante);
  assert.equal(renovou, true, 'a renovação foi acionada');
  assert.equal(final.expenses.length, 2, 'e a lista nova entrou por cima da antiga');
});

test('P09 — categorias chegam depois sem apagar os gastos', async () => {
  const fontes = construir({
    expenses: { ms: 10, dados: [{ id: 'e1' }] },
    categories: { ms: 200, dados: [{ id: 'c1' }] },
    vales: { ms: 120, dados: [] },
  });
  const { prioridade, resto } = separarPorPrioridade(fontes, 'gastos');
  // 'gastos' prioriza expenses E categories — mas ambas são esperadas juntas.
  // O ponto é que, ao aplicá-las, nada de fora apaga o que já veio.
  const f1 = await executarFontes(prioridade);
  const f2 = await executarFontes(resto);
  const final = aplicarFases([f1, f2], {});
  assert.equal(final.expenses.length, 1, 'os gastos sobreviveram à chegada do resto');
  assert.equal(final.categories.length, 1, 'e as categorias chegaram');
  assert.equal(juntarFalhas(f1, f2).length, 0, 'sem falhas');
});

test('P10 — a prioridade de cada aba aponta para os aliases certos', () => {
  assert.deepEqual(PRIORIDADE_POR_ABA.gastos, ['expenses', 'categories'], 'Gastos prioriza gastos e categorias');
  const conhecidos = new Set(FONTE_FINANCEIRO.map((f) => f.alias));
  for (const [aba, aliases] of Object.entries(PRIORIDADE_POR_ABA)) {
    for (const a of aliases) {
      assert.equal(conhecidos.has(a), true, `${aba}: "${a}" não existe em FONTE_FINANCEIRO — seria uma fonte morta`);
    }
  }
  // Toda aba conhecida tem prioridade; aba desconhecida cai na visao.
  const fontes = construir();
  const { prioridade, resto } = separarPorPrioridade(fontes, 'aba-que-nao-existe');
  assert.ok(prioridade.length > 0, 'aba desconhecida ainda tem uma fase prioritária válida');
  assert.equal(prioridade.length + resto.length, FONTE_FINANCEIRO.length, 'e a divisão cobre as 15 exatamente uma vez');
});

test('P11 — as subscriptions são específicas (nada recarrega as 15)', async () => {
  const src = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');

  assert.match(src, /FinancialExpense\.subscribe\(\(\) => reloadExpenses\(\)\)/, 'mudança em gasto recarrega só gastos');
  assert.match(src, /ExpenseCategory\.subscribe\(\(\) => reloadCategories\(\)\)/, 'mudança em categoria recarrega só categorias');
  assert.doesNotMatch(src, /\w+\.subscribe\(\(\) => load\(\)\)/, 'nenhuma subscription dispara o loader completo de 15');
  // O agrupamento por atraso existe, mas é explícito e só para quem atende
  // várias abas.
  assert.match(src, /onMudancaAmpla[\s\S]{0,200}setTimeout\(\(\) => load\(\), 800\)/, 'Employee/Supplier usam recarga agrupada com atraso');
});

test('P12 — loading não bloqueia uma lista que já tem dados', async () => {
  const src = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');
  assert.match(
    src,
    /<DailyExpensesPanel rows=\{data\.expenses\} loading=\{initialLoading && !data\.expenses\.length\}/,
    'a tabela só entra em loading quando não há NENHUM dado para mostrar',
  );
  // E a fase 1 desliga o loading global antes de a fase 2 começar.
  assert.match(src, /aplicarResultado\(fase1, seq\)[\s\S]{0,120}setInitialLoading\(false\)/, 'initialLoading desliga na fase 1');
});

test('P13 — o texto de aviso e o indicador continuam existindo', async () => {
  const src = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');
  const painel = await readFile(new URL('../src/components/financeiro/DailyExpensesPanel.jsx', import.meta.url), 'utf8');
  // A mensagem mora no núcleo (financeiroLoad), não no componente.
  const nucleo = await readFile(new URL('../src/lib/financeiroLoad.js', import.meta.url), 'utf8');

  assert.match(nucleo, /Não foi possível atualizar o Financeiro\./, 'a mensagem com causa continua');
  assert.match(nucleo, /afetou: /, 'e o agrupamento por causa continua');
  assert.match(src, /resumirFalhas\(/, 'a tela continua usando o aviso do núcleo');
  assert.match(src, /Atualizar/, 'o botão Atualizar continua');
  assert.match(painel, /Valores indisponíveis/, '"Valores indisponíveis" continua');
  assert.match(painel, /lançamento\(s\) existem/, 'o aviso de filtro continua');
  assert.doesNotMatch(nucleo, /Não foi possível atualizar: \$\{/, 'a lista infinita de aliases não volta');
  assert.match(src, /renovarSessao\(\)/, 'o retry de sessão continua');
  assert.match(src, /MAX_TENTATIVAS/, 'e o limite de tentativas continua');
});

test('P14 — drafts continuam intactos e independentes', async () => {
  const src = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');
  assert.match(src, /usePersistentDraft\(/, 'os dois diálogos com rascunho continuam usando a infraestrutura');
  assert.match(src, /draft\.markSaved\(\)/, 'e continuam limpando só depois do backend');
  // O loader não pode tocar em storage.
  const loader = await readFile(new URL('../src/lib/financeiroLoad.js', import.meta.url), 'utf8');
  assert.doesNotMatch(loader, /localStorage|draft/i, 'o loader de performance não conhece rascunho nem storage');
});
