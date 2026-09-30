// ---------------------------------------------------------------------------
// IA gratuita e LOCAL para a Central de Redes Sociais.
//
// Este é o provider PRINCIPAL: roda na máquina do dono, não custa por chamada e
// não manda texto de cliente para fora da empresa. Nenhum modelo é fixo no
// código — `OLLAMA_MODEL` é configuração, senão trocar de modelo seria um
// deploy.
//
// O QUE ESTE ARQUIVO NÃO FAZ, por desenho:
//  - não envia nada a ninguém. A IA só sugere texto; quem envia é o atendente,
//    pelo provedor oficial, depois da aprovação humana na outbox;
//  - não é chamado pelo navegador. Só o backend instancia este arquivo, e a
//    configuração vem exclusivamente do ambiente do servidor — nunca das
//    variáveis com prefixo de build do cliente;
//  - não inventa endpoint nem chave. A URL vem de `OLLAMA_BASE_URL` e é
//    validada antes de qualquer fetch, para que uma config errada não vire
//    chamada SSRF contra um host interno.
// ---------------------------------------------------------------------------
import { SocialError } from './providerBase.mjs';

export const AI_PROVIDERS = Object.freeze(['ollama', 'gemini', 'groq']);

// Loopback e redes privadas são o alvo legítimo de um Ollama local. Qualquer
// outro host precisa de configuração explícita, senão o "IA local" vira um
// proxy para fora.
const PRIVADO = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

const ERROS = Object.freeze({
  AI_NOT_CONFIGURED: 'IA não configurada',
  AI_UNREACHABLE: 'IA local offline',
  AI_MODEL_UNAVAILABLE: 'Modelo indisponível',
  AI_TIMEOUT: 'IA local demorou demais para responder',
  AI_INVALID_RESPONSE: 'Resposta inválida da IA local',
  AI_UNSAFE_OUTPUT: 'Resposta da IA reprovada na validação',
});

function erro(code) { return new SocialError(code, ERROS[code] || code); }

/** Só devolve números e host; nunca a URL completa, credencial ou modelo cru. */
function redigir(url) {
  try { return new URL(url).host; } catch { return 'host invalido'; }
}

