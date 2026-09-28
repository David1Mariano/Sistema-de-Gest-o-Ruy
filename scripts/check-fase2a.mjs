import { readFileSync } from 'node:fs';

const log = [];
let failures = 0;

function check(name, fn) {
  try {
    fn();
    log.push(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    log.push(`FAIL ${name}: ${err.message}`);
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: esperado=${expected} recebido=${actual}`);
  }
}

// Teste estático: a Fase 2A não pode introduzir escrita de estoque, mesmo
// que futura baixa seja implementada sem revisão cuidadosa.
const dialogSource = readFileSync(
  new URL('../src/components/producao/ProductionConsumptionDialog.jsx', import.meta.url),
  'utf8'
);
const pageSource = readFileSync(
  new URL('../src/pages/Producao.jsx', import.meta.url),
  'utf8'
);
const tableSource = readFileSync(
  new URL('../src/components/producao/DailyProductionTable.jsx', import.meta.url),
  'utf8'
);

// Teste estático: a Fase 2A não pode introduzir escrita de estoque, mesmo
// que futura baixa seja implementada sem revisão cuidadosa.
//
// A conferência LER `current_stock` para mostrar o saldo atual — isso é
// permitido. O proibido é GRAVAR (atribuição `current_stock:`) ou chamar
// qualquer entidade/método de escrita. Antes, o padrão `/current_stock/`
// acusava a leitura e o check falhava mesmo com a Fase 2A correta.
const dialogHasWriteAccess =
  /entities\.(StockMovement|InventoryItem)/.test(dialogSource) ||
  /current_stock\s*:/.test(dialogSource) ||
  /\btransact\s*\(/.test(dialogSource) ||
  /\.(create|update|delete|bulkCreate|deleteMany)\s*\(/.test(dialogSource) ||
  /fetch\s*\(/.test(dialogSource);

check('dialogo-consulta-sem-escrita', () => {
  expectEqual(dialogHasWriteAccess, false, 'dialogo de conferência');
});

// A ação "Conferir consumo" só repassa o registro já salvo; não persiste nada.
const reviewPaths = [pageSource, tableSource].join('\n');
const persistsOnReview =
  /StockMovement/.test(reviewPaths) ||
  /current_stock\s*:/.test(reviewPaths) ||
  (/DailyProduction\.(create|update|delete)/.test(tableSource) &&
    !/onEdit|onDelete/.test(tableSource));

check('acao-conferir-sem-persistencia', () => {
  expectEqual(persistsOnReview, false, 'abrir/fechar conferência');
});

console.log(log.join('\n'));
if (failures > 0) process.exit(1);
console.log('FASE2A_STATIC_OK');
