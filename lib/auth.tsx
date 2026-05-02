import type { AuthError, Session } from '@supabase/supabase-js';
import { useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { hasSeenCinematic, markCinematicSeen as markSeenAsync } from './cinematic';
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
  /** null until the first cinematic-seen check resolves, then true/false. */
  cinematicSeen: boolean | null;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  /** Re-fetch the profile (call after character creation, settings updates, etc.). */
  refetchProfile: () => Promise<void>;
  /** Mark the cinematic as seen for the current user (persists + updates state). */
  markCinematicSeen: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [cinematicSeen, setCinematicSeen] = useState<boolean | null>(null);

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

  const markCinematicSeen = useCallback(async () => {
    if (!session?.user.id) return;
    await markSeenAsync(session.user.id);
    setCinematicSeen(true);
  }, [session?.user.id]);

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

  // Load cinematic-seen flag when session changes.
  useEffect(() => {
    if (loading) return;
    if (!session) {
      setCinematicSeen(null);
      return;
    }
    hasSeenCinematic(session.user.id).then(setCinematicSeen);
  }, [session?.user.id, loading]);

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    profileLoading,
    cinematicSeen,
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
    markCinematicSeen,
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
 *   - session, inside (auth)            → next onboarding step (or /quest-board if done)
 *   - session, no character, not in (onboarding) → next onboarding step
 *
 * Onboarding order: cinematic (first run) → character-creation → quest-board.
 */
export function useProtectedRoute() {
  const { session, profile, loading, profileLoading, cinematicSeen } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // While the initial profile or cinematic check is in flight, don't
    // redirect — we'd bounce the user prematurely.
    if (session && profileLoading) return;
    if (session && cinematicSeen === null) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    const onCinematic = inOnboarding && segments[1] === 'cinematic';
    const onCharacterCreation = inOnboarding && segments[1] === 'character-creation';
    const hasCharacter = !!profile?.character_name;

    type GateRoute = '/login' | '/quest-board' | '/character-creation' | '/cinematic';
    const nextOnboardingStep = (): GateRoute =>
      cinematicSeen ? '/character-creation' : '/cinematic';

    let target: GateRoute | null = null;
    if (!session) {
      if (!inAuthGroup) target = '/login';
    } else if (inAuthGroup) {
      target = hasCharacter ? '/quest-board' : nextOnboardingStep();
    } else if (hasCharacter && onCharacterCreation) {
      // Already created — character-creation has its own Redirect too,
      // but the gate covers the brief window before that mounts.
      target = '/quest-board';
    } else if (!hasCharacter && !inOnboarding) {
      target = nextOnboardingStep();
    } else if (!hasCharacter && onCinematic && cinematicSeen) {
      target = '/character-creation';
    } else if (!hasCharacter && onCharacterCreation && !cinematicSeen) {
      target = '/cinematic';
    }
    // Note: /cinematic is intentionally reachable by users with a character
    // (the Settings → Replay opening cinematic button uses this).

    if (target) router.replace(target);
  }, [session, profile, segments, loading, profileLoading, cinematicSeen, router]);
}
