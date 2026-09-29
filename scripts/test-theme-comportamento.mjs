// Teste COMPORTAMENTAL do tema.
//
// Os 18 testes de `test-theme.mjs` leem o codigo-fonte e, por isso, passaram
// com o bug mais grave possivel: o Provider expunha `normalizarTema` -- uma
// funcao PURA -- como se fosse o setter. O clique chamava algo que devolvia um
// valor e nao guardava nada. Conferir presenca de string nao prova que algo
// funciona.
//
// Aqui o codigo de producao e realmente EXECUTADO: o `ThemeProvider` roda com
// um React minimo e deterministico, o handler da tela dispara, e o resultado e
// conferido no estado, no `<html>` e no localStorage. Se a cadeia quebrar em
// qualquer ponto, este arquivo falha.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// esbuild ja vem com o Vite. Nada foi instalado para testar.
import * as esbuild from 'esbuild';

const abs = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const read = rel => readFile(abs(rel), 'utf8');

const ARQUIVO_PROVIDER = 'src/lib/theme/ThemeProvider.jsx';
const ARQUIVO_CONFIG = 'src/pages/Configuracoes.jsx';
const STORAGE_KEY = 'ruy-theme';

/**
 * React minimo: implementa so o que o Provider usa e roda os efeitos quando o
 * estado muda, como o React real faria. Sem DOM, sem agendador, sem timers.
 */
function criarReactFalso() {
  const estados = [];
  // Efeitos sao guardados por SLOT e sobrescritos a cada render, como no React.
  // Guardar so na primeira vez congelaria a closure com o `tema` antigo, e o
  // efeito de "aplicar no documento" nunca veria a mudanca.
  const efeitos = [];
  let indice = 0;
  let indiceEfeito = 0;
  let corpoAtual = null;

  const rodarEfeitos = () => {
    for (const efeito of efeitos) if (typeof efeito === 'function') efeito();
  };

  const executar = () => {
    indice = 0;
    indiceEfeito = 0;
    const saida = corpoAtual();
    rodarEfeitos();
    return saida;
  };

  const api = {
    useState(inicial) {
      const i = indice;
      indice += 1;
      if (!estados[i]) estados[i] = [typeof inicial === 'function' ? inicial() : inicial];
      // O setter fica preso ao SEU slot de hook. Se capturasse o indice atual
      // na hora da chamada, gravaria no estado errado -- exatamente o tipo de
      // erro que este arquivo existe para pegar.
      const definir = valor => {
        const alvo = estados[i];
        alvo[0] = typeof valor === 'function' ? valor(alvo[0]) : valor;
        // Re-renderiza chamando o MESMO corpo registrado na montagem. Nao
        // re-registramos nada aqui: se o corpo virasse "chamar o corpo
        // anterior", cada clique criaria uma camada nova e estouraria a pilha.
        executar();
      };
      return [estados[i][0], definir];
    },
    useEffect(fn) { efeitos[indiceEfeito] = fn; indiceEfeito += 1; },
    useMemo(fn) { return fn(); },
    useCallback(fn) { return fn; },
    useContext() { throw new Error('useContext nao e usado pelo Provider'); },
    createContext(inicial) { return { Provider: Symbol('Provider'), Consumer: Symbol('Consumer'), inicial }; },
    createElement(tipo, props) { return { tipo, props }; },
    /** Monta: registra o corpo e o executa uma vez. */
    montar(corpo) { corpoAtual = corpo; return executar(); },
    /** Re-renderiza sem tocar no corpo. */
    render() { return executar(); },
  };
  return api;
}

/** Ambiente de navegador minimo: so o que o Provider toca. */
function instalarNavegador(preferenciaInicial) {
  const loja = new Map();
  if (preferenciaInicial !== undefined) loja.set(STORAGE_KEY, preferenciaInicial);
  globalThis.window = {
    localStorage: {
      getItem: k => (loja.has(k) ? loja.get(k) : null),
      setItem: (k, v) => loja.set(k, String(v)),
      removeItem: k => loja.delete(k),
    },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    documentElement: {
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      style: {},
    },
  };
  return { loja };
}

/**
 * Avalia o modulo real do Provider e o monta, devolvendo uma funcao que rele o
 * contexto. O valor muda de identidade a cada render, como no React: por isso
 * os testes}$$
 * relem depois de agir, senao mediriam a foto anterior.
 */
async function montar({ preferencia } = {}) {
  const env = instalarNavegador(preferencia);
  const react = criarReactFalso();

  const fonte = await read(ARQUIVO_PROVIDER);
  const { code } = await esbuild.transform(fonte, {
    loader: 'jsx',
    format: 'cjs',
    target: 'node20',
    // O JSX aponta para uma variavel do escopo, nao para um global `React`.
    jsxFactory: '__react.createElement',
    jsxFragment: '__react.Fragment',
  });

  const modulo = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fabrica = new Function('require', 'module', 'exports', '__react', code);
  fabrica(nome => {
    if (nome === 'react') return react;
    throw new Error(`dependencia inesperada no teste do tema: ${nome}`);
  }, modulo, modulo.exports, react);

  const { ThemeProvider } = modulo.exports;
  const render = () => react.render().props.value;
  return { atual: react.montar(() => ThemeProvider({ children: null })).props.value, render, ...env };
}

