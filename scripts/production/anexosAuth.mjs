// Autenticação da API local de anexos do ADM-RUY (Agente 4).
//
// A API de anexos NÃO depende do Supabase: usuários ficam em
// `<producao>/auth/usuarios.json` (hash scrypt + salt) e as sessões são tokens
// HMAC-SHA256 assinados com um segredo gerado no primeiro uso em
// `<producao>/auth/segredo-sessao.key`. O segredo NUNCA entra em backup.
//
// Proteções:
// - senha com mínimo de 8 caracteres e hash scrypt (nunca texto puro);
// - limite de tentativas de login (5 falhas em 15 min por e-mail+IP → bloqueio);
// - token de sessão com expiração (8 h) e assinatura constante-time;
// - token de download (URL assinada) com TTL curto, vinculado ao anexo.
//
// Observação: contas locais da API são separadas das contas do app (Supabase
// Auth / localStorage). O provisionamento é feito por bootstrap em loopback ou
// pelo script `scripts/anexos-user.mjs` — ver docs/seguranca-anexos-backup.md.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual,
} from 'node:crypto';

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutos
export const LOGIN_MAX_FAILURES = 5; // falhas antes do bloqueio
export const DOWNLOAD_TTL_MS = 5 * 60 * 1000; // URL assinada: 5 min (mesmo TTL do Supabase)
export const PASSWORD_MIN_LENGTH = 8;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function hmac(secret, data) {
  return createHmac('sha256', secret).update(data).digest();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Hash de senha: `scrypt` com salt aleatório de 16 bytes (formato hex:salt:hash). */
export function hashPassword(password, salt = randomBytes(16)) {
  const derived = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const derived = scryptSync(String(password), salt, 64);
  return timingSafeEqual(derived, expected);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw Object.assign(
      new Error(`A senha da API de anexos precisa de pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`),
      { status: 422, code: 'senha_invalida' },
    );
  }
  return password;
}

export function validateEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalized)) {
    throw Object.assign(new Error('Informe um e-mail válido para a conta da API de anexos.'), {
      status: 422, code: 'email_invalido',
    });
  }
  return normalized;
}

/**
 * Limite de tentativas de login: janela deslizante por chave (IP + e-mail).
 * `check` é consultado ANTES de validar; `fail` registra; `succeed` zera.
 */
export function createLoginLimiter({
  maxFailures = LOGIN_MAX_FAILURES,
  windowMs = LOGIN_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  const failures = new Map(); // chave -> timestamps das falhas
  function prune(key) {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) || []).filter((ts) => ts > cutoff);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  }
  return {
    check(key) {
      const list = prune(key);
      if (list.length >= maxFailures) {
        const retryAfterMs = Math.max(0, list[0] + windowMs - now());
        return { allowed: false, retryAfterMs };
      }
      return { allowed: true, retryAfterMs: 0 };
    },
    fail(key) {
      const list = prune(key);
      list.push(now());
      failures.set(key, list);
      return list.length;
    },
    succeed(key) {
      failures.delete(key);
    },
    reset() {
      failures.clear();
    },
  };
}

/**
 * Persistência de usuários + emissão/verificação de tokens da API de anexos.
 *
 * Arquivos (todos sob `<producao>/auth/`):
 * - `usuarios.json`      → contas locais (id, e-mail, hash, papel, status);
 * - `segredo-sessao.key` → segredo HMAC de 32 bytes (criado com `wx`).
 */
