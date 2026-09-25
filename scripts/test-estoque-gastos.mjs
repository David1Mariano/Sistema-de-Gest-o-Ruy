// Testes de regressão de ESTOQUE e GASTOS DIÁRIOS.
//
// Cobre as regras puras (tipos de movimentação, sinal, saldo, validação,
// parse monetário pt-BR) e trava por análise estática as garantias que a
// FASE 2A exige da conferência de produção (que não pode escrever estoque).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { formatDecimalBR, parseDecimalBR, roundMoney, roundQty } from '../src/lib/numberUtils.js';
import {
  MOVEMENT_LABELS,
  MOVEMENT_TYPES,
  StockError,
  balanceFromMovements,
  costsAfter,
  movementTypeLabel,
  signedQuantity,
  stockDirection,
  validateMovement,
} from '../src/lib/stockRules.js';

const cases = [];
const test = (name, fn) => cases.push({ name, fn });
const eq = (actual, expected, label) =>
  assert.equal(actual, expected, `${label}: esperado=${expected} recebido=${actual}`);
const throws = (fn, code, label) => {
  try {
    fn();
  } catch (e) {
    if (code) assert.equal(e.code, code, `${label}: codigo esperado=${code} recebido=${e.code}`);
    return e;
  }
  throw new Error(`${label}: esperava erro`);
};

const item = { id: 'i1', name: 'Farinha', unit: 'kg', current_stock: 10, average_cost: 5 };

// --------------------------------------------------------------------------
// FASE 8 — valores monetários / ponto flutuante
// --------------------------------------------------------------------------
test('parse-25,50-vira-25.5 (nunca 2550 nem 25)', () => {
  eq(parseDecimalBR('25,50'), 25.5, 'virgula decimal');
  eq(parseDecimalBR('1.234,50'), 1234.5, 'milhar com ponto e virgula decimal');
  eq(parseDecimalBR('25.50'), 25.5, 'ponto decimal (sem virgula)');
  eq(parseDecimalBR('R$ 25,50'), 25.5, 'com prefixo');
  eq(parseDecimalBR('1.500.250'), 1500250, 'milhar com varios pontos');
});

test('parse-vazio-nao-vira-zero-nem-NaN', () => {
  eq(parseDecimalBR(''), '', 'vazio');
  eq(parseDecimalBR('   '), '', 'espacos');
  eq(parseDecimalBR('abc'), '', 'texto');
  eq(parseDecimalBR('-'), '', 'sinal isolado');
  assert.equal(Number.isNaN(parseDecimalBR('abc')), false, 'nunca devolve NaN');
});

test('arredondamento-monetario-e-de-quantidade', () => {
  eq(roundMoney(25.505), 25.51, 'centavos');
  eq(roundMoney(0.1 + 0.2), 0.3, '0.1+0.2');
  eq(roundQty(0.1 + 0.2), 0.3, 'quantidade');
  eq(roundQty('3,5'), 3.5, 'quantidade de texto');
  assert.ok(Number.isNaN(roundMoney('abc')), 'texto invalido vira NaN (tratado na validacao)');
});

test('formatacao-pt-br-na-tela', () => {
  eq(formatDecimalBR(25.5), '25,5', 'decimal');
  eq(formatDecimalBR(1234.5, 2), '1.234,5', 'milhar');
  eq(formatDecimalBR(''), '', 'vazio');
});

// --------------------------------------------------------------------------
// FASE 4 — modelo de movimentação
// --------------------------------------------------------------------------
test('direcao-de-tipos-de-movimentacao', () => {
  eq(stockDirection(MOVEMENT_TYPES.ENTRADA_MANUAL), 'entrada', 'entrada manual');
  eq(stockDirection(MOVEMENT_TYPES.ENTRADA_COMPRA), 'entrada', 'entrada compra');
  eq(stockDirection(MOVEMENT_TYPES.AJUSTE_ENTRADA), 'entrada', 'ajuste entrada');
  eq(stockDirection(MOVEMENT_TYPES.SAIDA_MANUAL), 'saida', 'saida manual');
  eq(stockDirection(MOVEMENT_TYPES.PERDA), 'saida', 'perda');
  eq(stockDirection(MOVEMENT_TYPES.AJUSTE_SAIDA), 'saida', 'ajuste saida');
  eq(stockDirection(MOVEMENT_TYPES.CONSUMO_PRODUCAO), 'saida', 'consumo');
});

test('tipos-antigos-do-projeto-continuam-validos', () => {
  // Compatibilidade: nada do que já existe no banco pode virar "tipo inválido".
  ['entrada_compra', 'saida_perda', 'inventario', 'entrada_ajuste', 'saida_ajuste']
    .forEach((t) => assert.ok(MOVEMENT_LABELS[t], `tipo ${t} continua válido`));
  eq(movementTypeLabel('entrada_compra'), 'Entrada por compra', 'rótulo legível');
});

