// Testes do tema claro/escuro.
//
// A maior parte destes testes é sobre CONTRATO — o que a solução NÃO pode
// fazer. Um dark mode que passa no visual e quebra impressão, ou que escurece
// o fundo de um comprovante, é um bug silencioso: ninguém percebe até precisar
// imprimir.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const css = await read('src/index.css');
const html = await read('index.html');
const main = await read('src/main.jsx');
const provider = await read('src/lib/theme/ThemeProvider.jsx');
const settings = await read('src/pages/Configuracoes.jsx');
const layout = await read('src/components/Layout.jsx');

/** Recorta um bloco CSS contando chaves, a partir de uma âncora de REGRA. */
function bloco(ancora) {
  const i = css.indexOf(ancora);
  if (i < 0) return '';
  const abre = css.indexOf('{', i);
  if (abre < 0) return '';
  let profundidade = 0;
  for (let j = abre; j < css.length; j += 1) {
    if (css[j] === '{') profundidade += 1;
    else if (css[j] === '}') {
      profundidade -= 1;
      if (profundidade === 0) return css.slice(i, j + 1);
    }
  }
  return css.slice(i);
}

/** Trecho entre duas âncoras de REGRA. */
function entre(inicio, fim) {
  const a = css.indexOf(inicio);
  const b = css.indexOf(fim, a + inicio.length);
  if (a < 0 || b < 0) return '';
  return css.slice(a, b);
}

// Âncoras dos dois blocos que nos interessam. A de escape é um grupo de
// seletores (termina em virgula), por isso não pode ser procurada com `{`.
const REMAP = entre('.dark .bg-white {', '.dark .theme-static-light,');
const IMPRESSAO = bloco('@media print {');
const DARK = bloco('.dark {');
// A folha tem comentários que CITAM `!important`. Para checar uso real, e não
// prosa, o comentário sai antes da comparação.
const CSS_SEM_COMENTARIO = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('1. padrao e light: sem preferencia salva, nada liga o dark', () => {
  // A unica coisa que liga o dark e a string exata 'dark'.
  assert.match(html, /saved === 'dark'/);
  assert.match(provider, /valor === ESCURO \? ESCURO : CLARO/);
  assert.match(provider, /useState\(lerPreferencia\)/);
  assert.match(provider, /return CLARO/);
  // A paleta clara original segue intacta em :root.
  assert.match(css, /--background: 0 0% 100%/);
});

test('2. e 3. seleciona dark e aplica a classe no root', () => {
  assert.match(settings, /setTema\(valor\)/);
  assert.match(provider, /document\.documentElement/);
  assert.match(provider, /root\.classList\.add\('dark'\)/);
  assert.match(html, /<html lang="en">/);
});

