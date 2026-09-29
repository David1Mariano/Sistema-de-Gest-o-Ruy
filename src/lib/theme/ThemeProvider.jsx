// ---------------------------------------------------------------------------
// Tema — fonte única de verdade.
//
// Regra de ouro: existe UM estado de tema no sistema inteiro, e ele vive aqui.
// Configurações lê e escreve por este contexto; o Layout aplica a classe no
// <html>. Nenhuma página guarda cópia, senão Configurações e o layout divergem
// e o usuário vê o toggle marcado num tema e a tela no outro.
//
// A preferência é local (`localStorage`): trocar o tema não é dado de negócio e
// não tem por que ir para o banco.
//
// O `index.html` JÁ aplica a classe antes da primeira pintura, para não haver
// flash. Aqui só há uma ressincronização — o React monta, o bootstrap já fez o
// trabalho, e o Provider confirma. Se o script do head falhar (localStorage
// bloqueado, por exemplo), é este Provider quem recupera sem recarregar a página.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ruy-theme';
const CLARO = 'light';
const ESCURO = 'dark';

const ThemeContext = createContext(null);

/** Qualquer coisa que não seja exatamente 'dark' vira 'light'. */
export function normalizarTema(valor) {
  return valor === ESCURO ? ESCURO : CLARO;
}

function lerPreferencia() {
  try {
    return normalizarTema(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Navegador sem storage (modo privativo, iframe): o tema funciona na
    // sessão, só não sobrevive ao F5.
    return CLARO;
  }
}

function gravarPreferencia(tema) {
  try { window.localStorage.setItem(STORAGE_KEY, tema); } catch { /* silencioso por decisão */ }
}

/** Aplica no <html>, que é onde o CSS procura a classe `.dark`. */
export function aplicarNoDocumento(tema) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (tema === ESCURO) root.classList.add('dark');
  else root.classList.remove('dark');
  // O `color-scheme` faz o scrollbar e os controles nativos do navegador
  // (calendário do date picker, select) acompanharem o tema sem CSS extra.
  root.style.colorScheme = tema;
}

export function ThemeProvider({ children }) {
  const [tema, setTema] = useState(lerPreferencia);

  // Sincroniza documento e storage sempre que o tema muda.
  useEffect(() => {
    aplicarNoDocumento(tema);
    gravarPreferencia(tema);
  }, [tema]);

  // Outro ponto do código (ou outra aba) pode mudar a preferência; acompanhamos
  // sem recarregar a página.
  useEffect(() => {
    const aoMudar = (evento) => {
      if (evento.key !== STORAGE_KEY) return;
      setTema(normalizarTema(evento.newValue));
    };
    window.addEventListener('storage', aoMudar);
    return () => window.removeEventListener('storage', aoMudar);
  }, []);

  const alternar = useCallback(() => setTema(t => (t === ESCURO ? CLARO : ESCURO)), []);

  const valor = useMemo(
    () => ({ tema, isDark: tema === ESCURO, setTema: normalizarTema, alternar, toggle: setTema }),
    [tema, alternar],
  );

  return <ThemeContext.Provider value={valor}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const contexto = useContext(ThemeContext);
  if (!contexto) throw new Error('useTheme precisa estar dentro de <ThemeProvider>');
  return contexto;
}
