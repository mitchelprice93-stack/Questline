import type { AuthError, Session } from '@supabase/supabase-js';
import { useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { getCurrentProfile } from './profile';
import { supabase } from './supabase';
import type { Profile } from './types/models';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** True until the initial profile fetch settles. Distinct from `loading`,
   *  which only covers the initial session lookup. */
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  /** Re-fetch the profile (call after character creation, settings updates, etc.). */
  refetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);

  const refetchProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const p = await getCurrentProfile();
      setProfile(p);
    } catch (e) {
      console.warn('refetchProfile failed', e);
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Refetch profile whenever the session changes (sign in / sign out / token refresh on a fresh user).
  useEffect(() => {
    if (loading) return;
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    refetchProfile();
  }, [session?.user.id, loading, refetchProfile]);

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    profileLoading,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error };
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      return { error };
    },
    refetchProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

/**
 * Segment-aware redirect gate. Mount once inside <AuthProvider>.
 *
 * Rules:
 *   - no session, outside (auth)        → /login
 *   - session, inside (auth)            → /character-creation if no character, else /quest-board
 *   - session, no character, not in (onboarding) → /character-creation
 *
 * No rule pushes a user *away* from /(onboarding)/character-creation. The
 * reveal screen at the end of character creation needs to render even after
 * the profile gains a character_name; the user proceeds via the in-screen CTA.
 */
export function useProtectedRoute() {
  const { session, profile, loading, profileLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // While the initial profile fetch is in flight, don't redirect — we'd
    // bounce the user to /character-creation prematurely.
    if (session && profileLoading) return;

    const firstSegment = segments[0];
    const inAuthGroup = firstSegment === '(auth)';
    const inOnboarding = firstSegment === '(onboarding)';
    const hasCharacter = !!profile?.character_name;

    type GateRoute = '/login' | '/quest-board' | '/character-creation';
    let target: GateRoute | null = null;
    if (!session) {
      if (!inAuthGroup) target = '/login';
    } else if (inAuthGroup) {
      target = hasCharacter ? '/quest-board' : '/character-creation';
    } else if (!hasCharacter && !inOnboarding) {
      target = '/character-creation';
    }

    if (target) router.replace(target);
  }, [session, profile, segments, loading, profileLoading, router]);
}