test('4. seleciona light remove a classe', () => {
  assert.match(provider, /root\.classList\.remove\('dark'\)/);
  const classes = [...provider.matchAll(/classList\.(?:add|remove)\('([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(classes)], ['dark'], 'apenas `dark` e alternado no <html>');
});

test('5.-7. preferencia persistida e restaurada ao remontar', () => {
  assert.match(provider, /STORAGE_KEY = 'ruy-theme'/);
  assert.match(provider, /localStorage\.setItem\(STORAGE_KEY, tema\)/);
  assert.match(provider, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(provider, /useState\(lerPreferencia\)/);
  // Storage bloqueado degrada para claro, nunca quebra a tela.
  assert.match(provider, /catch \{[\s\S]*?return CLARO/);
});

test('8. valor invalido cai para light', () => {
  const normalizar = provider.slice(
    provider.indexOf('export function normalizarTema'),
    provider.indexOf('function lerPreferencia'),
  );
  assert.match(normalizar, /=== ESCURO \? ESCURO : CLARO/);
  // O bootstrap segue a MESMA regra, senao o HTML e o React discordariam.
  assert.match(html, /saved === 'dark'/);
});

test('9. Configuracoes reflete a selecao atual', () => {
  assert.match(settings, /role="radiogroup"/);
  assert.match(settings, /aria-checked=\{ativo\}/);
  assert.match(settings, /tema === valor/);
  // Le do contexto, nao de estado local: fonte unica de verdade.
  assert.match(settings, /const \{ tema, setTema \} = useTheme\(\)/);
  assert.ok(!/useState\(['"]dark['"]\)/.test(settings), 'tema nao pode ser estado local da pagina');
});

test('10. a troca acontece sem reload e sem remontar a arvore', () => {
  assert.ok(!/location\.reload/.test(provider));
  assert.ok(!/window\.location\s*=/.test(provider));
  assert.ok(!/<ThemeProvider key=/.test(main), 'key no Provider remontaria tudo');
  assert.match(main, /<ThemeProvider>\s*<App \/>/);
});

test('11. paginas nao perdem estado ao trocar de tema', () => {
  const providerAcima = main.indexOf('ThemeProvider') < main.indexOf('<App />');
  assert.equal(providerAcima, true);
  assert.ok(!/key=/.test(provider), 'key derrubaria filtros, busca e dialogos abertos');
});

test('12. nenhum dado de negocio muda: o tema nao toca base nem regra', () => {
  for (const termo of ['base44', 'entities', '@/lib/dailyExpenses', '@/lib/pontoUtils', 'logAudit', 'currentUserName']) {
    assert.ok(!provider.includes(termo), `ThemeProvider nao deveria conhecer ${termo}`);
  }
  const imports = [...provider.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(imports.filter(i => !i.startsWith('react')), [], 'apenas react');
});

test('13. botao de excluir/pagar continua estruturalmente funcional', () => {
  // O remapeamento mexe em cor, nunca em display/pointer-events/visibility.
  for (const proibido of ['display:none', 'display: none', 'pointer-events:none', 'visibility:hidden', 'opacity:0']) {
    assert.ok(!REMAP.includes(proibido), `remapeamento nao pode conter ${proibido}`);
  }
  // As familias semanticas continuam presentes: vermelho=erro, verde=sucesso,
  // ambar=aviso, azul=informacao. O matiz nao pode virar cinza.
  for (const familia of ['red', 'emerald', 'amber', 'blue']) {
    assert.ok(REMAP.includes(`.dark .text-${familia}`) || REMAP.includes(`.dark .bg-${familia}`), `familia ${familia} ausente`);
  }
  // Destrutivo segue vermelho, so muda o nivel.
  assert.match(DARK, /--destructive: 0 63% 45%/);
});

test('14. o tema nao quebra o render dos componentes principais', () => {
  assert.match(main, /getElementById\('root'\)/);
  assert.match(main, /<ThemeProvider>\s*<App \/>\s*<\/ThemeProvider>/);
  // O Layout nao ganha wrapper novo (flex/grid dependem da estrutura).
  assert.match(layout, /className="flex min-h-screen bg-background"/);
});

test('15. modo escuro NAO altera superficie marcada como light-only', () => {
  const escape = bloco('.dark .theme-static-light,');
  assert.ok(escape.length > 0, 'classe de escape precisa existir');
  assert.match(escape, /background-color: #ffffff/);
  assert.match(escape, /color: #0f172a/);
  // A escape vem depois do remapeamento, entao vence sem !important.
  assert.ok(css.indexOf('.dark .theme-static-light,') > css.indexOf('.dark .bg-white {'));
  // E cobre os descendentes, senao um bg-slate-100 interno voltaria a escurecer.
  assert.match(escape, /\.dark \.theme-static-light \*/);
});

test('16. modo claro permanece EXATAMENTE como antes', () => {
  // Todo o remapeamento e prefixado por `.dark`: sem a classe, nada muda.
  const regras = REMAP.split('\n').map(l => l.trim()).filter(l => l.startsWith('.') || l.startsWith('}'));
  for (const regra of regras) {
    assert.ok(regra.startsWith('.dark '), `regra fora do dark: ${regra}`);
  }
  // `:root` (claro) nao foi tocado.
  const raiz = bloco(':root {');
  for (const [nome, valor] of [['--background', '0 0% 100%'], ['--foreground', '0 0% 3.9%'], ['--border', '0 0% 89.8%']]) {
    assert.ok(raiz.includes(`${nome}: ${valor}`), `${nome} claro mudou`);
  }
});

test('17. print nao herda fundo escuro', () => {
  assert.ok(IMPRESSAO.length > 0);
  assert.match(IMPRESSAO, /--background: 0 0% 100%/);
  assert.match(IMPRESSAO, /background-color: #ffffff !important/);
  // O !important e justificado: e o UNICO lugar do projeto que usa a forca, e
  // so dentro de @media print. Tela nao e afetada.
  const foraDoPrint = CSS_SEM_COMENTARIO.slice(0, CSS_SEM_COMENTARIO.indexOf('@media print'));
  assert.ok(!foraDoPrint.includes('!important'), 'nenhum !important fora de @media print');
});

test('18. graficos continuam usando os tokens --chart-*', () => {
  for (let i = 1; i <= 5; i += 1) assert.match(DARK, new RegExp(`--chart-${i}:`), `chart-${i} ausente no dark`);
  // O remapeamento nao toca grafico: o recharts continua lendo o token.
  assert.ok(!REMAP.includes('chart-'), 'remapeamento nao deve tocar grafico');
});

test('19. a logo nao e alterada', async () => {
  // O remapeamento em si não tem cor crua nenhuma: ele só aponta para token.
  const hexRemap = [...REMAP.matchAll(/#[0-9a-fA-F]{3,6}/g)].map(m => m[0].toLowerCase());
  assert.deepEqual([...new Set(hexRemap)], [], 'remapeamento so usa token');
  // Os únicos hex do bloco de escape são valores de PAPEL, não de marca.
  const hexEscape = [...bloco('.dark .theme-static-light,').matchAll(/#[0-9a-fA-F]{3,6}/g)].map(m => m[0].toLowerCase());
  assert.deepEqual([...new Set(hexEscape)].sort(), ['#0f172a', '#e2e8f0', '#ffffff']);
  // Nenhuma regra do remapeamento mira componente de imagem/logo. A comparação
  // é sobre as DECLARAÇÕES, não sobre o comentário: o texto explica que
  // comprovante e papel ficam claros, e esse texto não é uma regra.
  const regrasRemap = REMAP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/logo|img|image|GoogleIcon|AttachmentPreview/i.test(regrasRemap));
  // O arquivo de marca continua com hex proprio, sem virar token.
  const googleIcon = await read('src/components/GoogleIcon.jsx');
  assert.match(googleIcon, /#[0-9a-fA-F]{6}/, 'as cores de marca seguem hex');
});

test('20. inputs nativos de data/select funcionam no dark', async () => {
  // `color-scheme` e o que faz o calendario do date picker e o select nativo
  // acompanharem o tema. Sem isso ficariam com popup branco.
  assert.match(provider, /colorScheme = tema/);
  assert.match(provider, /root\.style\.colorScheme/);
  // Os inputs usam token (ou transparente, que herda o fundo ja escuro).
  const inputs = await read('src/components/ui/input.jsx');
  assert.match(inputs, /bg-transparent|bg-background|bg-input/);
  assert.ok(!inputs.includes('bg-white'), 'input nao deve usar bg-white fixo');
});

test('21. scrollbars: nao ha customizacao atual, e nada foi inventada', () => {
  // `color-scheme` ja escurece o scrollbar nativo. Nao ha regra nova de
  // scrollbar: seria customizacao sem necessidade.
  assert.ok(!/scrollbar/.test(css), 'nenhuma regra de scrollbar foi adicionada');
  assert.match(provider, /colorScheme = tema/);
});
