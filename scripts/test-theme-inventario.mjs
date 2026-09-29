// INVENTARIO ESTATICO de superficies do modo escuro.
//
// Por que este arquivo existe
// --------------------------
// Os testes anteriores conferiam TOKENS: "todo token de cor tem variante
// escura?". Isso passou em 38/38 e mesmo assim a interface ainda tinha partes
// brancas. A razao: existem tres formas de superficie clara que nenhum teste
// anterior via:
//
//   1. CLASSES DE FAMILIA NAO MAPEADA — `bg-rose-50` numa badge de status. O
//      remapeamento central cobre slate/white/vermelho/verde/ambar; rose, sky,
//      violet, orange e indigo simplesmente nao estavam na lista.
//   2. MODIFICADOR DE OPACIDADE — `bg-amber-50/50` compila para um nome de
//      classe PROPRIO (a barra entra no nome), entao a regra `.bg-amber-50` nao
//      a alcanca. Era o `bg-white/80` do Topbar.
//   3. SUPERFICIE FIXA — `bg-black/40` de overlay, legenda de grafico. Legitimo
//      nos dois temas, mas precisa estar DECLARADO como tal, nao ser acaso.
//
// Este teste varre o codigo inteiro, extrai as classes de cor e exige que cada
// uma esteja coberta pelo dark OU esteja numa allowlist justificada. A
// allowlist e por CLASS E COM MOTIVO — nunca uma regra frouxa que deixe passar
// qualquer coisa.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const css = await read('src/index.css');
const cssLimpo = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Classes que NAO sao cor e por isso nao entram no inventario. */
const NEUTRAS = /^(transparent|current|inherit|none)$/;

/** Tokens do tema: ja adaptam sozinhos, nao precisam de regra .dark. */
const TOKENS = /^(background|foreground|card|popover|primary|secondary|muted|accent|destructive|border|input|ring|sidebar|cash|chart-\d)$/;

function padrao(peca) {
  return new RegExp(`\\.dark \\.${peca.replace(/\//g, '\\\\/')}(?![\\w-])`);
}

/** Extrai classes de cor de um arquivo. */
function classesDeCor(fonte) {
  const encontradas = new Set();
  // bg-, text- e border- seguidos de familia + numero (+ opacidade opcional).
  for (const m of fonte.matchAll(/\b(bg|text|border)-([a-z]+)-(\d{2,3})(\/\d+)?\b/g)) {
    const [, peca, familia, numero, alfa] = m;
    if (familia === 'white' || familia === 'black') { encontradas.add(`${peca}-${familia}${alfa || ''}`); continue; }
    if (TOKENS.test(familia)) continue;
    if (NEUTRAS.test(familia)) continue;
    encontradas.add(`${peca}-${familia}-${numero}${alfa || ''}`);
  }
  return [...encontradas];
}

async function jsxEm(diretorio) {
  const achados = [];
  for (const entrada of await readdir(abs(diretorio), { withFileTypes: true })) {
    const caminho = `${diretorio}/${entrada.name}`;
    if (entrada.isDirectory()) achados.push(...await jsxEm(caminho));
    else if (entrada.name.endsWith('.jsx')) achados.push(caminho);
  }
  return achados;
}

/**
 * Allowlist EXPLICITA, com justificativa VERIFICADA.
 *
 * Nao basta listar a classe: cada entrada precisa encontrar, no MESMO arquivo,
 * o contexto que torna a cor fixa legitima. Se o contexto sumir, a allowlist
 * passa a mentir e o teste falha. E uma regra por PADRÃO, nunca "deixa passar".
 */
