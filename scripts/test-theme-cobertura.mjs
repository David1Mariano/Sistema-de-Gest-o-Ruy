// Testes de COBERTURA de superficie escura.
//
// O primeiro bug de dark mode nao foi no mecanismo, e sim de COBERTURA: a
// familia `cash` usa HEX, nao HSL, entao ESCAPAVA do remapeamento central, que
// so alcanca utilitarios do Tailwind. O bloco Caixas & Delivery continuava com
// `--cash-card: #FFFFFF` e `--cash-text: #0F172A`.
//
// Estes testes existem para a classe inteira de bug: "token de cor sem variante
// escura". Nao basta contar `bg-white` — varias ocorrencias sao legitimas.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const css = await read('src/index.css');
// A folha tem comentários que CITAM os tokens antigos ao explicar o bug —
// "antes era --cash-card: #FFFFFF". Conferir sobre o CSS cru transformaria
// comentário em falha. As regras sao o que importa.
const cssSemComentario = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Tokens que NAO precisam de variante escura: nao sao cor. */
const NAO_SAO_COR = new Set(['font-body', 'font-display', 'font-heading', 'font-mono', 'radius', 'background', 'foreground']);

function tokens(trecho) {
  return new Set([...trecho.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1].slice(2)));
}

function blocoDe(ancora) {
  // Corta sempre da folha sem comentários, para que o texto que explica o
  // token não conte como se fosse o token.
  const i = cssSemComentario.indexOf(ancora);
  if (i < 0) return '';
  const abre = cssSemComentario.indexOf('{', i);
  let profundidade = 0;
  for (let j = abre; j < cssSemComentario.length; j += 1) {
    if (cssSemComentario[j] === '{') profundidade += 1;
    else if (cssSemComentario[j] === '}') { profundidade -= 1; if (profundidade === 0) return cssSemComentario.slice(i, j + 1); }
  }
  return '';
}

const RAIZ = blocoDe(':root {');
const DARK = blocoDe('.dark {');
const IMPRESSAO = blocoDe('@media print {');

/** Lista recursiva de .jsx sob um diretorio. */
async function jsxEm(diretorio) {
  const achados = [];
  for (const entrada of await readdir(abs(diretorio), { withFileTypes: true })) {
    const caminho = `${diretorio}/${entrada.name}`;
    if (entrada.isDirectory()) achados.push(...await jsxEm(caminho));
    else if (entrada.name.endsWith('.jsx')) achados.push(caminho);
  }
  return achados;
}

test('1. TODO token de cor tem variante escura', () => {
  // Este e o teste que teria pegado o bug original.
  const semEscuro = [...tokens(RAIZ)].filter(t => !NAO_SAO_COR.has(t) && !tokens(DARK).has(t));
  assert.deepEqual(semEscuro, [], `tokens de cor sem variante escura: ${semEscuro.join(', ')}`);
});

test('2. a familia cash tem os 8 tokens definidos no dark', () => {
  for (const t of ['cash-surface', 'cash-card', 'cash-text', 'cash-secondary', 'cash-border', 'cash-primary', 'cash-positive', 'cash-alert']) {
    assert.match(DARK, new RegExp(`--${t}:`), `--${t} ausente no dark`);
  }
});

