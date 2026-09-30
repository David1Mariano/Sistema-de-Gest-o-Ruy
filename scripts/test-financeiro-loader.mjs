// Testes de regressão do carregamento do Financeiro.
//
// O defeito que estes testes travam: uma falha de sessão atinge as 15 entities
// ao mesmo tempo (o cabeçalho de autenticação é compartilhado), o loader
// reportava só uma lista de aliases sem status nem causa, nunca tentava de
// novo, e a tela ficava exibindo "R$ 0,00" como se fosse verdade.
//
// Fixtures sintéticos. Nenhuma chamada de rede, nenhum dado real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FONTE_FINANCEIRO,
  agruparPorCausa,
  aliasesInvalidos,
  ehFalhaDeSessao,
  executarFontes,
  mesclarPreservando,
  resumirFalhas,
} from '../src/lib/financeiroLoad.js';

// Dublê de entity. `falha` recebe o mesmo formato que o `authAdapter` lança.
const entity = (nome, dados, falha = null) => ({
  entity: nome,
  list: async () => {
    if (falha) throw falha;
    return dados;
  },
});

// Monta as 15 fontes do Financeiro com entidades controladas.
const montar = (quais = {}, { erroPadrao = null } = {}) => FONTE_FINANCEIRO.map((f) => ({
  alias: f.alias,
  entity: f.entity,
  entidade: entity(f.entity, quais[f.alias] ?? [], quais[f.alias]?.falha ?? erroPadrao),
}));

const BOAS = { expenses: [{ id: 'e1' }, { id: 'e2' }], employees: [{ id: 'p1' }], payments: [{ id: 'b1' }] };

test('L01 — uma entity falhando NÃO zera as outras', async () => {
  const fontes = FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: f.alias === 'suppliers'
      ? entity(f.entity, [], Object.assign(new Error('falhou'), { status: 500 }))
      : entity(f.entity, BOAS[f.alias] ?? [{ id: f.alias }]),
  }));
  const { valores, falhas } = await executarFontes(fontes);

  assert.deepEqual(falhas.map((f) => f.alias), ['suppliers'], 'só a entity que quebrou entra na lista de falhas');
  assert.equal(valores.expenses.length, 2, 'os gastos continuam carregados mesmo com outra entity quebrada');
  assert.equal(valores.employees.length, 1, 'os colaboradores também');
  assert.equal(valores.payments.length, 1, 'e os pagamentos');
  assert.equal('suppliers' in valores, false, 'a entity que falhou não entra como valor vazio');
});

test('L02 — o loader identifica QUAL entity falhou, com status e mensagem', async () => {
  const fontes = FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: f.alias === 'vales'
      ? entity(f.entity, [], Object.assign(new Error('PostgREST 404'), { status: 404 }))
      : entity(f.entity, []),
  }));
  const { falhas } = await executarFontes(fontes);

  assert.equal(falhas.length, 1);
  assert.equal(falhas[0].alias, 'vales', 'a entity que falhou é nomeada');
  assert.equal(falhas[0].entity, 'Vale', 'e também qual entity real ela é');
  assert.equal(falhas[0].status, 404, 'o status HTTP vem junto');
  assert.match(falhas[0].mensagem, /404/, 'a mensagem vem junto');
});

test('L03 — dados já carregados são preservados quando a recarga falha', async () => {
  const anterior = { expenses: [{ id: 'e1' }, { id: 'e2' }], employees: [{ id: 'p1' }] };
  // expenses falhou: NÃO pode virar lista vazia.
  const merged = mesclarPreservando({ employees: [{ id: 'p1' }, { id: 'p2' }] }, anterior);

  assert.deepEqual(merged.expenses, anterior.expenses, 'a collection que falhou conserva o último valor bom');
  assert.equal(merged.employees.length, 2, 'a que deu certo é atualizada normalmente');
  assert.equal(Array.isArray(merged.vales), true, 'collection que nunca carregou ainda começa como lista');
  assert.equal(merged.vales.length, 0, 'e começa vazia de verdade, porque nunca houve leitura');
});