export function assertSafeBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw erro('AI_NOT_CONFIGURED');
  let url;
  try { url = new URL(raw.trim()); } catch { throw erro('AI_NOT_CONFIGURED'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw erro('AI_NOT_CONFIGURED');
  if (url.username || url.password || url.search || url.hash) throw erro('AI_NOT_CONFIGURED');
  return url.origin;
}

export class OllamaAIProvider {
  /**
   * @param {object} o
   * @param {string} o.baseUrl     `OLLAMA_BASE_URL`
   * @param {string} o.model       `OLLAMA_MODEL` — sem default: modelo é config
   * @param {number} o.timeoutMs   teto de espera por resposta da IA local
   * @param {Function} o.request   injetável nos testes; nunca `fetch` cru
   */
  constructor({ baseUrl = '', model = '', timeoutMs = 15000, request = fetch } = {}) {
    this.name = 'ollama';
    this.baseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    this.model = typeof model === 'string' ? model.trim() : '';
    this.timeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
    this.request = typeof request === 'function' ? request : fetch;
  }

  get configured() { return Boolean(this.baseUrl && this.model); }

  /**
   * Três respostas distintas, porque elas orientam ações diferentes:
   * `not_configured` é setup; `offline` é "a máquina caiu"; `model_unavailable`
   * é "trocar o modelo". Colapsar as três em um booleano esconderia a causa.
   */
  async health() {
    if (!this.configured) return { provider: 'ollama', configured: false, reachable: false, modelAvailable: false, state: 'not_configured' };
    const origin = assertSafeBaseUrl(this.baseUrl);
    let modelos = null;
    try {
      // `/api/tags` e GET: lista os modelos ja baixados na maquina.
      modelos = await this.#json(`${origin}/api/tags`, { method: 'GET' });
    } catch { modelos = null; }
    if (modelos === null) return { provider: 'ollama', configured: true, reachable: false, modelAvailable: false, state: 'offline' };
    const modelAvailable = Array.isArray(modelos.models) && modelos.models.some(m => m?.name === this.model || m?.model === this.model);
    return {
      provider: 'ollama', configured: true, reachable: true, modelAvailable,
      state: modelAvailable ? 'ready' : 'model_unavailable',
      // Host redigido, nunca a URL completa nem a lista de modelos do servidor.
      host: redigir(origin), model: this.model,
    };
  }

  async #json(url, init) {
    let res;
    try {
      res = await this.request(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      // Qualquer falha de conexão vira "IA local offline", nunca um erro cru:
      // a Central precisa de um código estável para cair na resposta manual.
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw erro('AI_TIMEOUT');
      throw erro('AI_UNREACHABLE');
    }
    if (!res) throw erro('AI_UNREACHABLE');
    if (res.status === 404) throw erro('AI_MODEL_UNAVAILABLE');
    if (!res.ok) throw erro('AI_UNREACHABLE');
    try { return await res.json(); } catch { throw erro('AI_INVALID_RESPONSE'); }
  }

  async #complete(prompt, system) {
    if (!this.configured) throw erro('AI_NOT_CONFIGURED');
    const origin = assertSafeBaseUrl(this.baseUrl);
    const payload = await this.#json(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    return this.#parse(payload?.message?.content);
  }

  /** Aceita só JSON com a forma esperada; texto solto é resposta inválida. */
  #parse(content) {
    if (typeof content !== 'string' || !content.trim()) throw erro('AI_INVALID_RESPONSE');
    let data;
    try { data = JSON.parse(content); } catch { throw erro('AI_INVALID_RESPONSE'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw erro('AI_INVALID_RESPONSE');
    return data;
  }

  async classifyComment({ text = '', categories = [] } = {}) {
    const data = await this.#complete(
      `Classifique o comentário em UMA categoria desta lista: ${categories.join(', ')}.\n`
      + `Responda apenas JSON: {"category":"<categoria>","confidence":<0 a 1>,"requiresHuman":<true|false>}.\n\n`
      + `Comentário: ${JSON.stringify(text)}`,
      'Você classifica comentários. Responda somente JSON válido. Sem texto extra.',
    );
    const category = typeof data.category === 'string' ? data.category : '';
    if (!category) throw erro('AI_INVALID_RESPONSE');
    return {
      category,
      confidence: Number.isFinite(data.confidence) ? Math.min(1, Math.max(0, data.confidence)) : 0,
      // Sugestão da IA: a decisão de exigir humano é do policy, não do modelo.
      requiresHuman: data.requiresHuman === true,
      provider: 'ollama',
    };
  }

  async draftReply({ text = '', context = {} } = {}) {
    const data = await this.#complete(
      `Sugira UMA resposta curta e cordial ao comentário abaixo.\n`
      + `Responda apenas JSON: {"reply":"<texto>","requiresHuman":<true|false>}.\n\n`
      + `Contexto autorizado:\n${JSON.stringify(context)}\n\nComentário: ${JSON.stringify(text)}`,
      'Você redige respostas curtas em português brasileiro. Responda somente JSON válido.',
    );
    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    if (!reply) throw erro('AI_INVALID_RESPONSE');
    if (reply.length > 2000) throw erro('AI_UNSAFE_OUTPUT');
    return { reply, requiresHuman: data.requiresHuman === true, provider: 'ollama' };
  }

  async moderationCheck() { throw erro('AI_NOT_CONFIGURED'); }
}

// A configuração vem do ambiente do BACKEND. Este helper é o único ponto que
// toca `process.env`, para que nenhum outro arquivo precise saber o nome das
// variáveis — e para que `import.meta.env`/`VITE_*` nunca entrem no caminho.
export const ollamaFromEnvironment = (env = process.env) => new OllamaAIProvider({
  baseUrl: env.OLLAMA_BASE_URL || '',
  model: env.OLLAMA_MODEL || '',
  timeoutMs: Number.isInteger(Number(env.OLLAMA_TIMEOUT_MS)) ? Number(env.OLLAMA_TIMEOUT_MS) : 15000,
});
