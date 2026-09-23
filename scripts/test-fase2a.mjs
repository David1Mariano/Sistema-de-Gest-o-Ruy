import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { computeConsumption, findInventoryItem, stockStatus } from '../src/lib/consumptionCalc.js';

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}
function expectEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: esperado=${expected} recebido=${actual}`);
}

const product = { id: 'p1', name: 'Coxinha', yield_quantity: 100, yield_unit: 'un' };
const ingredients = [
  { product_id: 'p1', inventory_item_id: 'i1', inventory_item_name: 'Frango', quantity: 3, unit: 'kg' },
  { product_id: 'p1', inventory_item_id: 'i2', inventory_item_name: 'Catupiry', quantity: 1.5, unit: 'kg' },
  { product_id: 'p1', inventory_item_id: 'i3', inventory_item_name: 'Farinha', quantity: 2, unit: 'kg' },
];
const inventory = [
  { id: 'i1', name: 'Frango', unit: 'kg', current_stock: 18 },
  { id: 'i2', name: 'Catupiry', unit: 'kg', current_stock: 5 },
  { id: 'i3', name: 'Farinha', unit: 'kg', current_stock: 1 },
];

test('proporcao-100-para-100', () => {
  const calc = computeConsumption({ record: { produced_quantity: 100 }, product, ingredients });
  expectEqual(calc.state, 'ok', 'estado');
  expectEqual(calc.rows[0].needed, 3, 'frango');
  expectEqual(calc.rows[1].needed, 1.5, 'catupiry');
  expectEqual(calc.rows[2].needed, 2, 'farinha');
});

test('proporcao-200-para-100', () => {
  const calc = computeConsumption({ record: { produced_quantity: 200 }, product, ingredients });
  expectEqual(calc.state, 'ok', 'estado');
  expectEqual(calc.rows[0].needed, 6, 'frango');
  expectEqual(calc.rows[1].needed, 3, 'catupiry');
  expectEqual(calc.rows[2].needed, 4, 'farinha');
});

test('quantidade-fracionada', () => {
  const calc = computeConsumption({ record: { produced_quantity: 37.5 }, product, ingredients });
  expectEqual(calc.state, 'ok', 'estado');
  expectEqual(calc.rows[0].needed, 1.125, 'frango fracionado');
});

test('produto-sem-ficha', () => {
  const calc = computeConsumption({
    record: { produced_quantity: 10 },
    product: { id: 'x', name: 'Sem ficha' },
    ingredients: [],
  });
  expectEqual(calc.state, 'no-recipe', 'estado');
});

test('rendimento-invalido', () => {
  const noYield = computeConsumption({
    record: { produced_quantity: 10 },
    product: { id: 'x', name: 'Sem rendimento', yield_quantity: 0 },
    ingredients,
  });
  expectEqual(noYield.state, 'bad-yield', 'zero');
  const missingYield = computeConsumption({
    record: { produced_quantity: 10 },
    product: { id: 'x', name: 'Sem rendimento' },
    ingredients,
  });
  expectEqual(missingYield.state, 'bad-yield', 'ausente');
});

test('estoque-comparacao', () => {
  expectEqual(stockStatus({ needed: 3, inventoryItem: inventory[0] }), 'available', 'suficiente');
  expectEqual(stockStatus({ needed: 2, inventoryItem: inventory[2] }), 'insufficient', 'insuficiente');
  expectEqual(stockStatus({ needed: 1, inventoryItem: null }), 'missing', 'ausente');
  expectEqual(findInventoryItem(inventory, 'desconhecido'), null, 'item inexistente');
});

// Teste estático de segurança da Fase 2A: a conferência não pode ganhar
// acesso de escrita de estoque, mesmo por engano, sem este teste quebrar.
test('dialogo-nunca-escreve-estoque', () => {
  const dialog = readFileSync(
    new URL('../src/components/producao/ProductionConsumptionDialog.jsx', import.meta.url),
    'utf8'
  );
  const forbids = [
    'entities.StockMovement',
    'entities.InventoryItem',
    'current_stock:',
    'StockMovement.create',
    'StockMovement.update',
    'StockMovement.delete',
    '.bulkCreate(',
    '.deleteMany(',
  ].filter((needle) => dialog.includes(needle));
  assert.deepEqual(forbids, [], `trechos proibidos encontrados: ${forbids.join(', ')}`);
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
console.log(`FASE2A_OK ${cases.length}/${cases.length}`);
