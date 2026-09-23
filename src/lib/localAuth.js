// Autenticação 100% local (sem servidor): usuários e sessões ficam no
// navegador (localStorage). O código de confirmação (OTP) do cadastro é
// GERADO de verdade (6 dígitos, expira em 10 min, 5 tentativas) e enviado
// por e-mail real quando o EmailJS está configurado em src/lib/emailSender.js.
// Sem configuração, o código aparece na própria tela de verificação
// (modo demonstração) para o fluxo nunca ficar bloqueado.
//
// ACESSO AO SISTEMA: toda conta usa a MESMA senha fixa (SYSTEM_PASSWORD).
// Login exige e-mail já cadastrado + essa senha.

import { sendVerificationCode } from '@/lib/emailSender';

export const SYSTEM_PASSWORD = 'Faby2335@';

const USERS_KEY = 'gr_local_users';
const SESSION_KEY = 'gr_local_session';
const PENDING_KEY = 'gr_local_pending_registration';

const OTP_TTL_MS = 10 * 60 * 1000; // código expira em 10 minutos
const OTP_MAX_ATTEMPTS = 5; // bloqueia após 5 códigos errados
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem(USERS_KEY)) || [];
  } catch {
    return [];
  }
}
function writeUsers(list) {
  localStorage.setItem(USERS_KEY, JSON.stringify(list));
}
function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}
function readPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY)) || null;
  } catch {
    return null;
  }
}
function writePending(pending) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}
function uid() {
  return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function generateOtp() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  // Garante sempre 6 dígitos (ex.: 000123).
  return String(bytes[0] % 1000000).padStart(6, '0');
}
function findByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  return readUsers().find((u) => u.email.toLowerCase() === target);
}
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function authError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function issueOtp(pending) {
  const code = generateOtp();
  const updated = {
    ...pending,
    otpCode: code,
    otpExpiresAt: Date.now() + OTP_TTL_MS,
    otpAttempts: 0,
  };
  writePending(updated);
  // Envio best-effort: se o serviço de e-mail falhar (bloqueio, chave
  // inválida, sem rede), o cadastro NÃO é travado — o código é exibido
  // na própria tela de verificação (modo demonstração) com o aviso.
  let delivered = false;
  let warning;
  try {
    const result = await sendVerificationCode(updated.email, code);
    delivered = !!result.delivered;
  } catch (err) {
    warning = err.message;
  }
  return {
    ok: true,
    delivered,
    code: delivered ? undefined : code,
    warning: delivered ? undefined : warning,
  };
}

