import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getHousehold, getMyMembership, type Household, type Membership } from './household';

interface AuthState {
  session: Session | null;
  membership: Membership | null;
  household: Household | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  membership: null,
  household: null,
  loading: true,
  error: null,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembership = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setMembership(null);
      setHousehold(null);
      return;
    }
    try {
      const m = await getMyMembership();
      setMembership(m);
      if (m) {
        const hh = await getHousehold(m.household_id);
        setHousehold(hh);
      } else {
        setHousehold(null);
      }
    } catch (e: any) {
      // RLS / belum ada tabel saat pertama kali — jangan blokir login
      setError(e?.message ?? 'Gagal memuat ruang keluarga.');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const {
      data: { session: s },
    } = await supabase.auth.getSession();
    setSession(s);
    await loadMembership(s?.user.id);
  }, [loadMembership]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError('Supabase belum dikonfigurasi. Isi EXPO_PUBLIC_SUPABASE_URL dan EXPO_PUBLIC_SUPABASE_ANON_KEY di .env');
      return;
    }
    let mounted = true;
    (async () => {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(s);
      await loadMembership(s?.user.id);
      setLoading(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      await loadMembership(s?.user.id);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMembership]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setMembership(null);
    setHousehold(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, membership, household, loading, error, refresh, signOut }),
    [session, membership, household, loading, error, refresh, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
