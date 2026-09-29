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
//
// DENTRO do `stockService.js` a regra é mais estreita de propósito: ali
// `InventoryItem.update(...)` é legítimo para status e metadata (desativar,
// reativar). O que continua proibido é o update carregar SALDO — escrever
// `current_stock` fora de `transact()` é o que reconstrói a perda de
// atualização. "Update existe" não é erro; "update mexe em saldo" é.
//
// Limite conhecido, e é limite de análise por LINHA: este check não faz
// rastreamento de dado. Um saldo escondido atrás de spread entre duas
// variáveis (`const p = { current_stock: 1 }; update(id, { ...patch, ...p })`)
// não é visto. Quem fecha essa lacuna é o teste de comportamento
// (`scripts/test-stock.mjs`), não esta rede de segurança estática.
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'src');
const SERVICE = 'src/lib/stockService.js';

// Arquivo com autorização explícita para mexer no saldo — dentro dele vale a
// regra mais estreita descrita no cabeçalho, não a proibição total.
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
 * `InventoryItem.update(...)` carregando `current_stock` no objeto entregue.
 *
 * Vale dentro do stockService também. O patch costuma vir quebrado em várias
 * linhas, então a varredura acompanha os parênteses até a chamada fechar.
 *
 * Cobre também o patch montado ACIMA e entregue por nome
 * (`const patch = {...current_stock: 9}; update(id, patch)`). Aqui a janela é
 * cega de propósito: um `transact` na linha de cima é justamente o caminho
 * permitido da Fase 3 e NÃO pode virar falso positivo, então só conta quando o
 * argumento passado ao `update` tem uma DECLARAÇÃO com `current_stock` logo
 * acima. Passar `patch` sem declarar ali não prova nada.
 */
const JANELA = 4;

function updateTocaSaldo(linhas, i) {
  const linha = linhas[i];
  const abertura = linha.search(/\bInventoryItem\s*\.\s*update\s*\(/);
  if (abertura < 0) return false;
  const chamada = linha.slice(abertura);

  let profundidade = 0;
  for (let j = i; j < Math.min(i + JANELA, linhas.length); j += 1) {
    const trecho = j === i ? chamada : linhas[j];
    if (/(^|[^.\w])current_stock\s*:/.test(trecho)) return true;
    for (const ch of trecho) {
      if (ch === '(') profundidade += 1;
      else if (ch === ')') {
        profundidade -= 1;
        if (profundidade <= 0) break;
      }
    }
    if (profundidade <= 0) break;
  }

  const abre = chamada.indexOf('(');
  const fecha = chamada.indexOf(')', abre);
  if (abre < 0 || fecha < 0) return false;
  const nomes = chamada.slice(abre + 1, fecha).match(/[A-Za-z_$][\w$]*/g) || [];
  for (const nome of nomes) {
    const declaracao = new RegExp(
      `\\b(?:const|let|var)\\s+${nome}\\s*=\\s*\\{[^}]*\\bcurrent_stock\\s*:`,
    );
    for (let j = Math.max(0, i - JANELA); j < i; j += 1) {
      if (declaracao.test(linhas[j])) return true;
    }
  }
  return false;
}

/**
 * Aplica as REGRAS a um trecho e devolve as infrações encontradas.
 * Extraído como função para o autoteste do fim exercitá-lo diretamente.
 *
 * @param {boolean} dentroDoServico  aplica a regra de saldo sobre o
 *   `stockService.js`, em vez de proibir qualquer `update`/`transact`.
 */
function detecta(codigo, { dentroDoServico = false } = {}) {
  const problemas = [];
  const linhas = semRuido(codigo).split('\n');
  linhas.forEach((linha, i) => {
    const n = i + 1;
    if (dentroDoServico) {
      if (updateTocaSaldo(linhas, i)) problemas.push(`${n}: InventoryItem.update com current_stock`);
    } else {
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
  const dentroDoServico = rel === SERVICE;
  const bruto = readFileSync(abs, 'utf8');
  for (const p of detecta(bruto, { dentroDoServico })) {
    const [linha, regra] = [p.split(':')[0], p.split(': ')[1]];
    const onde = dentroDoServico
      ? 'no stockService — o saldo só muda dentro de transact()'
      : 'fora do stockService — o saldo só muda dentro de transact()';
    erros.push(`${rel}:${linha}  ${regra} ${onde}`);
  }
  if (dentroDoServico) continue;

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

  // Dentro do stockService a regra muda: `update` de status é legítimo, o que
  // é proibido é o update carregando saldo. Sem estes testes o check aceitaria
  // `InventoryItem.update(id, { current_stock: 10 })` e devolveria falsa
  // segurança justamente no arquivo onde a mutação de saldo é concentrada.
  const servico = { dentroDoServico: true };
  const violacoesServico = [
    ['update com saldo na mesma linha',
      'await InventoryItem.update(id, { current_stock: 10 });'],
    ['update com saldo em varias linhas',
      'await InventoryItem.update(id, {\n  status: "ativo",\n  current_stock: 10,\n});'],
    ['update dentro do servico fora do transact',
      'await InventoryItem.update(item.id, { ...patch, current_stock: next });'],
    ['atribuicao a current_stock no servico',
      'atual.current_stock = proximo;'],
    ['patch com saldo montado na linha de cima',
      'const patch = { ...itemDeletePatch(), current_stock: 999 };\nawait InventoryItem.update(atual.id, patch);'],
  ];
  const inocuosServico = [
    ['update so de status',
      "await InventoryItem.update(atual.id, { status: 'inativo' });"],
    ['update com patch de variavel',
      'await InventoryItem.update(atual.id, patch);'],
    ['saldo legitimo via transact (o caminho da Fase 3)',
      'const r = await InventoryItem.transact(\n  id,\n  (atual) => {\n    const next = atual.current_stock + 2;\n    return { current_stock: next };\n  },\n);'],
    ['create com saldo zerado (criarItemComEstoqueInicial)',
      'const criado = await InventoryItem.create({ ...item, current_stock: 0 });'],
    ['leitura de saldo no servico',
      'const current = roundQty(atual?.current_stock) || 0;'],
    ['status logo apos um transact que calcula saldo',
      'await InventoryItem.transact(id, (a) => ({ current_stock: a.current_stock + 2 }));\nawait InventoryItem.update(atual.id, patch);'],
  ];
  for (const [nome, codigo] of violacoesServico) {
    check(`detecta ${nome}`, detecta(codigo, servico).length > 0);
  }
  for (const [nome, codigo] of inocuosServico) {
    const achados = detecta(codigo, servico);
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