test('quantidade-com-sinal-para-movimento-novo-e-antigo', () => {
  eq(signedQuantity({ quantity: 5, direction: 'entrada' }), 5, 'entrada nova');
  eq(signedQuantity({ quantity: 3, direction: 'saida' }), -3, 'saida nova');
  eq(signedQuantity({ quantity: 5, direction: 'saida' }), -5, 'magnitude com sinal forcado');
  eq(signedQuantity({ quantity: -3 }), -3, 'legado com sinal no quantity');
  eq(signedQuantity({ quantity: 4 }), 4, 'legado positivo');
  eq(signedQuantity({}), 0, 'vazio');
});

test('saldo-e-a-soma-das-movimentacoes-do-item', () => {
  const moves = [
    { inventory_item_id: 'i1', quantity: 10, direction: 'entrada' },
    { inventory_item_id: 'i1', quantity: 5, direction: 'entrada' },
    { inventory_item_id: 'i1', quantity: 3, direction: 'saida' },
    { inventory_item_id: 'i2', quantity: 99, direction: 'entrada' },
  ];
  eq(balanceFromMovements(moves, 'i1'), 12, '10 + 5 - 3');
  eq(balanceFromMovements(moves, 'i2'), 99, 'outro item nao interfere');
  eq(balanceFromMovements([], 'i1'), 0, 'sem movimentos');
});

// --------------------------------------------------------------------------
// FASE 17 — validações
// --------------------------------------------------------------------------
test('validacao-aceita-entrada-e-saida-normais', () => {
  eq(validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 5 }), 5, 'entrada');
  eq(validateMovement({ item, type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 3 }), 3, 'saida');
  eq(validateMovement({ item, type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 10 }), 10, 'saida de saldo exato');
});

test('validacao-bloqueia-quantidade-invalida', () => {
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 0 }), 'quantidade_nao_positiva', 'zero');
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: -5 }), 'quantidade_nao_positiva', 'negativo');
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 'abc' }), 'quantidade_invalida', 'texto');
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: null }), 'quantidade_invalida', 'nulo');
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: Infinity }), 'quantidade_invalida', 'infinito');
});

test('validacao-bloqueia-saldo-insuficiente', () => {
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 11 }), 'saldo_insuficiente', 'saida maior que saldo');
  eq(validateMovement({ item, type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 11, allowNegative: true }), 11, 'ajuste autorizado');
});

test('validacao-bloqueia-unidade-incompativel', () => {
  throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 1, unit: 'l' }), 'unidade_incompativel', 'kg vs l');
  eq(validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 1, unit: 'kg' }), 1, 'mesma unidade');
});

test('validacao-exige-item-e-tipo-conhecidos', () => {
  throws(() => validateMovement({ item: null, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 1 }), 'item_obrigatorio', 'sem item');
  throws(() => validateMovement({ item, type: 'tipo_inventado', quantity: 1 }), 'tipo_invalido', 'tipo desconhecido');
  assert.ok(new StockError('x') instanceof Error, 'StockError e Error');
});

test('custo-medio-recalculado-so-na-entrada-com-custo', () => {
  const r = costsAfter({ item: { current_stock: 10, average_cost: 4 }, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 10, unitCost: 6 });
  eq(r.average, 5, 'media ponderada');
  eq(r.last, 6, 'ultimo custo');
  const s = costsAfter({ item: { current_stock: 10, average_cost: 4 }, type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 5, unitCost: 9 });
  eq(s.average, 4, 'saida nao mexe no custo medio');
  const sem = costsAfter({ item: { current_stock: 10, average_cost: 4 }, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 5, unitCost: 0 });
  eq(sem.average, 4, 'entrada sem custo nao mexe no medio');
});

// --------------------------------------------------------------------------
// Garantias de fluxo (análise estática)
// --------------------------------------------------------------------------
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const estoque = read('../src/pages/Estoque.jsx');
const compras = read('../src/pages/Compras.jsx');
const financeiro = read('../src/pages/Financeiro.jsx');
const estoqueService = read('../src/lib/stockService.js');
const cloudDb = read('../src/lib/cloudDb.js');
const localDb = read('../src/lib/localDb.js');

test('estoque-tem-entrada-e-saida-nas-telas', () => {
  assert.match(estoque, /MOVEMENT_TYPES\.ENTRADA_MANUAL/, 'acao de entrada');
  assert.match(estoque, /MOVEMENT_TYPES\.SAIDA_MANUAL/, 'acao de saida');
});