const temClasseDark = () => document.documentElement.classList.contains('dark');

test('1. setTema do contexto muda o estado de light para dark', async () => {
  const { atual, render } = await montar();
  assert.equal(render().tema, 'light', 'comeca no claro');
  atual.setTema('dark');
  assert.equal(render().tema, 'dark', 'o estado tem que virar dark');
  assert.equal(render().isDark, true);
});

test('2. setTheme("dark") aplica a classe dark no <html> na hora', async () => {
  const { atual } = await montar();
  atual.setTema('dark');
  assert.equal(temClasseDark(), true, '<html> precisa receber class="dark" sem F5');
});

test('3. setTheme("light") remove a classe do <html>', async () => {
  const { atual } = await montar();
  atual.setTema('dark');
  atual.setTema('light');
  assert.equal(temClasseDark(), false, 'a classe tem que sumir');
});

test('4. a preferencia e persistida nos dois sentidos', async () => {
  const { atual, loja } = await montar();
  atual.setTema('dark');
  assert.equal(loja.get(STORAGE_KEY), 'dark', 'dark precisa ser salvo');
  atual.setTema('light');
  assert.equal(loja.get(STORAGE_KEY), 'light', 'light precisa ser salvo');
});

test('5. valor invalido cai para light e nunca fica num estado invalido', async () => {
  const { atual, render, loja } = await montar();
  for (const invalido of ['DARK', 'true', '1', 'escuro', '', null, undefined]) {
    atual.setTema('dark');
    atual.setTema(invalido);
    assert.equal(render().tema, 'light', `entrada ${JSON.stringify(invalido)}`);
    assert.equal(loja.get(STORAGE_KEY), 'light');
  }
});

test('6. remontar reidrata o tema salvo (sobrevive ao F5)', async () => {
  const primeira = await montar();
  primeira.atual.setTema('dark');
  // "F5": nova montagem, mesma preferencia persistida.
  const segunda = await montar({ preferencia: 'dark' });
  assert.equal(segunda.render().tema, 'dark', 'tem que voltar dark');
  assert.equal(temClasseDark(), true, 'e reaplicar a classe');
  // E o caminho inverso.
  segunda.atual.setTema('light');
  const terceira = await montar({ preferencia: 'light' });
  assert.equal(terceira.render().tema, 'light');
  assert.equal(temClasseDark(), false);
});

test('7. o ciclo completo da tela: clicar nos dois cards alterna o <html>', async () => {
  // Reproduz o que a tela faz: o card chama `setTema(valor)` com o value dele.
  const { atual, render } = await montar();
  for (const card of [{ valor: 'light' }, { valor: 'dark' }]) {
    // Este e literalmente o `onClick={() => setTema(valor)}` da tela.
    atual.setTema(card.valor);
    const esperado = card.valor === 'dark';
    assert.equal(render().isDark, esperado, `card ${card.valor}`);
    assert.equal(temClasseDark(), esperado, `classe para ${card.valor}`);
  }
});

test('8. Configuracoes chama setTema com o valor do card, e nao com estado local', async () => {
  const fonte = await read(ARQUIVO_CONFIG);
  assert.match(fonte, /onClick=\{\(\) => setTema\(valor\)\}/, 'o card precisa chamar setTema(valor)');
  assert.match(fonte, /valor: 'light'/, 'card Claro precisa existir');
  assert.match(fonte, /valor: 'dark'/, 'card Escuro precisa existir');
  assert.match(fonte, /const \{ tema, setTema \} = useTheme\(\)/, 'vem do contexto');
  assert.ok(!/useState\(['"]dark['"]\)/.test(fonte), 'tema nao pode ser estado local da pagina');
});

test('9. o setter do contexto nao e a funcao normalizadora (a causa do bug)', async () => {
  const fonte = await read(ARQUIVO_PROVIDER);
  // `normalizarTema` e pura: devolve um valor e nao guarda nada. Se ela for
  // exposta como `setTema`, o clique parece funcionar e nao muda tema nenhum.
  assert.ok(!/setTema:\s*normalizarTema/.test(fonte), 'setTema nao pode ser a normalizadora');
  // O setter exposto precisa chamar o setter do useState de verdade.
  assert.match(fonte, /const definirTema = useCallback\(\(valor\) => setTema\(normalizarTema\(valor\)\), \[\]\)/);
  assert.match(fonte, /setTema: definirTema/);
});

test('10. nao existe uma segunda fonte de tema em runtime', async () => {
  // `next-themes` esta no package.json, mas o modulo que o usa (ui/sonner) nao e
  // montado em lugar nenhum: App.jsx usa ui/toaster. Sem provider do
  // next-themes na arvore, ele nao adiciona nem remove classe nenhuma.
  const app = await read('src/App.jsx');
  assert.ok(!/ui\/sonner/.test(app), 'App nao deve montar o sonner');
  assert.match(app, /ui\/toaster/);
  const fonte = await read(ARQUIVO_PROVIDER);
  assert.ok(!/next-themes/.test(fonte), 'o Provider nao pode depender de next-themes');
});