const FIXAS_COM_JUSTIFICATIVA = [
  {
    classe: 'bg-black/40', arquivo: 'src/components/financeiro/DailyExpenseHistory.jsx',
    contexto: /fixed inset-0[\s\S]{0,80}bg-black\/40/, motivo: 'cortina de modal de detalhe',
  },
  {
    classe: 'bg-black/80', arquivo: 'src/components/ui',
    contexto: /fixed inset-0[\s\S]{0,80}bg-black\/80/, motivo: 'cortina de dialog/sheet/drawer',
  },
  {
    // Texto quase preto SOBRE o gradiente ambar da marca. A superficie e
    // colorida e fixa nos dois temas; o que mudaria e a marca.
    classe: 'text-slate-950', arquivo: 'src/components/Sidebar.jsx',
    contexto: /from-amber-400 to-amber-600/, motivo: 'icone da logo sobre o gradiente ambar',
  },
  {
    // Hover do botao fechar do toast destrutivo: quase branco sobre vermelho.
    classe: 'text-red-50', arquivo: 'src/components/ui/toast.jsx',
    contexto: /group-\[\.destructive\]/, motivo: 'hover sobre fundo destrutivo',
  },
];

/** Fundos inline permitidos: a cor e o dado, nao a decoracao. */
const INLINE_PERMITIDOS = [
  {
    arquivo: 'src/components/ui/chart.jsx',
    contexto: /backgroundColor: item\.color/, motivo: 'cor da serie do grafico',
  },
];

test('1. nenhuma classe de cor fica sem cobertura no dark', async () => {
  const arquivos = await jsxEm('src');
  const semCobertura = new Map();
  for (const arquivo of arquivos) {
    const fonte = await read(arquivo);
    // A superficie light-only e a excecao documentada: ela NAO deve seguir o
    // tema. Se o arquivo a marca, pulamos a checagem dele.
    if (/theme-static-light/.test(fonte)) continue;
    for (const classe of classesDeCor(fonte)) {
      if (padrao(classe).test(cssLimpo)) continue;
      if (FIXAS_COM_JUSTIFICATIVA.some(f => f.classe === classe)) continue;
      if (!semCobertura.has(classe)) semCobertura.set(classe, []);
      semCobertura.get(classe).push(arquivo);
    }
  }
  const detalhes = [...semCobertura].map(([c, fs]) => `${c} (${fs.length}x, ex.: ${fs[0]})`);
  assert.deepEqual(detalhes, [], `classes de cor SEM variante escura:\n    ${detalhes.join('\n    ')}`);
});

test('2. a allowlist de fixas tem justificativa verificavel no codigo', async () => {
  // Cada cor fixa so e aceita se o contexto que a justifica existir de fato.
  for (const { classe, arquivo, contexto, motivo } of FIXAS_COM_JUSTIFICATIVA) {
    let ok = false;
    for (const alvo of await jsxEm('src')) {
      if (!alvo.includes(arquivo)) continue;
      const fonte = await read(alvo);
      if (fonte.includes(classe) && contexto.test(fonte)) { ok = true; break; }
    }
    assert.equal(ok, true, `allowlist mente: ${classe} sem o contexto que a justifica (${motivo})`);
  }
});

test('3. bg-black so aparece como overlay, nunca como superficie de conteudo', async () => {
  // Um `bg-black` solto seria um buraco no dark. O aceitavel e a cortina.
  for (const arquivo of await jsxEm('src')) {
    const fonte = await read(arquivo);
    for (const linha of fonte.split('\n')) {
      if (!/bg-black/.test(linha)) continue;
      assert.ok(/\/(40|50|60|70|80|90)\b/.test(linha), `${arquivo}: bg-black sem opacidade de cortina`);
    }
  }
});

test('4. as familias nao mapeadas agora estao cobertas', async () => {
  // Regressao direta do bug da screenshot: rose, sky, violet, orange, indigo.
  for (const familia of ['rose', 'sky', 'violet', 'orange', 'indigo']) {
    assert.ok(new RegExp(`\\.dark \\.bg-${familia}-`).test(cssLimpo), `familia ${familia} segue sem cobertura`);
  }
});

test('5. modificador de opacidade nao escapa mais', () => {
  // A barra entra no nome da classe, entao precisa de regra propria.
  for (const classe of ['bg-slate-50/60', 'bg-slate-950/45', 'bg-amber-50/50', 'bg-amber-50/40', 'bg-rose-50/40', 'bg-amber-500/15', 'bg-white/80']) {
    assert.ok(padrao(classe).test(cssLimpo), `${classe} escapa do remapeamento`);
  }
});