test('L04 — erro NÃO vira zero legítimo: a mensagem diz que nada foi lido', async () => {
  const falhas = [{ alias: 'expenses', entity: 'FinancialExpense', status: 401, mensagem: 'Sessão expirada.' }];

  const semHistorico = resumirFalhas(falhas, { carregouAntes: false });
  assert.match(semHistorico, /não são confiáveis/i, 'sem carga anterior, a tela diz que os valores não valem');
  assert.match(semHistorico, /401/, 'o status aparece');

  const comHistorico = resumirFalhas(falhas, { carregouAntes: true });
  assert.match(comHistorico, /últimos dados carregados/i, 'com carga anterior, avisa que é o último estado bom');
  assert.match(comHistorico, /401/, 'o status também aparece neste caso');

  // A mensagem antiga listava aliases e não dizia nada de útil.
  assert.doesNotMatch(
    comHistorico,
    /^Não foi possível atualizar: expenses, payments/,
    'a lista de aliases sozinha já não é a mensagem',
  );
});

test('L05 — FinancialExpense e Employee continuam aparecendo', async () => {
  // Regressão do nome: a tela fala "expenses", o banco tem "FinancialExpense".
  // Se esses dois divergirem de novo, os 23 gastos somem sem erro nenhum.
  const expenses = FONTE_FINANCEIRO.find((f) => f.alias === 'expenses');
  const employees = FONTE_FINANCEIRO.find((f) => f.alias === 'employees');
  assert.equal(expenses.entity, 'FinancialExpense', 'expenses resolve para FinancialExpense');
  assert.equal(employees.entity, 'Employee', 'employees resolve para Employee');

  const gastos = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }];
  const fontes = montar({ expenses: gastos, employees: [{ id: 'c1' }] });
  const { valores, falhas } = await executarFontes(fontes);
  assert.equal(falhas.length, 0);
  assert.equal(valores.expenses.length, 3, 'os 23 gastos chegam pela entity certa');
  assert.equal(valores.employees.length, 1, 'os 59 colaboradores chegam');
});

test('L06 — falha de sessão é reconhecida como uma causa só, não 15 defeitos', async () => {
  const erroSessao = Object.assign(new Error('Sessão Supabase Auth expirada. Entre novamente.'), { status: 401 });
  const { falhas } = await executarFontes(montar(BOAS, { erroPadrao: erroSessao }));

  assert.equal(falhas.length, 15, 'todas as entities caem, porque o cabeçalho é compartilhado');
  const grupos = agruparPorCausa(falhas);
  assert.equal(grupos.length, 1, 'mas é UMA causa, e a tela precisa dizer isso');
  assert.match(grupos[0].causa, /401/, 'a causa é o status de sessão');
  assert.equal(ehFalhaDeSessao(falhas), true, 'isso permite a renovação única de sessão e a nova tentativa');
});

test('L07 — a retry de sessão acontece UMA vez e recupera', async () => {
  // Reproduz a tela: sessão expirada na primeira carga, renovação funciona,
  // segunda carga devolve os dados.
  let chamadas = 0;
  const fontes = FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: {
      entity: f.entity,
      list: async () => {
        chamadas += 1;
        if (chamadas <= FONTE_FINANCEIRO.length) {
          throw Object.assign(new Error('Sessão expirada.'), { status: 401 });
        }
        return BOAS[f.alias] ?? [];
      },
    },
  }));

  let resultado = await executarFontes(fontes);
  const renovou = ehFalhaDeSessao(resultado.falhas);
  assert.equal(renovou, true, 'a primeira carga sinaliza falha de sessão');

  if (renovou) resultado = await executarFontes(fontes); // simula a retry
  assert.equal(resultado.falhas.length, 0, 'depois da renovação a carga volta inteira');
  assert.equal(resultado.valores.expenses.length, 2, 'os gastos reaparecem');
  assert.equal(resultado.valores.employees.length, 1, 'e os colaboradores');
});

test('L08 — recuperação após erro preserva o que já estava bom', async () => {
  const bom = { expenses: [{ id: 'e1' }], employees: [{ id: 'p1' }], vales: [{ id: 'v1' }] };
  // 1ª carga: expenses e employees ok, vales falha.
  const primeira = await executarFontes(FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    entidade: f.alias === 'vales'
      ? entity(f.entity, [], Object.assign(new Error('500'), { status: 500 }))
      : entity(f.entity, bom[f.alias] ?? []),
  })));
  const tela = mesclarPreservando(primeira.valores, {});
  assert.equal(tela.expenses.length, 1, 'gastos carregados');
  assert.equal(tela.vales.length, 0, 'vales falharam, então ainda não há nada bom');
  assert.equal(aliasesInvalidos(primeira.falhas).has('vales'), true, 'a tela sabe que vales não é confiável');
  assert.equal(aliasesInvalidos(primeira.falhas).has('expenses'), false, 'e que gastos é confiável');

  // 2ª carga: tudo volta.
  const segunda = await executarFontes(FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias, entity: f.entity, entidade: entity(f.entity, f.alias === 'vales' ? [{ id: 'v1' }, { id: 'v2' }] : (bom[f.alias] ?? [])),
  })));
  const tela2 = mesclarPreservando(segunda.valores, tela);
  assert.equal(tela2.vales.length, 2, 'vales aparecem depois de recuperar');
  assert.equal(tela2.expenses.length, 1, 'e os gastos continuam');
  assert.equal(aliasesInvalidos(segunda.falhas).size, 0, 'nada mais inválido');
});

