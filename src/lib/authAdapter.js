export function createAuthAdapter(client, config, request = fetch) {
  const failure = (message, status = 401) => Object.assign(new Error(message), { status });
  let refreshPromise = null;

  async function accessToken() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    let session = data?.session;
    if (!session?.access_token) {
      throw failure('Sessão Supabase Auth expirada. Entre novamente.', 401);
    }

    // O SDK renova a sessão em segundo plano, mas uma requisição pode chegar
    // logo depois do vencimento. Renova explicitamente antes de usar o JWT.
    const expiresAt = Number(session.expires_at) * 1000;
    if (expiresAt && expiresAt <= Date.now() + 30_000) {
      if (typeof client.auth.refreshSession !== 'function') {
        throw failure('Sessão Supabase Auth expirada. Entre novamente.', 401);
      }
      if (!refreshPromise) {
        refreshPromise = Promise.resolve()
          .then(() => client.auth.refreshSession())
          .finally(() => { refreshPromise = null; });
      }
      const refreshed = await refreshPromise;
      if (refreshed?.error) throw refreshed.error;
      if (!refreshed?.data?.session?.access_token) {
        throw failure('Sessão Supabase Auth expirada. Entre novamente.', 401);
      }
      session = refreshed.data.session;
    }

    if (!session?.access_token) {
      throw failure('Sessão Supabase Auth expirada. Entre novamente.', 401);
    }
    return session.access_token;
  }

  async function me() {
    const token = await accessToken();
    const { data, error } = await client.auth.getUser(token);
    if (error) throw error;
    const user = data?.user;
    const meta = user?.app_metadata || {};
    if (!meta.legacy_auth_user_id || !meta.system_role) {
      throw failure('Usuário sem vínculo/permissão no sistema. Contate o administrador.', 403);
    }

    const query = new URLSearchParams({
      entity: 'eq.AuthUser',
      id: `eq.${meta.legacy_auth_user_id}`,
      select: 'id,full_name:data->>full_name,status:data->>status',
    });
    const response = await request(`${config.url}/rest/v1/records?${query}`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw failure(`Falha ao consultar perfil (HTTP ${response.status}).`, response.status);
    }

    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw failure('Perfil legado não encontrado ou sem permissão de leitura.', 403);
    }
    const profile = rows[0];
    const status = String(profile.status || '').toLowerCase();
    if (['inactive', 'inativo', 'disabled', 'bloqueado'].includes(status)) {
      throw failure('Acesso desativado.', 403);
    }
    return {
      id: profile.id,
      auth_user_id: user.id,
      email: user.email,
      full_name: profile.full_name || user.email,
      status: profile.status,
      role: meta.system_role,
      employee_payment_access: meta.employee_payment_access === true,
    };
  }

  const notAvailable = async () => {
    throw failure('Acesso somente para contas autorizadas. Solicite o cadastro ao administrador.', 403);
  };

  return {
    accessToken,
    me,
    async isAuthenticated() {
      try { await me(); return true; } catch { return false; }
    },
    async loginViaEmailPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      if (!data.session?.access_token) {
        throw failure('O Supabase Auth não retornou uma sessão válida.', 401);
      }
      try {
        await me();
      } catch (err) {
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
        throw err;
      }
      return { access_token: data.session.access_token };
    },
    async logout(redirectUrl) {
      let signOutError = null;
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        signOutError = error;
      } finally {
        // remove somente caches de autenticação; dados de Employees e registros
        // de aplicação não são apagados no logout.
        for (const key of [
          'gr_local_session',
          'gr_local_pending_registration',
          'gr_local_users',
          'ruy_supabase_auth',
          'base44_access_token',
          'token',
        ]) {
          globalThis.localStorage?.removeItem(key);
        }
      }
      if (signOutError) throw signOutError;
      if (redirectUrl) window.location.assign('/login');
    },
    redirectToLogin(returnTo) {
      window.location.assign('/login' + (returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''));
    },
    register: notAvailable,
    verifyOtp: notAvailable,
    resendOtp: notAvailable,
    loginWithProvider() {
      throw failure('Use e-mail e senha da conta autorizada.', 400);
    },
    setToken() { /* Somente o SDK gerencia a sessão. */ },
    async resetPasswordRequest(email) {
      const normalized = email.trim().toLowerCase();
      if (!normalized) throw new Error('Informe o e-mail da conta.');
      const { error } = await client.auth.resetPasswordForEmail(normalized, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      return { ok: true };
    },
    async resetPassword({ newPassword }) {
      await accessToken();
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      const result = await client.auth.signOut({ scope: 'local' });
      if (result.error) throw result.error;
    },
  };
}