test('6. componentes base de UI nao tem cor fixa', async () => {
  // Correcao em componente base resolve varias telas: nenhum deles pode bringar
  // fundo ou texto fixo, senao todo mundo que o usa nasce claro.
  const arquivos = await jsxEm('src/components/ui');
  const infratores = [];
  for (const arquivo of arquivos) {
    const fonte = await read(arquivo);
    if (/bg-white|text-black/.test(fonte)) infratores.push(`${arquivo} (classe fixa)`);
    // Fundo inline so e aceito com a justificativa verificada.
    for (const p of INLINE_PERMITIDOS) {
      if (arquivo.endsWith(p.arquivo) && p.contexto.test(fonte)) continue;
    }
    if (/backgroundColor\s*:/.test(fonte) && !INLINE_PERMITIDOS.some(p => arquivo.endsWith(p.arquivo) && p.contexto.test(fonte))) {
      infratores.push(`${arquivo} (fundo inline)`);
    }
  }
  assert.deepEqual(infratores, [], `componentes base com cor fixa: ${infratores.join(', ')}`);
});

test('7. os portais (Radix) usam tokens, e nao superficie fixa', async () => {
  // Dialog, popover, select, dropdown, sheet e drawer sao renderizados FORA da
  // arvore visual. Se algum deles fixar branco, o modal abre claro no dark.
  const portais = ['dialog', 'popover', 'select', 'dropdown-menu', 'sheet', 'drawer', 'command', 'calendar', 'alert-dialog'];
  for (const nome of portais) {
    const fonte = await read(`src/components/ui/${nome}.jsx`);
    const usaToken = /bg-(popover|background|card|muted|accent)/.test(fonte);
    assert.ok(usaToken, `${nome} nao usa superficie por token`);
    assert.ok(!/bg-white/.test(fonte), `${nome} fixa branco`);
  }
});

test('8. nenhum fundo inline claro em interface normal', async () => {
  // Nao basta "branco": QUALQUER fundo inline sem par no dark e suspect.
  const infratores = [];
  for (const arquivo of await jsxEm('src')) {
    const fonte = await read(arquivo);
    if (/theme-static-light/.test(fonte)) continue;
    for (const linha of fonte.split('\n')) {
      if (!/backgroundColor\s*:/.test(linha)) continue;
      const permitido = INLINE_PERMITIDOS.some(p => arquivo.endsWith(p.arquivo) && p.contexto.test(linha));
      if (!permitido) infratores.push(`${arquivo}: ${linha.trim().slice(0, 70)}`);
    }
  }
  assert.deepEqual(infratores, [], `fundo inline sem par dark: ${infratores.join(' | ')}`);
});

test('9. os mapas de status das telas usam classes cobertas', async () => {
  // Mapas como DAY_TYPE_STYLE e STATUS_STYLES montam classes por concatenacao
  // logica; a analise por arquivo so nao os veria. Aqui eles sao auditados.
  const alvos = [
    'src/components/escala/EscalaDiaria.jsx',
    'src/components/escala/EscalaSemanal.jsx',
    'src/components/financeiro/FechamentoCaixaPanel.jsx',
  ];
  for (const arquivo of alvos) {
    const fonte = await read(arquivo);
    for (const classe of classesDeCor(fonte)) {
      assert.ok(padrao(classe).test(cssLimpo), `${arquivo}: mapa usa ${classe}, sem cobertura`);
    }
  }
});

test('10. o Dashboard nao tem superficie clara', async () => {
  // A tela da screenshot. Toda classe de cor do arquivo precisa estar coberta.
  const fonte = await read('src/pages/Home.jsx');
  const semCobertura = classesDeCor(fonte).filter(c => !padrao(c).test(cssLimpo));
  assert.deepEqual(semCobertura, [], `Home.jsx sem cobertura: ${semCobertura.join(', ')}`);
});
