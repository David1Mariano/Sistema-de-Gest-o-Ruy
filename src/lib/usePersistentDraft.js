import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from './useCurrentUser';
import {
  createDraftSession,
  resolveUserKey,
  subscribeExternalDrafts,
  hasDraftContent,
  cleanupExpiredDrafts,
} from './draftStore';
import {
  DRAFT_DEBOUNCE_MS,
  DRAFT_LABEL_DISCARDED,
  DRAFT_LABEL_EXTERNAL,
  DRAFT_LABEL_RESTORED,
  DRAFT_LABEL_SAVED,
  DRAFT_LABEL_STALE,
  draftEditKey,
} from './draftConfig';

// Estados do rascunho no formulário. `idle` é o único em que nada é mostrado.
export const DRAFT_STATUS = Object.freeze({
  IDLE: 'idle',
  RESTORED: 'restored',
  SAVED: 'saved',
  STALE: 'stale',
  EXTERNAL: 'external',
  DISCARDED: 'discarded',
  UNAVAILABLE: 'unavailable',
});

const EMPTY_RESTORE = { data: undefined, restored: false, stale: false, reason: null, label: null };

// Limpeza de expirados roda no máximo uma vez por sessão do navegador. É uma
// varredura de prefixo; fazer isso a cada montagem de modal seria desperdício.
let cleanupAlreadyRan = false;

/**
 * Persistência de rascunho para UM formulário.
 *
 * O que a tela precisa saber:
 *   - `restoreInto(base)`  devolve o baseline já com o rascunho por cima;
 *   - `markSaved()`        SÓ depois do backend confirmar;
 *   - `discard()`          quando o usuário escolhe descartar;
 *   - `status`/`message`   para o aviso discreto.
 *
 * O que este hook NÃO faz, por desenho: criar, atualizar, apagar, pagar,
 * movimentar estoque ou enviar arquivo. Restaurar devolve um objeto de campos
 * e nada mais — a ação final continua sendo o clique do usuário em Salvar.
 *
 * Fechar o modal NÃO apaga o rascunho: o efeito de limpeza apenas GRAVA o que
 * ficou pendente, porque fechar/sair é justamente o caso a ser coberto.
 */
