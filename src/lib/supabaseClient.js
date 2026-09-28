import { createClient } from '@supabase/supabase-js';
import { cloudConfig } from './cloudConfig.js';
import { createAuthAdapter } from './authAdapter.js';
export const supabase = createClient(cloudConfig.url, cloudConfig.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ruy_supabase_auth' },
});
export const supabaseAuth = createAuthAdapter(supabase, cloudConfig);
export const getAccessToken = () => supabaseAuth.accessToken();
