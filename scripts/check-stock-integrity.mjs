// ---------------------------------------------------------------------------
// Check estático de integridade do estoque.
//
// A Fase 3 centralizou toda mutação de saldo no `src/lib/stockService.js`.
// Hoje isso é verdade por Acordo — hoje não é verdade por construção: um
// desenvolvedor pode voltar a chamar `InventoryItem.update(...)` ou escrever
// `current_stock` direto numa tela, reintroduzindo a perda de atualização
// (saldo 10, uma baixa 2 e outra 3, o banco fica com 7 ou 8) sem nada reclamar.
//
// Este script falha o CI/build quando isso acontece. É uma rede de segurança,
// não um substituto dos testes de comportamento (`scripts/test-stock.mjs`).
//
// O que NÃO é erro: ler `current_stock`, e criar item novo com saldo inicial
// (caminho agora centralizado em `criarItemComEstoqueInicial`).
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'src');
const SERVICE = 'src/lib/stockService.js';

// Arquivos que têm autorização explícita para tocar no saldo.
const AUTORIZADOS = new Set([SERVICE]);

const erros = [];
const avisos = [];

// Contador simples para o autoteste do fim do arquivo.
let autoOk = 0;
let autoFail = 0;
const check = (label, ok) => {
  if (ok) { autoOk += 1; console.log(`  ok   ${label}`); }
  else { autoFail += 1; console.log(`  FAIL ${label}`); }
};

/** Percorre src/ e devolve os arquivos .js/.jsx. */
function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) yield* arquivos(p);
    else if (/\.(js|jsx)$/.test(nome)) yield p;
  }
}

/** Remove strings, template literals e comentários antes de casar padrões. */
function semRuido(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => ' '.repeat(m.length))
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => ' '.repeat(m.length));
}

/**
 * Aplica as REGRAS a um trecho e devolve as infrações encontradas.
 * Extraído como função para o autoteste do fim exercitá-lo diretamente.
 */
