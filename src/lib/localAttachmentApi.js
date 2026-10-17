// Cliente da API local de anexos do ADM-RUY (Agente 4).
//
// Contrato de integração com o servidor `scripts/production/anexosApi.mjs`:
// - login local (`/api/anexos/auth/login`) com token guardado em sessionStorage;
// - upload com validação de tipo/tamanho/conteúdo ANTES de enviar;
// - leitura por ID com sessão ou por URL assinada de 5 minutos (`signedUrl`);
// - valores nos registros usam o formato `ruy-anexo://<id>` (identificador
//   interno opaco; o nome original nunca vira caminho público);
// - `mirrorRemote` espelha um anexo REMOTO (ex.: Supabase Storage) para o
//   ADM-RUY e só devolve `available: true` depois de baixar, validar o
//   conteúdo (magic bytes) e conferir o SHA-256 com o servidor — cópia não
//   validada nunca é declarada disponível.
//
// Sem Supabase: este módulo não importa o SDK; depende apenas de `fetch`.

import {
  PAYMENT_PROOF_TYPES,
  PAYMENT_PROOF_MAX_BYTES,
  validateContent,
  validatePaymentProofFile,
} from './paymentProof.js';

export const ANEXO_VALUE_PREFIX = 'ruy-anexo://';
export const ANEXO_TOKEN_KEY = 'gr_anexos_token';

export function encodeAnexoValue(attachmentId) {
  if (!/^anx_[0-9a-f]{32}$/.test(String(attachmentId || ''))) {
    throw new Error('Identificador de anexo local inválido.');
  }
  return `${ANEXO_VALUE_PREFIX}${attachmentId}`;
}

export function decodeAnexoValue(value) {
  if (typeof value !== 'string' || !value.startsWith(ANEXO_VALUE_PREFIX)) return null;
  const id = value.slice(ANEXO_VALUE_PREFIX.length);
  return /^anx_[0-9a-f]{32}$/.test(id) ? id : null;
}

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Cria um cliente isolado (injetável para testes).
 * Em produção use `createAnexosClient()` com a origem atual (baseUrl '').
 */
