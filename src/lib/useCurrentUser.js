import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

let cached = null;

export function useCurrentUser() {
  const [user, setUser] = useState(cached);
  useEffect(() => {
    if (cached) return;
    let active = true;
    base44.auth.me()
      .then((u) => { if (active) { cached = u; setUser(u); } })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return user;
}

export function currentUserName() {
  return cached?.full_name || cached?.email || 'Sistema';
}