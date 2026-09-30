import { SocialProvider, SocialError } from './providerBase.mjs';

const fail = code => new SocialError(code, 'Falha na integração ManyChat');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Read-only operations verified against official Page_API OpenAPI on 2026-09-29.
// Mutating endpoints deliberately have NO transport implementation in this phase.
export function createManyChatClient({ apiKey = '', request = fetch, wait = sleep, timeoutMs = 5000, maxAttempts = 3 } = {}) {
  const attempts = Math.min(3, Math.max(1, maxAttempts));
  async function read(path) {
    if (!apiKey) throw fail('NOT_CONFIGURED');
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      let timer;
      let response;
      try {
        // Race covers headers AND body. Abort alone depends on fetch honoring the signal.
        response = await Promise.race([
          (async () => {
            const res = await request(`https://api.manychat.com${path}`, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
            if (!res.ok) return { status: res.status, retryAfter: res.headers.get('retry-after') };
            const body = await res.json();
            return { status: res.status, body };
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('TIMEOUT')); }, Math.min(10000, Math.max(1, timeoutMs))); }),
        ]);
      } catch (error) {
        const code = error?.code === 'TIMEOUT' ? 'TIMEOUT' : 'NETWORK_ERROR';
        if (attempt + 1 === attempts) throw fail(code);
        await wait(250 * 2 ** attempt);
        continue;
      } finally { clearTimeout(timer); }
      if ([401, 403].includes(response.status)) throw fail(response.status === 401 ? 'AUTHENTICATION_FAILED' : 'FORBIDDEN');
      if (response.status === 429 || response.status >= 500) {
        const code = response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_FAILURE';
        // Long Retry-After must defer to a future scheduler, never retry earlier.
        const seconds = Number(response.retryAfter);
        const delay = response.retryAfter && Number.isFinite(seconds) ? seconds * 1000 : response.retryAfter ? Date.parse(response.retryAfter) - Date.now() : 250 * 2 ** attempt;
        if (attempt + 1 === attempts || !Number.isFinite(delay) || delay > 5000) throw fail(code);
        await wait(Math.max(250 * 2 ** attempt, delay));
        continue;
      }
      if (response.status < 200 || response.status >= 300 || response.body?.status !== 'success' || !response.body.data || typeof response.body.data !== 'object') throw fail('PROVIDER_FAILURE');
      return response.body.data;
    }
  }
  return Object.freeze({
    async connectionCheck() {
      if (!apiKey) return { configured: false, reachable: false, authenticated: false, error_code: 'NOT_CONFIGURED' };
      try { await read('/fb/page/getInfo'); return { configured: true, reachable: true, authenticated: true, error_code: null }; }
      catch (error) { return { configured: true, reachable: !['NETWORK_ERROR', 'TIMEOUT'].includes(error.code), authenticated: false, error_code: error.code }; }
    },
    async getContact(id) {
      if (!/^\d{1,20}$/.test(String(id))) throw fail('INVALID_CONTACT');
      const data = await read(`/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(id)}`);
      // No raw response escapes into logging/UI; normalize through ingress contact mapper.
      return { id: String(data.id), name: data.name, first_name: data.first_name, last_name: data.last_name, language: data.language, timezone: data.timezone, live_chat_url: data.live_chat_url };
    },
  });
}
export class ManyChatProvider extends SocialProvider {
  constructor(options = {}) {
    super('manychat', { connect: false, listComments: false, replyComment: false, listPosts: false, getInsights: false, refresh: false, getContact: true });
    this.client = createManyChatClient(options);
  }
  async connectionCheck() { return this.client.connectionCheck(); }
  async getContact(id) { return this.client.getContact(id); }
  async replyComment() { throw new SocialError('UNSUPPORTED_CHANNEL', 'Envio por ManyChat não disponível para este canal.'); }
}
// Explicit factory for a FUTURE backend composition root; never imported by frontend.
export const manyChatFromEnvironment = (env = process.env) => new ManyChatProvider({ apiKey: env.MANYCHAT_API_KEY || '' });