export function createAuthStore({ home, now = () => Date.now(), sessionTtlMs = SESSION_TTL_MS } = {}) {
  const dir = path.join(home, 'auth');
  const usersFile = path.join(dir, 'usuarios.json');
  const secretFile = path.join(dir, 'segredo-sessao.key');
  let secretPromise = null;

  async function ensureSecret() {
    if (!secretPromise) {
      secretPromise = (async () => {
        await fs.mkdir(dir, { recursive: true });
        try {
          const existing = await fs.readFile(secretFile, 'utf8');
          if (existing.trim()) return Buffer.from(existing.trim(), 'hex');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        const secret = randomBytes(32);
        const handle = await fs.open(secretFile, 'wx');
        try {
          await handle.writeFile(secret.toString('hex'));
          await handle.sync();
        } finally {
          await handle.close();
        }
        return secret;
      })().catch((error) => {
        secretPromise = null;
        throw error;
      });
    }
    return secretPromise;
  }

  // Sem cache de usuários: outro processo (ou nova instância) que gravar uma
  // conta precisa ser visto imediatamente — e o arquivo é pequeno.
  async function readUsers() {
    try {
      const parsed = JSON.parse(await fs.readFile(usersFile, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return [];
    }
  }

  async function writeUsers(list) {
    await fs.mkdir(dir, { recursive: true });
    const temp = `${usersFile}.${randomUUID()}.tmp`;
    const handle = await fs.open(temp, 'wx');
    try {
      await handle.writeFile(JSON.stringify(list, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, usersFile);
  }

  function publicUser(user) {
    const { password_hash: _hash, ...safe } = user;
    return safe;
  }

  function sign(payload) {
    return ensureSecret().then((secret) => {
      const body = b64url(Buffer.from(JSON.stringify(payload)));
      return `v1.${body}.${b64url(hmac(secret, `v1.${body}`))}`;
    });
  }

  async function verify(token) {
    if (typeof token !== 'string' || !token.startsWith('v1.')) return null;
    const [, body, signature] = token.split('.');
    if (!body || !signature) return null;
    const secret = await ensureSecret();
    if (!safeEqual(b64url(hmac(secret, `v1.${body}`)), signature)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (!payload?.sub || typeof payload.exp !== 'number' || payload.exp <= now()) return null;
    return payload;
  }

  return {
    dir,
    usersFile,
    secretFile,
    ensureSecret,
    async countUsers() {
      return (await readUsers()).length;
    },
    async listUsers() {
      return (await readUsers()).map(publicUser);
    },

    /** Cria uma conta local da API (usado por bootstrap e pelo script CLI). */
    async createUser({ email, password, role = 'user', name = '' }) {
      const normalized = validateEmail(email);
      validatePassword(password);
      if (!['admin', 'user'].includes(role)) {
        throw Object.assign(new Error('Papel inválido para a conta da API.'), { status: 422, code: 'papel_invalido' });
      }
      const list = await readUsers();
      if (list.some((user) => user.email === normalized)) {
        throw Object.assign(new Error('Já existe uma conta da API de anexos com este e-mail.'), {
          status: 409, code: 'email_duplicado',
        });
      }
      const user = {
        id: `usr_${randomUUID().replace(/-/g, '')}`,
        email: normalized,
        name: String(name || normalized.split('@')[0]).slice(0, 80),
        role,
        status: 'active',
        password_hash: hashPassword(password),
        created_at: new Date(now()).toISOString(),
      };
      await writeUsers([...list, user]);
      return publicUser(user);
    },

    /** Autentica contra o arquivo local. Lança erro com status 401. */
    async authenticate({ email, password }) {
      const normalized = String(email || '').trim().toLowerCase();
      const list = await readUsers();
      const user = list.find((item) => item.email === normalized);
      const valid = Boolean(user) && user.status === 'active' && verifyPassword(password, user.password_hash);
      if (!valid) {
        throw Object.assign(new Error('E-mail ou senha incorretos.'), { status: 401, code: 'login_invalido' });
      }
      return publicUser(user);
    },

    /** Emite token de sessão assinado (8 h). */
    async issueSession(user) {
      const exp = now() + sessionTtlMs;
      const token = await sign({
        typ: 'sessao',
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        jti: randomUUID(),
        exp,
      });
      return { access_token: token, token_type: 'bearer', expires_at: exp, user: publicUser(user) };
    },

    /** Verifica token de sessão → claims (usuário) ou null. */
    async verifySession(token) {
      const payload = await verify(token);
      if (!payload || payload.typ !== 'sessao') return null;
      const list = await readUsers();
      const user = list.find((item) => item.id === payload.sub);
      if (!user || user.status !== 'active') return null;
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },

    /**
     * URL assinada de conteúdo: token HMAC com TTL curto, vinculado ao ID do
     * anexo — só funciona para aquele arquivo e expira em DOWNLOAD_TTL_MS.
     */
    async signDownload({ attachmentId, ttlMs = DOWNLOAD_TTL_MS }) {
      const exp = now() + ttlMs;
      const token = await sign({ typ: 'download', sub: attachmentId, exp });
      return { token, exp, expires_in: Math.max(0, Math.round((exp - now()) / 1000)) };
    },

    async verifyDownload({ attachmentId, token }) {
      const payload = await verify(token);
      // `verify()` já rejeita expirados (exp <= now); aqui só confirmamos que o
      // token é de download e aponta para ESTE anexo.
      return Boolean(payload && payload.typ === 'download' && payload.sub === attachmentId);
    },
  };
}