test('so-o-servico-altera-o-saldo-do-estoque', () => {
  // Nenhuma tela pode GRAVAR current_stock direto no banco: passaria por cima
  // da movimentação e do controle de concorrência. (Usar o campo no estado
  // do formulário é normal; o que não pode é enviar no create/update.)
  [estoque, compras].forEach((src, i) => {
    const writes = /InventoryItem\.(create|update)\((?:[^()]|\([^()]*\))*current_stock\s*:/;
    assert.equal(writes.test(src), false, `pagina ${i} grava current_stock direto no banco`);
  });
  assert.match(estoqueService, /InventoryItem\.transact\(/, 'servico usa transacao');
  assert.match(estoqueService, /base44\.entities\.InventoryItem\.create\(\{ \.\.\.item, current_stock: 0 \}\)/, 'criacao comeca em zero');
});

test('recebimento-de-compra-e-protegido-contra-duplicidade', () => {
  assert.match(compras, /clientToken:\s*`compra:/, 'token por item da compra');
  assert.match(compras, /Purchase\.get\(purchase\.id\)/, 'rele do banco antes de postar');
  assert.match(compras, /stock_posted/, 'guarda stock_posted');
});

test('conferencia-de-producao-nunca-escreve-estoque', () => {
  // FASE 2A: abrir/visualizar a conferência não pode alterar nada.
  const dialog = read('../src/components/producao/ProductionConsumptionDialog.jsx');
  const forbids = [
    /entities\.(StockMovement|InventoryItem)/,
    /\.(create|update|delete|bulkCreate|deleteMany)\s*\(/,
    /fetch\s*\(/,
    /current_stock\s*:/,
  ].filter((r) => r.test(dialog));
  assert.deepEqual(forbids.map(String), [], 'conferencia de producao sem escrita');
});

test('gastos-usam-entrada-monetaria-com-virgula', () => {
  // Bug original: <Input type="number"> rejeita "25,50" e o valor virava 0.
  assert.match(financeiro, /<Field l="Valor \*"><CurrencyInput/, 'valor do gasto usa CurrencyInput');
  assert.doesNotMatch(financeiro, /<Field l="Valor \*"><Input type="number"/, 'sem input type=number no valor');
  assert.match(financeiro, /amount:\s*roundMoney\(amount\)/, 'persiste numerico');
});

test('gasto-tem-validacao-e-erro-visivel', () => {
  assert.match(financeiro, /amount<=0\)\s*return/, 'valor precisa ser maior que zero');
  assert.match(financeiro, /Number\.isFinite\(amount\)/, 'bloqueia NaN');
  assert.match(financeiro, /setError\(e\?\.message/, 'erro do banco aparece na tela');
});

test('gasto-e-cancelado-e-ao-vez-de-apagado', () => {
  assert.match(financeiro, /status:\s*'cancelado'/, 'cancelamento logico');
  assert.doesNotMatch(financeiro, /FinancialExpense\.delete\(/, 'nunca apaga o gasto');
});

test('ambos-os-bancos-tem-transact', () => {
  assert.match(cloudDb, /async transact\(/, 'cloudDb.transact');
  assert.match(cloudDb, /casPatchRow/, 'compare-and-swap na nuvem');
  assert.match(localDb, /async transact\(/, 'localDb.transact');
});

test('estoque-nao-engole-erro-de-carga', () => {
  // `.catch(()=>[])` na carga de itens/movimentacoes mascarava falha de banco.
  assert.doesNotMatch(estoque, /InventoryItem\.list\([^)]*\)\.catch/, 'carga de itens sem catch vazio');
  assert.doesNotMatch(estoque, /StockMovement\.list\([^)]*\)\.catch/, 'carga de movimentos sem catch vazio');
  assert.match(estoque, /loadError/, 'exibe erro de carga');
});

test('auditoria-registra-operacoes-de-estoque-e-gasto', () => {
  assert.match(estoqueService, /logAudit\(\{/, 'servico de estoque audita');
  assert.match(financeiro, /entity_type:\s*'FinancialExpense'[\s\S]{0,240}action:\s*'criacao'/, 'gasto criado e auditado');
  assert.match(financeiro, /action:\s*'alteracao'/, 'gasto editado e auditado');
  assert.match(financeiro, /action:\s*'exclusao_logica'/, 'gasto cancelado e auditado');
});

test('periodo-de-gastos-e-filtravel-pela-tela', () => {
  // Antes o período ficava travado em "início do mês → hoje", sem UI.
  assert.match(financeiro, /setStart\(e\.target\.value\)/, 'data inicial editavel');
  assert.match(financeiro, /setEnd\(e\.target\.value\)/, 'data final editavel');
});

let failures = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${name}: ${err.message}`);
  }
}
if (failures > 0) process.exit(1);
console.log(`ESTOQUE_GASTOS_OK ${cases.length}/${cases.length}`);

