// ===========================================================================
// CLIENTE DE ANEXOS DO FRONTEND.
//
// Fala com o BACKEND (`/storage/*`) e nunca com o R2/S3 direto:
//   - nenhuma chave de acesso e nenhum segredo de armazenamento aqui;
//   - nenhum SDK de S3 no bundle do navegador;
//   - o `endpoint` é apenas uma URL interna (`VITE_STORAGE_API_URL`).
//
// Sem `endpoint` o cliente FALHA FECHADO (`not_configured`) — que é o
// estado real hoje: o backend ainda não está hospedado. O sistema continua
// abrindo comprovante pelo caminho legado (Supabase assinado ou base64)
// porque `loadPaymentProof` só chama isto quando o registro está marcado
// como `storage_provider: 'r2'`.
//
// Este arquivo é o ÚNICO lugar do frontend que conhece o backend de
// arquivos. Nenhum componente React fala de R2, endpoint ou URL assinada.
import {
  ATTACHMENT_SIGNED_TTL_SECONDS,
  ATTACHMENT_TYPES,
  STORAGE_PROVIDER,
  validateStoragePath,
} from './attachmentPath.js';

const FALLBACK = 'Não foi possível acessar o arquivo.';

export class AttachmentStorageError extends Error {
  constructor(code = 'unavailable', message = FALLBACK) {
    super(message);
    this.name = 'AttachmentStorageError';
    this.code = code;
    this.recoverable = true;
  }
}

/**
 * @param {object} o
 * @param {string} o.endpoint   URL do backend (`VITE_STORAGE_API_URL`)
 * @param {Function} o.getToken devolve o bearer do usuário (Supabase Auth)
 * @param {Function} [o.fetchImpl] injetável nos testes
 */
export function createAttachmentStorageClient({ endpoint, getToken, fetchImpl } = {}) {
  const call = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const base = typeof endpoint === 'string' && endpoint.trim() ? endpoint.trim().replace(/\/+$/, '') : null;

  async function request(path, { method = 'GET', body, signal, contentType } = {}) {
    if (!base || !call) throw new AttachmentStorageError('not_configured');
    const token = await getToken?.();
    const response = await call(`${base}${path}`, {
      method,
      signal,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': contentType } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      // 401/403 NÃO caem no código genérico: o operador precisa saber que
      // é sessão, não "o sistema está fora".
      const code = response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : (payload?.error || `http_${response.status}`);
      throw new AttachmentStorageError(code, payload?.message || FALLBACK);
    }
    return payload;
  }

  const query = (params) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  const cache = { writeProvider: null };

  return Object.freeze({
    get configured() { return Boolean(base); },

    /**
     * FEATURE FLAG de escrita, lida do BACKEND (única autoridade).
     * `r2` só é devolvido se o backend realmente tem R2 configurado.
     * Sem backend alcançável, devolve `supabase` — que é exatamente o
     * comportamento de antes desta fase, sem risco de mandar anexo para o
     * lugar errado.
     */
    async writeProvider() {
      if (!base) return STORAGE_PROVIDER.SUPABASE;
      if (cache.writeProvider) return cache.writeProvider;
      const health = await this.health();
      const provider = health?.ready && health?.write_provider === STORAGE_PROVIDER.R2
        ? STORAGE_PROVIDER.R2
        : STORAGE_PROVIDER.SUPABASE;
      cache.writeProvider = provider;
      return provider;
    },

    /** Estado do backend. Nunca lança: a UI precisa sempre renderizar. */
    async health() {
      try {
        const payload = await request('/storage/health');
        return { ...payload, ready: payload?.configured === true };
      } catch (error) {
        return { provider: STORAGE_PROVIDER.R2, configured: false, ready: false, code: error?.code || 'unavailable' };
      }
    },

    /** URL temporária. É o caminho normal de leitura. */
    async signedUrl(path, { prefix, expiresIn = ATTACHMENT_SIGNED_TTL_SECONDS, signal } = {}) {
      const payload = await request(`/storage/signed-url${query({ path, prefix, expiresIn })}`, { signal });
      if (!payload?.url) throw new AttachmentStorageError('unavailable');
      return payload.url;
    },

    /** Proxy do arquivo: alternativa quando a URL do R2 não é alcançável. */
    objectUrl(path, { prefix } = {}) {
      return `${base}/storage/object${query({ path, prefix })}`;
    },

    async exists(path, { prefix } = {}) {
      const payload = await request(`/storage/exists${query({ path, prefix })}`);
      return payload?.exists === true;
    },

    /**
     * Upload. O corpo é o binário puro (nada de base64 — o arquivo base64 é
     * exatamente o que o R2 vem para eliminar). Devolve os campos a gravar
     * no registro, no MESMO formato usado pelo caminho legado.
     */
    async upload({ prefix, recordId, file, signal } = {}) {
      if (!ATTACHMENT_TYPES.includes(file?.type)) throw new AttachmentStorageError('invalid_file', 'Selecione um arquivo JPG, PNG, WEBP ou PDF.');
      const payload = await request(
        `/storage/upload${query({ prefix, recordId, contentType: file.type, fileName: file.name || '' })}`,
        { method: 'POST', body: file, contentType: file.type, signal },
      );
      if (!payload?.storage_path) throw new AttachmentStorageError('unavailable');
      return payload;
    },
  });
}