function detecta(codigo) {
  const problemas = [];
  semRuido(codigo).split('\n').forEach((linha, i) => {
    const n = i + 1;
    if (/\bInventoryItem\s*\.\s*update\s*\(/.test(linha)) problemas.push(`${n}: InventoryItem.update`);
    if (/\bInventoryItem\s*\.\s*transact\s*\(/.test(linha)) problemas.push(`${n}: InventoryItem.transact`);
    if (/(^|[^.\w])current_stock\s*:/.test(linha)) {
      // Distingue PERSISTÊNCIA de VALOR DE CAMPO. Este projeto concentra
      // componentes inteiros numa linha, então a distinção é pela POSIÇÃO:
      // o `current_stock:` precisa estar dentro do objeto entregue à chamada
      // de escrita, não no objeto de estado do formulário.
      const idxEscrita = linha.search(
        /\.\s*(create|update|bulkCreate|upsert|patch)\s*\(|InventoryItem\s*\.\s*(transact|update)\s*\(/,
      );
      if (idxEscrita >= 0 && linha.indexOf('current_stock:') > idxEscrita) {
        problemas.push(`${n}: escrita de current_stock`);
      }
    }
    // Atribuição direta ao CAMPO de um registro (`item.current_stock = 10`).
    // Uma COMPARAÇÃO (`x.current_stock === 5`, `saldo = x.current_stock`) é
    // leitura e não pode ser accusation — por isso o alvo precisa ser
    // `algo.current_stock` SEM operador de comparação em seguida.
    if (/\.[\w.$[\]]*current_stock\s*=(?!=)/.test(linha)) {
      problemas.push(`${n}: atribuicao a current_stock`);
    }
  });
  return problemas;
}

for (const abs of arquivos(SRC)) {
  const rel = relative(REPO, abs).replaceAll('\\', '/');
  if (AUTORIZADOS.has(rel)) continue;
  const bruto = readFileSync(abs, 'utf8');
  for (const p of detecta(bruto)) {
    const [linha, regra] = [p.split(':')[0], p.split(': ')[1]];
    erros.push(`${rel}:${linha}  ${regra} fora do stockService — o saldo só muda dentro de transact()`);
  }

  // Sinal (nao falha): criacao de item com saldo preenchido. A lacuna que a
  // Fase 4 fechou; agora o caminho certo e `criarItemComEstoqueInicial`.
  if (/InventoryItem\s*\.\s*create\s*\(/.test(bruto) && /(^|[^.\w])current_stock\s*:/.test(semRuido(bruto))) {
    const n = semRuido(bruto).split('\n').findIndex((l) => /(^|[^.\w])current_stock\s*:/.test(l)) + 1;
    avisos.push(`${rel}:${n}  cria InventoryItem com current_stock — prefira criarItemComEstoqueInicial() para registrar a entrada no historico`);
  }
}

// ---------------------------------------------------------------------------
const out = [];
out.push('=== check-stock-integrity ===');
out.push('');
out.push('Proibido fora de src/lib/stockService.js:');
out.push('  - InventoryItem.update(...)');
out.push('  - InventoryItem.transact(...)');
out.push('  - escrita/atribuicao de current_stock');
out.push('');
out.push('Permitido: leitura de current_stock; o proprio stockService;');
out.push('scripts/ (o harness de teste simula o banco de proposito).');
out.push('');
if (avisos.length) {
  out.push('AVISOS (nao falham o check):');
  for (const a of avisos) out.push(`  - ${a}`);
  out.push('');
}
if (erros.length) {
  out.push(`FALHAS (${erros.length}):`);
  for (const e of erros) out.push(`  [ERRO] ${e}`);
  out.push('');
  out.push('STOCK_INTEGRITY_FALHOU');
} else {
  out.push('Nenhuma mutacao indevida de saldo fora do stockService.');
  out.push('STOCK_INTEGRITY_OK');
}

// Autoteste: as MESMAS regras aplicadas a violações sintéticas. Um check que
// nunca acusa nada é pior que nenhum check — daria falsa segurança.
console.log('\nAutoteste (violacoes sinteticas devem ser acusadas):');
{
  const violacoes = [
    ['InventoryItem.update(...)',
      'const x = await base44.entities.InventoryItem.update(id, { current_stock: 10 });'],
    ['InventoryItem.transact fora do servico',
      'const y = await base44.entities.InventoryItem.transact(id, (r) => ({ current_stock: 1 }));'],
    ['current_stock em create',
      'await base44.entities.InventoryItem.create({ name: "X", current_stock: 50 });'],
    ['atribuicao direta', 'item.current_stock = 10;'],
  ];
  const inocuos = [
    ['leitura no filtro', 'const low = items.filter((x) => x.current_stock <= 5);'],
    ['leitura na tabela', '<td>{Number(x.current_stock || 0).toLocaleString("pt-BR")}</td>'],
    ['valor de campo em form', 'const empty = { name: "", current_stock: 0, unit: "un" };'],
    ['estado do formulario', "setF({ ...emptyItem, current_stock: Number(item.current_stock || 0) });"],
  ];
  for (const [nome, codigo] of violacoes) check(`detecta ${nome}`, detecta(codigo).length > 0);
  for (const [nome, codigo] of inocuos) {
    const achados = detecta(codigo);
    check(`nao acusa ${nome}`, achados.length === 0, achados.join(' | '));
  }
}

console.log(`\nAutoteste: ${autoOk} ok, ${autoFail} falhas`);

const texto = out.join('\n');
console.log(`\n${texto}`);
try {
  writeFileSync(join(REPO, 'scripts', 'check-stock-integrity.out.txt'), `${texto}\n`, 'utf8');
} catch { /* o relatório é acessório; não vale falhar por causa dele */ }

process.exit(erros.length || autoFail ? 1 : 0);
