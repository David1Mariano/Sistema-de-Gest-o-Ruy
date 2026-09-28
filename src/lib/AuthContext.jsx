import { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { supabase, supabaseAuth } from './supabaseClient';
import { setCurrentUser } from './currentUserStore';
import { queryClientInstance } from './query-client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setLoading] = useState(true);
  const [authChecked, setChecked] = useState(false);
  const [authError, setError] = useState(null);
  const generation = useRef(0);
  const identity = useRef(null);

  const clearUserState = useCallback(() => {
    setCurrentUser(null);
    setUser(null);
    setError(null);
  }, []);

  const checkUserAuth = useCallback(async () => {
    const seq = ++generation.current;
    setLoading(true);
    try {
      const profile = await supabaseAuth.me();
      if (seq !== generation.current) return;
      setCurrentUser(profile);
      setUser(profile);
      setError(null);
    } catch (err) {
      if (seq !== generation.current) return;
      clearUserState();
      if (err.status !== 401) {
        setError({ type: 'profile_error', message: err.message });
      }
    } finally {
      if (seq === generation.current) {
        setLoading(false);
        setChecked(true);
      }
    }
  }, [clearUserState]);

  useEffect(() => {
    let timer;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Não executar chamadas Auth dentro do callback que detém o lock do SDK.
      const nextId = session?.user?.id || null;
      if (nextId !== identity.current || event === 'SIGNED_OUT') {
        identity.current = nextId;
        generation.current += 1;
        queryClientInstance.clear();
        clearUserState();
      }
      clearTimeout(timer);
      if (!session) {
        setLoading(false);
        setChecked(true);
      } else {
        setLoading(true);
        timer = setTimeout(checkUserAuth, 0);
      }
    });
    return () => {
      generation.current += 1;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [checkUserAuth, clearUserState]);

  const logout = useCallback(async (shouldRedirect = true) => {
    try {
      await supabaseAuth.logout();
    } finally {
      generation.current += 1;
      queryClientInstance.clear();
      clearUserState();
      setLoading(false);
      setChecked(true);
      if (shouldRedirect) window.location.assign('/login');
    }
  }, [clearUserState]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: Boolean(user),
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authChecked,
      authError,
      appPublicSettings: null,
      logout,
      checkUserAuth,
      checkAppState: checkUserAuth,
      navigateToLogin: () => supabaseAuth.redirectToLogin(window.location.href),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within an AuthProvider');
  return value;
}