test('3. no dark, nenhum cash-* continua sendo branco ou quase-preto', () => {
  // A falha original: card #FFFFFF e texto #0F172A dentro do modo escuro.
  assert.ok(!/--cash-card:\s*#FFFFFF/i.test(DARK), 'card branco no dark');
  assert.ok(!/--cash-surface:\s*#F/i.test(DARK), 'surface clara no dark');
  assert.ok(!/--cash-text:\s*#0/i.test(DARK), 'texto quase preto no dark');
  // E a hierarquia existe: surface mais escura que card.
  const surface = DARK.match(/--cash-surface:\s*(#[0-9A-Fa-f]{6})/)[1];
  const card = DARK.match(/--cash-card:\s*(#[0-9A-Fa-f]{6})/)[1];
  const lum = hex => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255);
  };
  assert.ok(lum(card) > lum(surface), 'card precisa ser mais claro que a surface, para dar separacao');
  // Texto claro sobre card escuro: contraste alto.
  const texto = DARK.match(/--cash-text:\s*(#[0-9A-Fa-f]{6})/)[1];
  assert.ok(lum(texto) > lum(card) * 2, 'texto do cash precisa ter contraste sobre o card');
});

test('4. as cores semanticas do cash continuam sendo as familias certas', () => {
  // Verde segue sucesso, vermelho segue alerta, indigo segue acao. So o nivel
  // muda; o matiz nao pode virar cinza.
  const matiz = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  const dominante = hex => {
    const [r, g, b] = matiz(hex);
    if (g > r && g > b) return 'verde';
    if (r > g && r > b) return 'vermelho';
    if (b > r && b > g) return 'azul/indigo';
    return 'neutro';
  };
  assert.equal(dominante(DARK.match(/--cash-positive:\s*(#[0-9A-Fa-f]{6})/)[1]), 'verde');
  assert.equal(dominante(DARK.match(/--cash-alert:\s*(#[0-9A-Fa-f]{6})/)[1]), 'vermelho');
  assert.equal(dominante(DARK.match(/--cash-primary:\s*(#[0-9A-Fa-f]{6})/)[1]), 'azul/indigo');
});

test('5. o modo claro nao foi tocado: cash-* continua com os valores originais', () => {
  for (const [nome, valor] of [
    ['cash-surface', '#F8FAFC'], ['cash-card', '#FFFFFF'], ['cash-text', '#0F172A'],
    ['cash-secondary', '#64748B'], ['cash-border', '#E2E8F0'],
    ['cash-primary', '#4F46E5'], ['cash-positive', '#059669'], ['cash-alert', '#DC2626'],
  ]) {
    assert.ok(RAIZ.includes(`--${nome}: ${valor}`), `--${nome} claro mudou`);
  }
});

test('6. impressao devolve o cash ao claro', async () => {
  // Sem isso, o relatorio do bloco sairia com card escuro no papel.
  assert.ok(IMPRESSAO.includes('--cash-card: #FFFFFF'), 'impressao precisa bringar o cash-card ao claro');
  assert.ok(IMPRESSAO.includes('--cash-text: #0F172A'));
  assert.ok(IMPRESSAO.includes('--cash-surface: #F8FAFC'));
  // ...e a regra forte de impressao continua la.
  assert.match(IMPRESSAO, /background-color: #ffffff !important/);
});

test('7. o bloco Caixas & Delivery usa tokens, e nao superficie fixa', async () => {
  // O painel e o bloco que a screenshot mostrou. Nenhum dos dois pode declarar
  // branco proprio: tem de passar pelo token.
  const painel = await read('src/components/financeiro/CashMovementPanel.jsx');
  assert.match(painel, /bg-cash-surface/);
  assert.ok(!/bg-white|background:\s*white|backgroundColor:\s*'#?fff/i.test(painel),
    'o painel nao pode fixar superficie branca');
});

test('8. os componentes do bloco cash nao fixam branco', async () => {
  // Correcao no token cobre todos de uma vez. Este teste trava essa cobertura:
  // se alguem reintroduzir branco direto num deles, falha aqui.
  // A varredura e por TODO o src/components, e nao so por financeiro: um dos
  // consumidores mora em components/direcao, e foi por olhar de menos que
  // ele passaria despercebido.
  const arquivos = await jsxEm('src/components');
  const comCash = [];
  for (const arquivo of arquivos) {
    const fonte = await read(arquivo);
    if (/-cash-|text-cash|bg-cash/.test(fonte)) comCash.push([arquivo, fonte]);
  }
  assert.ok(comCash.length >= 6, `esperados 6+ consumidores de cash, achados ${comCash.length}`);
  for (const [arquivo, fonte] of comCash) {
    // Branco fixo e proibido: superficie estrutural passa pelo token.
    const brancoFixo = /bg-white|background:\s*white|backgroundColor:\s*'#?fff/i.test(fonte);
    // A excecao documentada e a superficie light-only, que o Agente 1 audita.
    const lightOnly = /theme-static-light/.test(fonte);
    assert.ok(lightOnly || !brancoFixo, `${arquivo} fixa branco sem ser light-only`);
  }
});

test('9. nenhum componente do sistema fixa branco inline fora de light-only', async () => {
  // Varredura ampla: pega o mesmo defeito em qualquer tela, nao so no Dashboard.
  const arquivos = await jsxEm('src');
  const infratores = [];
  for (const arquivo of arquivos) {
    const fonte = await read(arquivo);
    if (/backgroundColor:\s*['"]#(fff|FFFFFF)['"]|background:\s*['"]white['"]/.test(fonte) && !/theme-static-light/.test(fonte)) {
      infratores.push(arquivo);
    }
  }
  assert.deepEqual(infratores, [], `branco inline fora de light-only: ${infratores.join(', ')}`);
});

test('10. o remapeamento central e a familia cash sao caminhos independentes', () => {
  // Cash nao passa pelo remapeamento: ele nao e utilitario do Tailwind. Por isso
  // precisa da variante propria. Este teste impede que alguem remova uma das
  // duas metades achando que a outra cobre.
  const remap = css.slice(css.indexOf('.dark .bg-white {'), css.indexOf('.dark .theme-static-light,'));
  assert.ok(!remap.includes('cash'), 'remapeamento nao deve tentar tratar cash');
  assert.ok(DARK.includes('--cash-card:'), 'cash precisa da variante propria no .dark');
});
