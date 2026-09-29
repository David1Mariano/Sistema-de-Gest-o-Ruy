// ---------------------------------------------------------------------------
// IA em nuvem: PREVISTÃO, não operação.
//
// Estas classes existem para que o contrato `SocialAIService` não precise
// mudar quando o dono quiser trocar do Ollama local por um modelo hospedado.
// Elas permanecem desligadas até que três coisas sejam verdadeiras ao mesmo
// tempo:
//
//   1. houver chave no ambiente do BACKEND (`GEMINI_API_KEY` / `GROQ_API_KEY`);
//   2. `SOCIAL_AI_PROVIDER` apontar explicitamente para o provedor;
//   3. `SOCIAL_AI_CLOUD_FALLBACK` for 'true'.
//
// Nenhuma das três é true por omissão. Sem as três, `cloudEnabled()` é false e
// qualquer chamada lança `AI_NOT_CONFIGURED` — não há caminho de fallback
// automático, e não há chave padrão em lugar nenhum.
//
// O texto do cliente sai da máquina por esse caminho, então ele é a exceção,
// não o padrão: quem escolhe a nuvem é uma decisão consciente do dono.
// ---------------------------------------------------------------------------
import { SocialError } from './providerBase.mjs';

const ERROS = Object.freeze({
  AI_NOT_CONFIGURED: 'IA não configurada',
  AI_UNREACHABLE: 'IA em nuvem indisponível',
  AI_INVALID_RESPONSE: 'Resposta inválida da IA em nuvem',
  AI_DISABLED: 'Provedor de IA em nuvem desativado',
});

function erro(code) { return new SocialError(code, ERROS[code] || code); }

export class GeminiAIProvider {
  constructor({ apiKey = '', endpoint = 'https://generativelanguage.googleapis.com', request = fetch, timeoutMs = 15000 } = {}) {
    this.name = 'gemini';
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.endpoint = endpoint;
    this.request = typeof request === 'function' ? request : fetch;
    this.timeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
  }

  async health() {
    const state = this.cloudEnabled() ? 'ready' : 'not_configured';
    // A chave nunca volta, nem em forma truncada: só o fato de existir ou não.
    return { provider: 'gemini', configured: Boolean(this.apiKey), reachable: false, modelAvailable: false, state };
  }

  cloudEnabled() { return cloudFlag(this.name) && Boolean(this.apiKey); }

  async classifyComment() { throw erro(this.cloudEnabled() ? 'AI_DISABLED' : 'AI_NOT_CONFIGURED'); }
  async draftReply() { throw erro(this.cloudEnabled() ? 'AI_DISABLED' : 'AI_NOT_CONFIGURED'); }
  async moderationCheck() { throw erro('AI_NOT_CONFIGURED'); }
}

export class GroqAIProvider {
  constructor({ apiKey = '', endpoint = 'https://api.groq.com/openai/v1/chat/completions', request = fetch, timeoutMs = 15000 } = {}) {
    this.name = 'groq';
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.endpoint = endpoint;
    this.request = typeof request === 'function' ? request : fetch;
    this.timeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;
  }

  async health() {
    const state = this.cloudEnabled() ? 'ready' : 'not_configured';
    return { provider: 'groq', configured: Boolean(this.apiKey), reachable: false, modelAvailable: false, state };
  }

  cloudEnabled() { return cloudFlag(this.name) && Boolean(this.apiKey); }

  async classifyComment() { throw erro(this.cloudEnabled() ? 'AI_DISABLED' : 'AI_NOT_CONFIGURED'); }
  async draftReply() { throw erro(this.cloudEnabled() ? 'AI_DISABLED' : 'AI_NOT_CONFIGURED'); }
  async moderationCheck() { throw erro('AI_NOT_CONFIGURED'); }
}

/**
 * Um provedor de nuvem só liga com chave E com a flag explícita. Chave sem
 * flag não liga: assim, colar a chave no ambiente não ativa chamada paga.
 */
function cloudFlag(name, env = process.env) {
  return env.SOCIAL_AI_PROVIDER === name && env.SOCIAL_AI_CLOUD_FALLBACK === 'true';
}

export const cloudFromEnvironment = (env = process.env) => Object.freeze({
  gemini: new GeminiAIProvider({ apiKey: env.GEMINI_API_KEY || '' }),
  groq: new GroqAIProvider({ apiKey: env.GROQ_API_KEY || '' }),
});