export function usePersistentDraft({
  formKey,
  enabled = true,
  value,
  excludeFields = [],
  recordUpdatedAt,
  debounceMs = DRAFT_DEBOUNCE_MS,
  storage,
} = {}) {
  const user = useCurrentUser();
  const userKey = resolveUserKey(user);

  const [status, setStatus] = useState(DRAFT_STATUS.IDLE);
  const [message, setMessage] = useState('');
  const [available, setAvailable] = useState(true);

  // `excludeFields` costuma ser um array literal no componente; sem esta
  // memoização ele mudaria de identidade a cada render e reiniciaria o
  // debounce infinitamente.
  const excluded = useMemo(() => excludeFields, [excludeFields.join('|')]);

  const session = useMemo(
    () => createDraftSession({ userKey, formKey, storage, excludeFields: excluded, debounceMs }),
    [userKey, formKey, storage, excluded, debounceMs],
  );

  const timerRef = useRef(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 1. Restauração + aviso, no instante em que o formulário abre.
  //    Fica num método que a tela chama junto do seu próprio reset, para não
  //    depender da ordem em que os efeitos de dois hooks são executados.
  const restoreInto = useCallback((base) => {
    const result = session.restore({ base, recordUpdatedAt });
    if (result.stale) {
      setStatus(DRAFT_STATUS.STALE);
      setMessage(DRAFT_LABEL_STALE);
      return base;
    }
    if (result.restored) {
      setStatus(DRAFT_STATUS.RESTORED);
      setMessage(DRAFT_LABEL_RESTORED);
      return result.data;
    }
    if (result.reason === 'storage-unavailable' || result.reason === 'no-user') {
      setAvailable(false);
      setStatus(DRAFT_STATUS.UNAVAILABLE);
      setMessage('');
      return base;
    }
    if (result.label) {
      // Corrompido/expirado/versão incompatível: o núcleo já removeu, o
      // formulário abre limpo e o usuário só recebe o aviso discreto.
      setStatus(DRAFT_STATUS.IDLE);
      setMessage(result.label);
    } else {
      setStatus(DRAFT_STATUS.IDLE);
      setMessage('');
    }
    return base;
  }, [session, recordUpdatedAt]);

  // 2. Autosave com debounce. Sem cleanup que grave: se houvesse, ele rodaria a
  //    cada tecla e o debounce não existiria. O timer vive num ref.
  useEffect(() => {
    if (!enabled || !session.enabled) return;
    session.change(value);
    // A pessoa voltou a digitar: o aviso de "rascunho salvo" não pode
    // continuar em tela, senão pareceria que o que está na caixa já está
    // guardado. Ele volta a aparecer assim que a próxima gravação acontecer.
    setStatus((atual) => (atual === DRAFT_STATUS.SAVED ? DRAFT_STATUS.IDLE : atual));
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (session.flush(Date.now())) {
        setStatus(DRAFT_STATUS.SAVED);
        setMessage(DRAFT_LABEL_SAVED);
      }
    }, debounceMs);
  }, [value, enabled, session, debounceMs, clearTimer]);

  // 3. Fim de vida do formulário (fechar modal, trocar de rota, desmontar):
  //    grava o que estiver pendente. Nunca apaga.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      clearTimer();
      session.flush(Date.now(), { force: true });
    };
  }, [enabled, session, clearTimer]);

  // 4. `pagehide` cobre F5/fechar aba com tecla digitada menos de `debounceMs`
  //    antes. Só grava; perder foco nunca apaga nada.
  useEffect(() => {
    if (!enabled || !session.enabled) return undefined;
    const onPageHide = () => {
      clearTimer();
      session.flush(Date.now(), { force: true });
    };
    globalThis.addEventListener?.('pagehide', onPageHide);
    return () => {
      globalThis.removeEventListener?.('pagehide', onPageHide);
      clearTimer();
      session.flush(Date.now(), { force: true });
    };
  }, [enabled, session, clearTimer]);

  // 5. Outra aba gravou este mesmo rascunho. Estratégia é simples e prevista:
  //    avisar e deixar o último a escrever vencer (latest-write-wins).
  useEffect(() => {
    if (!enabled || !session.enabled || !session.key) return undefined;
    return subscribeExternalDrafts(({ key }) => {
      if (key !== session.key) return;
      setStatus(DRAFT_STATUS.EXTERNAL);
      setMessage(DRAFT_LABEL_EXTERNAL);
    }, { storage });
  }, [enabled, session, storage]);

  // 6. Varredura de expirados, uma vez por sessão do navegador.
  useEffect(() => {
    if (cleanupAlreadyRan) return;
    cleanupAlreadyRan = true;
    cleanupExpiredDrafts({ userKey, storage });
  }, [userKey, storage]);

  const markSaved = useCallback(() => {
    clearTimer();
    session.saved();
    setStatus(DRAFT_STATUS.IDLE);
    setMessage('');
  }, [session, clearTimer]);

  // Falha do backend: o rascunho é a única cópia do que o usuário digitou e
  // precisa continuar lá. Sem ação, explicitamente.
  const markFailed = useCallback(() => { session.failed(); }, [session]);

  const discard = useCallback(() => {
    clearTimer();
    session.discard();
    setStatus(DRAFT_STATUS.DISCARDED);
    setMessage(DRAFT_LABEL_DISCARDED);
  }, [session, clearTimer]);

  const keep = useCallback(() => {
    session.keep();
    setStatus(DRAFT_STATUS.SAVED);
    setMessage(DRAFT_LABEL_SAVED);
  }, [session]);

  const dismissNotice = useCallback(() => {
    setStatus(DRAFT_STATUS.IDLE);
    setMessage('');
  }, []);

  return {
    available,
    status,
    message,
    hasContent: hasDraftContent,
    restoreInto,
    markSaved,
    markFailed,
    discard,
    keep,
    dismissNotice,
  };
}

export { draftEditKey };
