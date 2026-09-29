// Testes das correções de SUPERFÍCIE (a cobertura que faltava no dark mode).
//
// O remapeamento central estava correto, mas as superfícies que DEVEM ficar
// claras não existiam como marcação: comprovante, botão de impressão e paleta
// de gráfico. Aqui a classe de escape é testada onde ela é USADA, não apenas
// onde está definida.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const css = await read('src/index.css');
const cssLimpo = css.replace(/\/\*[\s\S]*?\*\//g, '');
const preview = await read('src/components/rh/AttachmentPreview.jsx');
const relatorios = await read('src/pages/Relatorios.jsx');

function blocoDe(ancora, fonte = cssLimpo) {
  const i = fonte.indexOf(ancora);
  if (i < 0) return '';
  const abre = fonte.indexOf('{', i);
  let p = 0;
  for (let j = abre; j < fonte.length; j += 1) {
    if (fonte[j] === '{') p += 1;
    else if (fonte[j] === '}') { p -= 1; if (p === 0) return fonte.slice(i, j + 1); }
  }
  return '';
}

// O `>` das arrow functions (`onChange={(e)=>setX(...)}`) aparece ANTES do
// fechamento da tag, então `[^>]*` nunca alcança o className. A tag é cortada
// no próximo `<`.
const tagsDeInput = fonte =>
  [...fonte.matchAll(/<(?:input|select)\b[\s\S]*?(?=<)[\s\S]*?>/g)].map(m => m[0]);

// --- 1, 2, 3: comprovante ------------------------------------------------

test('1. AttachmentPreview marca a superfície de mídia como light-only', () => {
  assert.match(preview, /theme-static-light-surface/, 'a classe é aplicada no preview');
  const usos = preview.match(/theme-static-light-surface/g) || [];
  assert.ok(usos.length >= 2, 'usada no PDF e na imagem');
});

test('2. o Dialog inteiro NÃO é posto em branco', () => {
  // A variante ampla pinta os descendentes; ela não pode aparecer aqui.
  assert.doesNotMatch(preview, /theme-static-light(?!-surface)/, 'sem a variante ampla no preview');
  const dialog = preview.match(/<DialogContent[^>]*>/)?.[0] || '';
  assert.doesNotMatch(dialog, /theme-static-light/, 'DialogContent fica no tema');
});

test('3. PDF/iframe não herda color-scheme dark e a imagem tem fundo claro', () => {
  const superficie = blocoDe('.dark .theme-static-light-surface {');
  assert.match(superficie, /color-scheme:\s*light/, 'color-scheme light declarado');
  assert.match(superficie, /background-color:\s*#ffffff/, 'fundo branco previsível');
  const filhos = blocoDe('.dark .theme-static-light-surface img,');
  assert.match(filhos, /img/, 'img coberto');
  assert.match(filhos, /iframe/, 'iframe coberto');
  assert.match(filhos, /color-scheme:\s*light/, 'filhos também em light');
  const trecho = preview.match(/application\/pdf[\s\S]{0,400}?iframe/);
  assert.ok(trecho, 'iframe de PDF existe');
  assert.match(trecho[0], /theme-static-light-surface/, 'o iframe está dentro da superfície');
});

test('3b. a superfície cirúrgica NÃO pinta os descendentes', () => {
  // O que torna a nova variante segura: a ampla tem o seletor `*`, a nova não.
  const ampla = blocoDe('.dark .theme-static-light,');
  assert.match(ampla, /\.dark \.theme-static-light \*/, 'a ampla pinta tudo de propósito');
  const cirugica = blocoDe('.dark .theme-static-light-surface {');
  assert.doesNotMatch(cirugica, /theme-static-light-surface \*/, 'a cirúrgica não usa seletor universal');
});

// --- 4: impressão -------------------------------------------------------

test('4. o botão Exportar/Imprimir não aparece na impressão', () => {
  const botao = relatorios.match(/<button\b[\s\S]*?window\.print\(\)[\s\S]*?(?=<)[\s\S]*?>/)?.[0] || '';
  assert.ok(botao, 'botão de impressão localizado');
  assert.match(botao, /print:hidden/, 'some no papel');
});

// --- 5: gráfico no papel -----------------------------------------------

test('5. --chart-1..5 voltam para a paleta clara em @media print', () => {
  const impressao = blocoDe('@media print {');
  const claro = blocoDe(':root {');
  const escuro = blocoDe('.dark {');
  for (let i = 1; i <= 5; i += 1) {
    const vClaro = claro.match(new RegExp(`--chart-${i}:\\s*([^;]+);`))?.[1].trim();
    const vEscuro = escuro.match(new RegExp(`--chart-${i}:\\s*([^;]+);`))?.[1].trim();
    const vPrint = impressao.match(new RegExp(`--chart-${i}:\\s*([^;]+);`))?.[1].trim();
    assert.equal(vPrint, vClaro, `--chart-${i} no print é o valor claro`);
    assert.notEqual(vPrint, vEscuro, `--chart-${i} no print NÃO é o escuro`);
  }
});

// --- 6: badges e famílias semânticas ------------------------------------

test('6. as famílias remapeadas continuam mapeando o mesmo matiz', () => {
  // Verde=sucesso, vermelho=erro, âmbar=aviso, azul=ação. O matiz não pode
  // "virar": um aviso que aparece azul deixa de ser aviso.
  const pares = [
    [/hsl\(0\s+70% 78%\)/, 'text-rose no matiz vermelho'],
    [/hsl\(200\s+80% 75%\)/, 'text-sky no matiz ciano'],
    [/hsl\(270\s+75% 78%\)/, 'text-violet no matiz violeta'],
    [/hsl\(25\s+80% 72%\)/, 'text-orange no matiz laranja'],
    [/hsl\(160\s+50% 72%\)/, 'text-emerald continua verde'],
    [/hsl\(40\s+75% 72%\)/, 'text-amber continua âmbar'],
  ];
  for (const [re, rotulo] of pares) assert.match(cssLimpo, re, rotulo);
});

test('6b. as famílias de badge têm consumidor real em src/', async () => {
  const arquivos = [];
  // A recursão é async: sem `await`, a lista sairia vazia e o teste viraria
  // uma tautologia (afirmaria "não achou nada" e passaria).
  async function anda(dir) {
    for (const e of await readdir(abs(dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) await anda(p);
      else if (/\.jsx?$/.test(e.name)) arquivos.push(p);
    }
  }
  await anda('src');
  assert.ok(arquivos.length > 100, `a varredura achou ${arquivos.length} arquivos`);
  let todo = '';
  for (const a of arquivos) todo += await read(a);

  for (const fam of ['indigo', 'rose', 'sky', 'violet', 'orange']) {
    assert.match(todo, new RegExp(`\\b${fam}-`), `há consumidor da família ${fam}`);
  }
  // As opacidades com consumidor: vem de hover de tabela, overlay do menu,
  // card de atalho e avatar da sidebar.
  for (const cls of ['bg-white/90', 'bg-slate-50/60', 'bg-slate-950/45', 'bg-amber-50/50', 'bg-amber-500/15']) {
    assert.ok(todo.includes(cls), `há consumidor de ${cls}`);
  }
});

test('6c. as opacidades continuam semanticamente equivalentes', () => {
  // O alpha é o que dava a leveza do card sobre o fundo claro; remover seria
  // mudar o desenho, não só a cor.
  assert.match(cssLimpo, /\.dark \.bg-white\\\/80,\s*\n\.dark \.bg-white\\\/90 \{ background-color: hsl\(var\(--card\) \/ 0\.9\); \}/,
    'branco translúcido mantém o alpha');
  assert.match(cssLimpo, /\.dark \.bg-slate-50\\\/60 \{ background-color: hsl\(var\(--muted\) \/ 0\.6\); \}/);
  assert.match(cssLimpo, /\.dark \.bg-amber-50\\\/50,\s*\n\.dark \.bg-amber-50\\\/40 \{ background-color: hsl\(38 45% 13% \/ 0\.5\); \}/,
    'âmbar translúcido continua âmbar (mesmo matiz) com o alpha');
});

test('6d. nenhuma regra de cor nova saiu do escopo .dark', () => {
  const familias = [...cssLimpo.matchAll(/\.dark \.(?:bg|text|border)-(?:indigo|rose|sky|violet|orange)-/g)];
  assert.ok(familias.length >= 5, 'as cinco famílias estão mapeadas');
  const fora = [...cssLimpo.matchAll(/^\s*\.(?!dark|theme-static)(?:bg|text|border)-[a-z]/gm)];
  assert.equal(fora.length, 0, `nenhuma regra fora do .dark: ${fora.map(m => m[0])}`);
});

// --- 7: inputs nativos --------------------------------------------------

test('7. inputs date/select usam token, e os cartões de página continuam bg-white', () => {
  for (const t of tagsDeInput(relatorios)) {
    if (t.includes('bg-background')) continue;
    assert.doesNotMatch(t, /border-slate-300\s+bg-white/, `input sem bg-white literal: ${t.slice(0, 60)}`);
  }
  // Os <div>/<Link> de superfície NÃO foram tocados: são cartões de página.
  assert.match(relatorios, /bg-white border border-slate-200 rounded-xl/, 'cartão de filtro preservado');
  assert.match(relatorios, /border bg-white hover:bg-slate-50/, 'link preservado');
});

test('7b. os inputs continuam usando as mesmas classes de comportamento', () => {
  // Trocar a cor não pode mexer em tamanho, borda ou espaçamento.
  for (const t of tagsDeInput(relatorios)) {
    if (!t.includes('bg-background')) continue;
    assert.match(t, /h-9/, 'altura preservada');
    assert.match(t, /border-slate-300/, 'borda preservada');
  }
});

// --- 8, 9, 10: as correções não mexem no que não deviam -----------------

test('8. o remapeamento central foi preservado', () => {
  for (const sel of ['.dark .bg-white', '.dark .bg-slate-50', '.dark .text-slate-900', '.dark .border-slate-200']) {
    assert.ok(cssLimpo.includes(sel), `regra base preservada: ${sel}`);
  }
  // E continuam sendo tokens, não cores fixas.
  assert.match(cssLimpo, /\.dark \.bg-white \{ background-color: hsl\(var\(--card\)\); \}/);
});

test('9. o modo claro não foi tocado', () => {
  const root = blocoDe(':root {');
  assert.match(root, /--background:\s*0 0% 100%/, 'fundo claro intacto');
  assert.match(root, /--foreground:\s*0 0% 3\.9%/, 'texto claro intacto');
});

test('10. nenhuma regra nova usa !important fora do @media print', () => {
  const impressao = blocoDe('@media print {');
  const foraPrint = cssLimpo.replace(impressao, '');
  assert.doesNotMatch(foraPrint, /!important/, '!important só dentro do print');
  const IMPORTANT = (cssLimpo.match(/!important/g) || []).length;
  assert.ok(IMPORTANT <= 8, `uso contido de !important: ${IMPORTANT}`);
});

test('10b. o modo escuro funcional (setter, classe, storage) segue intacto', async () => {
  const provider = await read('src/lib/theme/ThemeProvider.jsx');
  // O bug que o Agente 2 corrigiu: o contexto expunha o NORMALIZADOR como setter.
  assert.doesNotMatch(provider, /setTema:\s*normalizarTema/, 'o normalizador não é mais o setter');
  assert.match(provider, /classList\.add\('dark'\)/, 'a classe entra no <html>');
  assert.match(provider, /localStorage\.setItem\(STORAGE_KEY/, 'a preferência é gravada');
});