export const localAuth = {
  async isAuthenticated() {
    return !!readSession();
  },

  async me() {
    const session = readSession();
    if (!session) throw authError('Não autenticado.', 401);
    const user = readUsers().find((u) => u.id === session.userId);
    if (!user) throw authError('Não autenticado.', 401);
    const { password, ...safe } = user;
    return safe;
  },

  async loginViaEmailPassword(email, password) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalized)) {
      throw new Error('Informe um e-mail válido.');
    }
    const user = findByEmail(normalized);
    if (!user) {
      throw new Error('E-mail não cadastrado. Faça o cadastro primeiro.');
    }
    if (password !== SYSTEM_PASSWORD) {
      throw new Error('Senha incorreta. Use a senha de acesso do sistema.');
    }
    // Migração: qualquer conta antiga passa a usar a senha fixa do sistema.
    if (user.password !== SYSTEM_PASSWORD) {
      user.password = SYSTEM_PASSWORD;
      writeUsers(readUsers().map((u) => (u.id === user.id ? user : u)));
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: user.id }));
    return { access_token: `local-${user.id}` };
  },

  loginWithProvider() {
    throw new Error('Login com Google não está disponível nesta versão local do app.');
  },

  logout(redirectUrl) {
    localStorage.removeItem(SESSION_KEY);
    if (redirectUrl) window.location.href = '/login';
  },

  redirectToLogin(returnTo) {
    window.location.href = '/login' + (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '');
  },

  /**
   * Inicia o cadastro: valida os dados, gera o código de 6 dígitos e
   * tenta enviá-lo por e-mail. Retorna { delivered, code }.
   */
  async register({ email, password }) {
    const normalized = normalizeEmail(email);
    if (!EMAIL_REGEX.test(normalized)) {
      throw new Error('Informe um e-mail válido (ex.: nome@provedor.com).');
    }
    if (!password) {
      throw new Error('Informe a senha de acesso.');
    }
    if (password !== SYSTEM_PASSWORD) {
      throw new Error(`A senha de acesso do sistema é "${SYSTEM_PASSWORD}".`);
    }
    if (findByEmail(normalized)) {
      throw new Error('Já existe uma conta com este e-mail. Faça o login.');
    }
    const isFirstUser = readUsers().length === 0;
    const pending = {
      email: normalized,
      password: SYSTEM_PASSWORD,
      full_name: normalized.split('@')[0],
      // O primeiro usuário cadastrado no app vira admin automaticamente.
      role: isFirstUser ? 'admin' : 'user',
      created_at: Date.now(),
    };
    writePending(pending);
    try {
      return await issueOtp(pending);
    } catch (err) {
      // Falhou o envio real de e-mail: mantém o cadastro pendente e
      // informa o erro para a tela mostrar (o fluxo não é perdido).
      throw new Error(
        `${err.message} Verifique a configuração do envio de e-mail (src/lib/emailSender.js).`
      );
    }
  },

  /** Gera um NOVO código e reenvia para o e-mail do cadastro pendente. */
  async resendOtp(email) {
    const pending = readPending();
    if (!pending || pending.email !== normalizeEmail(email)) {
      throw new Error('Cadastro não encontrado. Faça o cadastro novamente.');
    }
    if (findByEmail(pending.email)) {
      throw new Error('Este e-mail já está cadastrado. Faça o login.');
    }
    return issueOtp(pending);
  },

  /**
   * Confirma o cadastro com o código recebido por e-mail.
   * valida formato, expiração (10 min) e nº de tentativas (5).
   */
  async verifyOtp({ email, otpCode }) {
    const pending = readPending();
    const normalized = normalizeEmail(email);
    if (!pending || pending.email !== normalized) {
      throw new Error('Cadastro não encontrado. Faça o cadastro novamente.');
    }
    if (!pending.otpExpiresAt || Date.now() > pending.otpExpiresAt) {
      throw new Error('O código expirou. Clique em "Reenviar código".');
    }
    if ((pending.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      throw new Error('Muitas tentativas erradas. Faça o cadastro novamente.');
    }
    const code = String(otpCode || '').trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      throw new Error('O código tem 6 dígitos numéricos.');
    }
    if (code !== pending.otpCode) {
      pending.otpAttempts = (pending.otpAttempts || 0) + 1;
      writePending(pending);
      const restantes = OTP_MAX_ATTEMPTS - pending.otpAttempts;
      throw new Error(`Código incorreto. ${restantes} tentativa(s) restante(s).`);
    }

    const id = uid();
    const now = new Date().toISOString();
    const user = {
      id,
      email: pending.email,
      password: SYSTEM_PASSWORD,
      full_name: pending.full_name,
      role: pending.role,
      created_date: now,
    };
    const users = readUsers();
    users.push(user);
    writeUsers(users);
    localStorage.removeItem(PENDING_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: id }));
    return { access_token: `local-${id}` };
  },

  setToken() {
    // Sessão já é definida em loginViaEmailPassword/verifyOtp; nada a fazer.
  },

  async resetPasswordRequest() {
    // Sem servidor de e-mail próprio além do EmailJS do cadastro:
    // apenas confirma o pedido (a tela sempre mostra sucesso).
    return { ok: true };
  },

  async resetPassword() {
    throw new Error(
      'A senha do sistema é única para todos os usuários. Peça a um administrador.'
    );
  },
};
