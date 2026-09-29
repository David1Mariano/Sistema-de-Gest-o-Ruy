// Cliente da tela de gestão de acessos. Fala com o backend pelo mesmo padrão do
// `createSocialAIClient`: sem endpoint configurado, falha fechado — o que é o
// estado real enquanto o handler de administração não está hospedado.
const FALLBACK = 'Não foi possível concluir a operação.';

export function createSocialAccessClient({ endpoint, getToken, fetchImpl } = {}) {
  const call = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const base = typeof endpoint === 'string' ? endpoint.replace(/\/+$/, '') : null;

  async function request(path, { method = 'GET', body } = {}) {
    if (!base || !call) { const e = new Error(FALLBACK); e.code = 'not_configured'; throw e; }
    const token = await getToken?.();
    const response = await call(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok || !payload) {
      const e = new Error(payload?.message || FALLBACK);
      // O código viaja para a tela diferenciar "schema pendente" de "negado".
      e.code = payload?.error || `http_${response.status}`;
      throw e;
    }
    return payload;
  }

  return Object.freeze({
    listAccounts: () => request('/social-accounts'),
    listAccountAccess: (accountId) => request(`/social-accounts/${encodeURIComponent(accountId)}/access`),
    listCandidates: (accountId) => request(`/social-accounts/${encodeURIComponent(accountId)}/candidates`),
    grant: (input) => request('/social-accounts/access', { method: 'POST', body: { action: 'grant', ...input } }),
    saveAccess: (input) => request('/social-accounts/access', { method: 'POST', body: { action: 'update', ...input } }),
    revoke: (input) => request('/social-accounts/access', { method: 'POST', body: { action: 'revoke', ...input } }),
    reactivate: (input) => request('/social-accounts/access', { method: 'POST', body: { action: 'reactivate', ...input } }),
  });
}

// ===========================================================================
// Cliente da IA para a CENTRAL. Fala SO com o backend que monta
// `createSocialAIHandler` — nunca com Ollama/Gemini/Groq direto, e nunca carrega
// URL de provider, header ou segredo no bundle do navegador.
//
// Sem `endpoint`, o cliente falha fechado: é o estado real do projeto hoje, já
// que o handler ainda não está hospedado (ver `docs/redes-sociais.md`).
const FALLBACK_MESSAGE = 'Não foi possível gerar uma sugestão. Você pode responder manualmente.';

export class AISuggestionError extends Error {
  constructor(code = 'unavailable', message = FALLBACK_MESSAGE) {
    super(message);
    this.name = 'AISuggestionError';
    this.code = code;
    // Não é vazamento: a frase é fixa e serve de recuperação para o operador.
    this.recoverable = true;
  }
}

/**
 * Serializa as sugestões por request. O botão pode ser clicado duas vezes, ou
 * "Gerar novamente" antes de a anterior responder: só a ÚLTIMA resposta vale.
 * Implementado por contador monotônico + AbortController — a resposta antiga é
 * descartada mesmo que o servidor já tenha respondido.
 */
export function createLatestRequest() {
  let current = 0;
  let controller = null;
  return {
    get busy() { return current !== 0; },
    begin() {
      current += 1;
      const id = current;
      controller?.abort();
      const next = new AbortController();
      controller = next;
      return { id, signal: next.signal };
    },
    /** Só a resposta da requisição mais recente passa; as antigas viram no-op. */
    accept(id) {
      if (id !== current) return false;
      current = 0;
      controller = null;
      return true;
    },
    abort() { controller?.abort(); current = 0; controller = null; },
  };
}

export function createSocialAIClient({ endpoint, getToken, fetchImpl } = {}) {
  const latest = createLatestRequest();
  const call = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const base = typeof endpoint === 'string' ? endpoint.replace(/\/+$/, '') : null;

  async function request(path, { method = 'GET', body, signal } = {}) {
    if (!base || !call) throw new AISuggestionError('not_configured');
    const token = await getToken?.();
    const response = await call(`${base}${path}`, {
      method,
      signal,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    // 2xx sem corpo utilizável é resposta inválida, não sucesso.
    if (!response.ok || !payload) throw new AISuggestionError(payload?.error || `http_${response.status}`);
    return payload;
  }

  return Object.freeze({
    get busy() { return latest.busy; },
    /** Estado seguro da IA. Nunca lança: a UI precisa sempre renderizar algo. */
    async health() {
      try {
        return await request('/social-ai/health');
      } catch (error) {
        return { status: error?.code === 'not_configured' ? 'not_configured' : 'error', ready: false, provider: null, host: null, model: null };
      }
    },
    /**
     * Gera uma sugestão. Lança `AISuggestionError` com a frase de fallback
     * manual quando não dá — o painel continua utilizável para escrita manual.
     */
    async suggest(comment) {
      const { id, signal } = latest.begin();
      try {
        const payload = await request('/social-ai/draft', {
          method: 'POST',
          signal,
          body: { commentId: comment?.id, text: comment?.text },
        });
        // Resposta velha chegando depois da nova: descartada, não aplicada.
        if (!latest.accept(id)) throw new AISuggestionError('superseded');
        return payload;
      } catch (error) {
        latest.accept(id);
        if (error?.name === 'AbortError') throw new AISuggestionError('superseded');
        throw error instanceof AISuggestionError ? error : new AISuggestionError('unavailable');
      }
    },
    abort() { latest.abort(); },
  });
}
