import { createLocalHttpTransport } from './localHttpTransport.mjs';
import { localContractUnavailable } from './backendSelection.mjs';
// Autenticação para a API Node local (Etapa C1)
// Usa cookies HttpOnly + CSRF token — NÃO usa Supabase Auth.

const LOCAL_API_ORIGIN = import.meta.env?.VITE_LOCAL_API_ORIGIN || globalThis.location?.origin || '';
const transport = createLocalHttpTransport();
const API_BASE = `${LOCAL_API_ORIGIN}/api/local`;

function fail(message, status = 401) {
  return Object.assign(new Error(message), { status });
}

function getCsrfToken() {
  const match = (globalThis.document?.cookie || '').match(/(?:^|;\s*)ruy_local_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function localApiLogin(email, password) {
  localContractUnavailable();
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = 'Credenciais inválidas.';
    try {
      const data = JSON.parse(text);
      if (data?.error) msg = data.error;
    } catch {}
    throw fail(msg, res.status);
  }

  const data = await res.json();
  return {
    user: data.user,
    csrf: data.csrf,
  };
}

export async function localApiLogout() {
  localContractUnavailable();
  const csrf = getCsrfToken();
  await fetch(`${API_BASE}/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
  });
  // Cookies são limpos pelo servidor (Set-Cookie com Max-Age=0)
}

export async function localApiMe() {
  localContractUnavailable();
  const res = await fetch(`${API_BASE}/me`, {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    if (res.status === 401) throw fail('Sessão expirada ou inválida. Entre novamente.', 401);
    const text = await res.text().catch(() => '');
    throw fail(`Falha ao obter sessão (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
  }

  const data = await res.json();
  return data.user;
}

export async function localApiCheckAuth() {
  try {
    await localApiMe();
    return true;
  } catch (err) {
    if (err.status !== 401) throw err;
    return false;
  }
}

export function getApiBase() {
  return API_BASE;
}

export function getLocalApiOrigin() {
  return LOCAL_API_ORIGIN;
}

// Helper para fazer requisições autenticadas à API local
export async function localApiRequest(path, { method = 'GET', body, csrf } = {}) {
  localContractUnavailable();
  return transport(API_BASE + path, { method, body, csrf, operationId: body?.operationId });
}

export function createLocalAuthAdapter() {
  let currentCsrf = null;
  let currentUser = null;

  return {
    async login(email, password) {
      const { user, csrf } = await localApiLogin(email, password);
      currentUser = user;
      currentCsrf = csrf;
      return { user, csrf };
    },

    async logout() {
      await localApiLogout();
      currentUser = null;
      currentCsrf = null;
    },

    async me() {
      currentUser = await localApiMe();
      currentCsrf = getCsrfToken();
      return currentUser;
    },

    async isAuthenticated() {
      try {
        await this.me();
        return true;
      } catch (err) {
        currentUser = null;
        currentCsrf = null;
        if (err.status !== 401) throw err;
        return false;
      }
    },

    getCsrfToken() {
      return currentCsrf || getCsrfToken();
    },

    getCurrentUser() {
      return currentUser;
    },

    async request(path, options = {}) {
      const csrf = options.csrf ?? this.getCsrfToken();
      return localApiRequest(path, { ...options, csrf });
    },

    redirectToLogin(returnTo) {
      window.location.assign(`/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`);
    },
  };
}