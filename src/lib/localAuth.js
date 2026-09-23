// Substitui o `base44.auth` por um login local, guardado no navegador
// (localStorage). Não existe mais um servidor de autenticação: os
// usuários e senhas ficam só no dispositivo onde foram cadastrados.
//
// Limitações conscientes (dá pra evoluir depois se precisar):
// - Sem servidor, as senhas ficam salvas em texto simples no navegador.
//   Não é um risco novo grande para um app de uso interno, mas evite
//   reaproveitar aqui uma senha usada em outro lugar importante.
// - "Continuar com Google" não é possível sem um backend, então mostra
//   um aviso em vez de tentar logar.
// - "Esqueci minha senha" não envia e-mail de verdade (não há servidor de
//   e-mail); por enquanto ela só confirma o pedido, sem trocar a senha.
// - O código de verificação (OTP) do cadastro não é enviado por e-mail:
//   qualquer código de 6 dígitos confirma o cadastro (ex.: 000000).

const USERS_KEY = 'gr_local_users';
const SESSION_KEY = 'gr_local_session';
const PENDING_KEY = 'gr_local_pending_registration';

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
function uid() {
  return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function findByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  return readUsers().find((u) => u.email.toLowerCase() === target);
}
function authError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
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
    const user = findByEmail(email);
    if (!user || user.password !== password) {
      throw new Error('E-mail ou senha inválidos.');
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

  async register({ email, password }) {
    if (!email || !password) throw new Error('Informe e-mail e senha.');
    if (findByEmail(email)) throw new Error('Já existe uma conta com este e-mail.');
    const isFirstUser = readUsers().length === 0;
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        email,
        password,
        full_name: email.split('@')[0],
        // O primeiro usuário cadastrado no app vira admin automaticamente.
        role: isFirstUser ? 'admin' : 'user',
      })
    );
    return { ok: true };
  },

  async resendOtp() {
    return { ok: true };
  },

  async verifyOtp({ email, otpCode }) {
    const pending = (() => {
      try {
        return JSON.parse(localStorage.getItem(PENDING_KEY));
      } catch {
        return null;
      }
    })();
    if (!pending || pending.email !== email) {
      throw new Error('Cadastro não encontrado. Faça o cadastro novamente.');
    }
    if (!otpCode || String(otpCode).length < 6) {
      throw new Error('Código inválido.');
    }
    const id = uid();
    const now = new Date().toISOString();
    const user = { id, email: pending.email, password: pending.password, full_name: pending.full_name, role: pending.role, created_date: now };
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
    // Sem servidor de e-mail: apenas confirma o pedido (a tela sempre
    // mostra sucesso, então isso não muda o comportamento visível).
    return { ok: true };
  },

  async resetPassword() {
    throw new Error('Redefinição de senha por e-mail não está disponível nesta versão local. Peça para um administrador recriar seu acesso em Configurações.');
  },
};