test('L09 — falha de sessão e falha de dados não se confundem', async () => {
  const sessao = [{ alias: 'expenses', entity: 'FinancialExpense', status: 401, mensagem: 'Sessão expirada.' }];
  const dados = [{ alias: 'suppliers', entity: 'Supplier', status: 404, mensagem: 'relation not found' }];

  assert.equal(ehFalhaDeSessao(sessao), true, '401 é sessão');
  assert.equal(ehFalhaDeSessao(dados), false, '404 não é sessão — renovar a sessão não resolveria');
  assert.match(resumirFalhas(dados), /relation not found/, 'a causa de dados aparece na mensagem');
  assert.doesNotMatch(resumirFalhas(dados), /expirada/, 'e não é descrita como problema de sessão');
});

test('L10 — a tela mostra a causa real, não quinze aliases', async () => {
  const falhas = FONTE_FINANCEIRO.map((f) => ({
    alias: f.alias,
    entity: f.entity,
    status: 401,
    mensagem: 'Sessão Supabase Auth expirada. Entre novamente.',
  }));
  const msg = resumirFalhas(falhas, { carregouAntes: true });

  assert.match(msg, /401/, 'o status HTTP está na mensagem');
  assert.match(msg, /Sessão Supabase Auth expirada/, 'a causa real está na mensagem');
  // Os 15 aliases viram "15 telas", porque 15 nomes não ajudam ninguém.
  assert.doesNotMatch(msg, /expenses, payments, employees, vales, consumptions, categories, centers, payables, accounts, recurrings, closes, fechamentosCaixa, sangrias, cashMovements, suppliers/, 'a lista infinita de aliases sumiu');
  assert.match(msg, /15 telas/, 'a contagem resume');
});

// Ligação com o código real: a correção precisa estar de fato na tela.
test('L11 — Financeiro usa o loader corrigido e guarda as flags', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/pages/Financeiro.jsx', import.meta.url), 'utf8');

  assert.match(src, /executarFontes\(/, 'a tela usa o loader isolado por entity');
  // A preservação da última collection boa é feita por `aplicarFases`, que
  // chama `mesclarPreservando` no núcleo. A tela não precisa mais conhecê-la.
  assert.match(src, /aplicarResultado\(/, 'a tela aplica o resultado por fase');
  assert.match(src, /aplicarFases\(/, 'e a junção das fases acontece pelo núcleo');
  assert.match(src, /resumirFalhas\(/, 'a mensagem traz status e causa');
  assert.match(src, /ehFalhaDeSessao\(fase0\.falhas\)/, 'a falha de sessão é reconhecida');
  assert.match(src, /renovarSessao\(\)/, 'a sessão é renovada uma vez antes de desistir');
  assert.match(src, /setInvalidAliases\(/, 'a tela sabe quais collections são inválidas');
  assert.match(src, /semDadosConfirmados=/, 'o painel de gastos recebe a flag de confiabilidade');
  assert.doesNotMatch(src, /Não foi possível atualizar: \$\{falhas\.join/, 'a mensagem antiga de aliases não volta');
});

test('L12 — os cards de Gastos escondem o zero quando não houve leitura', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/components/financeiro/DailyExpensesPanel.jsx', import.meta.url), 'utf8');

  assert.match(src, /semDadosConfirmados = true/, 'o painel tem a prop, com padrão seguro');
  assert.match(src, /!semDadosConfirmados \? \(/, 'há um caminho de estado inválido');
  assert.match(src, /Valores indisponíveis/, 'e ele diz que os valores não foram lidos');
  // O zero só pode existir no ramo em que os dados foram confirmados.
  const guarda = src.indexOf('!semDadosConfirmados ? (');
  const indicadores = src.indexOf('label="Gastos de hoje"');
  assert.equal(guarda > -1 && indicadores > guarda, true, 'os cards com zero ficam DENTRO do caminho de dados confirmados');
});
