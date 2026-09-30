import { createClient } from '@supabase/supabase-js';
import { cloudConfig } from './cloudConfig.js';
import { createAuthAdapter } from './authAdapter.js';
export const supabase = createClient(cloudConfig.url, cloudConfig.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ruy_supabase_auth' },
});
export const supabaseAuth = createAuthAdapter(supabase, cloudConfig);
export const getAccessToken = () => supabaseAuth.accessToken();

/**
 * Força a renovação da sessão.
 *
 * Existe para o caso em que a sessão expira com a tela aberta: `accessToken()`
 * já tenta renovar sozinho, mas se a renovação falhar uma vez (rede, refresh
 * token rotacionado), TODAS as leituras passam a falhar juntas e a tela fica
 * zerada sem se recuperar sozinha. Quem chama isso consegue tentar de novo
 * depois, em vez de ficar preso no estado quebrado.
 *
 * Não altera a política de autenticação: apenas pede um refresh ao SDK.
 */
export async function renovarSessao() {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return { ok: false, mensagem: error.message };
  return { ok: Boolean(data?.session?.access_token) };
}