export function createAnexosClient({
  baseUrl = '',
  fetchImpl,
  storage,
  fileValidator = async (file) => { await validatePaymentProofFile(file); await validateContent(file); },
} = {}) {
  const base = normalizeBase(
    baseUrl || import.meta.env?.VITE_ANEXOS_ENDPOINT || '',
  );
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const store = storage || (
    globalThis.sessionStorage || memoryStorage()
  );

  const getToken = () => store.getItem(ANEXO_TOKEN_KEY);
  const setToken = (value) => (value ? store.setItem(ANEXO_TOKEN_KEY, value) : store.removeItem(ANEXO_TOKEN_KEY));

  async function jsonRequest(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    const response = await doFetch(`${base}${path}`, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.message || `Falha na API de anexos (HTTP ${response.status}).`);
      error.status = response.status;
      error.code = payload?.error || 'erro_anexos';
      error.retryAfterMs = payload?.retry_after_ms;
      throw error;
    }
    return payload;
  }

  return {
    baseUrl: base,
    getToken,
    /** API está no ar? (usado para decidir modo local/nuvem sem Supabase) */
    async ping() {
      try {
        const payload = await jsonRequest('/api/anexos/ping', { auth: false });
        return payload?.service === 'anexos-locais';
      } catch {
        return false;
      }
    },
    /** Provisiona a primeira conta admin (somente loopback no servidor). */
    bootstrap({ email, password, name }) {
      return jsonRequest('/api/anexos/auth/bootstrap', { method: 'POST', body: { email, password, name }, auth: false });
    },
    async login({ email, password }) {
      const session = await jsonRequest('/api/anexos/auth/login', { method: 'POST', body: { email, password }, auth: false });
      setToken(session.access_token);
      return session.user;
    },
    logout() { setToken(null); },
    isAuthenticated() { return Boolean(getToken()); },

    /**
     * Envia um anexo validado. Só devolve `available: true` com o
     * `attachment_id` devolvido pelo servidor (201 + hash conferido).
     */
    async upload({ file, entity, recordId, field = 'anexo' }) {
      await fileValidator(file);
      const response = await doFetch(`${base}/api/anexos`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': file.type,
          'X-File-Name': encodeURIComponent(file.name || 'anexo'),
          'X-Record-Entity': encodeURIComponent(entity),
          'X-Record-Id': encodeURIComponent(recordId),
          'X-Attachment-Field': encodeURIComponent(field),
        },
        body: file,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(payload?.message || `Falha no upload do anexo (HTTP ${response.status}).`);
        error.status = response.status;
        error.code = payload?.error || 'erro_upload';
        throw error;
      }
      return { ...payload, available: true, value: encodeAnexoValue(payload.attachment_id) };
    },

    metadata(attachmentId) {
      return jsonRequest(`/api/anexos/${attachmentId}`);
    },

    /** URL assinada de 5 min, pronta para `<img src>`/`<a href>`. */
    async signedUrl(attachmentId) {
      const payload = await jsonRequest(`/api/anexos/${attachmentId}/url-assinada`, { method: 'POST' });
      return `${base}${payload.url}`;
    },

    /** Baixa o conteúdo com sessão e revalida o conteúdo recebido. */
    async contentBlob(attachmentId) {
      const response = await doFetch(`${base}/api/anexos/${attachmentId}/conteudo`, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        const error = new Error(`Falha ao carregar o anexo (HTTP ${response.status}).`);
        error.status = response.status;
        throw error;
      }
      const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!PAYMENT_PROOF_TYPES.includes(mime)) {
        throw new Error('A API de anexos devolveu um tipo de conteúdo não permitido.');
      }
      return validateContent(await response.blob());
    },

    /** Resolve um valor `ruy-anexo://<id>` para Blob; outros valores → null. */
    async resolveValue(value) {
      const id = decodeAnexoValue(value);
      return id ? this.contentBlob(id) : null;
    },

    deleteAttachment(attachmentId) {
      return jsonRequest(`/api/anexos/${attachmentId}`, { method: 'DELETE' });
    },

    /** Fila de operações pendentes (somente admin). */
    pendencias() {
      return jsonRequest('/api/anexos/pendencias');
    },

    /**
     * Espelha um anexo remoto (ex.: signed URL do Supabase) para o ADM-RUY.
     *
     * Regra do Agente 4: `available: true` SOMENTE após (1) download bem
     * sucedido, (2) validação de magic bytes/TIPO e (3) SHA-256 conferido com
     * o valor registrado pelo servidor. Qualquer falha → `available: false`.
     */
    async mirrorRemote({ remoteUrl, entity, recordId, field = 'anexo', remoteFetch } = {}) {
      const fail = (reason) => ({ available: false, reason, attachment_id: null, value: null });
      if (!remoteUrl || typeof remoteUrl !== 'string') return fail('url_ausente');
      if (remoteUrl.startsWith('blob:')) return fail('blob_url_nao_persistente');
      const baixar = remoteFetch || doFetch;
      let response;
      try {
        response = await baixar(remoteUrl, {
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch {
        return fail('download_falhou');
      }
      if (!response.ok) return fail(`download_http_${response.status}`);
      const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!PAYMENT_PROOF_TYPES.includes(mime)) return fail('tipo_remoto_nao_permitido');
      if (Number(response.headers.get('content-length')) > PAYMENT_PROOF_MAX_BYTES) return fail('tamanho_remoto_excede');
      let blob;
      try {
        blob = await response.blob();
        await validateContent(new Blob([blob], { type: mime }));
      } catch {
        return fail('conteudo_remoto_invalido');
      }
      if (blob.size > PAYMENT_PROOF_MAX_BYTES) return fail('tamanho_remoto_excede');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const shaLocal = await sha256Hex(bytes);
      let enviado;
      try {
        enviado = await this.upload({
          file: new File([bytes], 'anexo-espelho', { type: mime }),
          entity, recordId, field,
        });
      } catch (error) {
        return fail(error.code || 'upload_espelho_falhou');
      }
      // Só está disponível se o servidor registrou EXATAMENTE estes bytes.
      if (enviado.sha256 !== shaLocal) return fail('hash_divergente');
      return {
        available: true,
        attachment_id: enviado.attachment_id,
        value: enviado.value,
        sha256: enviado.sha256,
        bytes: enviado.bytes,
        mime_type: mime,
        source: 'espelho_remoto',
      };
    },
  };
}

