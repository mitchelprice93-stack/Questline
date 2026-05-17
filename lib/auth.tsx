import type { AuthError, Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  hasSeenCinematic,
  hasSeenCinematicOnDevice,
  markCinematicSeen as markSeenAsync,
  markCinematicSeenOnDevice as markDeviceSeenAsync,
  resetCinematicSeen as resetSeenAsync,
} from './cinematic';
import { onUserLogin } from './engine/achievementTriggers';
import { registerPushTokenForCurrentUser } from './notifications';
import { clearQuestCache } from './offline';
import { getCurrentProfile } from './profile';
import { configurePurchases, logoutPurchases } from './purchases';
import { getSubscriptionStatus, type SubscriptionStatus } from './subscription';
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
  /** Device-level flag — null until the first check resolves. Used to
   *  gate the pre-auth cinematic for first-time visitors. */
  cinematicSeenOnDevice: boolean | null;
  /** Mark the device flag (used when an unauthenticated visitor finishes
   *  the pre-auth cinematic). Idempotent. */
  markCinematicSeenOnDevice: () => Promise<void>;
  /** True between Supabase firing PASSWORD_RECOVERY (user tapped the reset
   *  link) and the user setting a new password. While true, useProtectedRoute
   *  pins the user on /reset-password regardless of normal session-based
   *  routing rules. Cleared by clearPasswordRecovery (call after success). */
  inPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  /** null until the first subscription fetch resolves. */
  subscription: SubscriptionStatus | null;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  /** Re-fetch the profile (call after character creation, settings updates, etc.). */
  refetchProfile: () => Promise<void>;
  /** Re-fetch subscription status (call after a paywall purchase or webhook update). */
  refetchSubscription: () => Promise<void>;
  /** Mark the cinematic as seen for the current user (persists + updates state). */
  markCinematicSeen: () => Promise<void>;
  /** Wipe the seen flag so the cinematic plays again. Used by Reset Character. */
  resetCinematicSeen: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [cinematicSeen, setCinematicSeen] = useState<boolean | null>(null);
  const [cinematicSeenOnDevice, setCinematicSeenOnDevice] = useState<boolean | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [inPasswordRecovery, setInPasswordRecovery] = useState(false);

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

  const refetchSubscription = useCallback(async () => {
    try {
      const s = await getSubscriptionStatus();
      setSubscription(s);
    } catch (e) {
      console.warn('refetchSubscription failed', e);
      // Default to free on error so the cap still applies.
      setSubscription({ tier: 'free', status: null, expires_at: null });
    }
  }, []);

  const markCinematicSeen = useCallback(async () => {
    if (!session?.user.id) return;
    await markSeenAsync(session.user.id);
    setCinematicSeen(true);
  }, [session?.user.id]);

  const resetCinematicSeen = useCallback(async () => {
    if (!session?.user.id) return;
    await resetSeenAsync(session.user.id);
    setCinematicSeen(false);
  }, [session?.user.id]);

  const markCinematicSeenOnDevice = useCallback(async () => {
    await markDeviceSeenAsync();
    setCinematicSeenOnDevice(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    // Renamed from `subscription` to avoid clashing with the
    // `subscription` state variable below (RevenueCat tier).
    const { data: authSub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setLoading(false);
      // PASSWORD_RECOVERY fires when the user taps the reset link from
      // their email and the deep-link returns them to the app. They have
      // a special short-lived session that lets them call updateUser()
      // with a new password; useProtectedRoute pins them to the
      // /reset-password screen until they finish.
      if (event === 'PASSWORD_RECOVERY') {
        setInPasswordRecovery(true);
      }
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, []);

  // Deep-link handler: when the app is opened via questline:// URLs
  // (notably the password-recovery email link), the Supabase JS client
  // does NOT auto-detect tokens in the URL on React Native — we have
  // `detectSessionInUrl: false` in lib/supabase.ts and no equivalent of
  // window.location to read from. So we parse the URL ourselves and
  // hand the tokens to supabase.auth.setSession (implicit/hash flow) or
  // exchangeCodeForSession (PKCE flow). That call fires PASSWORD_RECOVERY,
  // which the gate above turns into a redirect to /reset-password, and
  // gives updateUser() a valid session to mutate.
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url) return;

      // PKCE flow: ?code=... in the query string. Newer Supabase default.
      const codeMatch = url.match(/[?&]code=([^&#]+)/);
      if (codeMatch) {
        const { error } = await supabase.auth.exchangeCodeForSession(
          decodeURIComponent(codeMatch[1]),
        );
        if (error) console.warn('exchangeCodeForSession failed', error);
        return;
      }

      // Implicit flow: #access_token=...&refresh_token=...&type=recovery
      const hashIndex = url.indexOf('#');
      if (hashIndex === -1) return;
      const hash = url.slice(hashIndex + 1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) console.warn('setSession from deep link failed', error);
      }
    };

    // Cold launch — the link that opened the app.
    Linking.getInitialURL().then(handleUrl);
    // Warm launch — links delivered while the app is already running.
    const sub = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => sub.remove();
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

  // Load the device-level cinematic flag once on mount. Doesn't depend on
  // session — it gates the pre-auth cinematic for first-time visitors.
  useEffect(() => {
    hasSeenCinematicOnDevice().then(setCinematicSeenOnDevice);
  }, []);

  // Load cinematic-seen flag when session changes.
  useEffect(() => {
    if (loading) return;
    if (!session) {
      setCinematicSeen(null);
      return;
    }
    hasSeenCinematic(session.user.id).then(async (userSeen) => {
      // Promote the device flag to the per-user flag: if the visitor
      // watched the pre-auth cinematic and just signed up, don't make
      // them sit through it again before character creation. Per-user
      // flag is still authoritative for the Settings → Replay flow.
      if (!userSeen) {
        const deviceSeen = await hasSeenCinematicOnDevice();
        if (deviceSeen) {
          await markSeenAsync(session.user.id);
          setCinematicSeen(true);
          return;
        }
      }
      setCinematicSeen(userSeen);
    });
  }, [session?.user.id, loading]);

  // Refetch subscription whenever the session changes.
  useEffect(() => {
    if (loading) return;
    if (!session) {
      setSubscription(null);
      return;
    }
    refetchSubscription();
    // Refresh the push token on every fresh session so it's never stale.
    // No-op on web / without notification permission.
    void registerPushTokenForCurrentUser();
    // Tell RevenueCat which user just signed in so cross-device entitlements
    // attribute correctly. No-op on web / without an RC API key.
    if (session?.user.id) {
      void configurePurchases(session.user.id);
      // Achievement check: drives Resurrected (30+ day absence) and
      // Final Page (365 days since character creation), and stamps a
      // fresh last_seen_at for the next session to compare against.
      void onUserLogin(session.user.id);
    }
  }, [session?.user.id, loading, refetchSubscription]);

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    profileLoading,
    cinematicSeen,
    cinematicSeenOnDevice,
    markCinematicSeenOnDevice,
    inPasswordRecovery,
    clearPasswordRecovery: () => setInPasswordRecovery(false),
    subscription,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error };
    },
    signOut: async () => {
      // Wipe the offline cache so the next user on the device doesn't see
      // the previous user's quest list. Also reset RC's user identity.
      await clearQuestCache();
      await logoutPurchases();
      const { error } = await supabase.auth.signOut();
      return { error };
    },
    refetchProfile,
    refetchSubscription,
    markCinematicSeen,
    resetCinematicSeen,
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
 *   - no session, never seen cinematic on device → /cinematic (pre-auth buy-in)
 *   - no session, seen cinematic, outside (auth) → /login
 *   - session, inside (auth)                     → next onboarding step (or /quest-board if done)
 *   - session, no character, not in (onboarding) → next onboarding step
 *
 * Onboarding order: cinematic (first run) → character-creation → quest-board.
 */
export function useProtectedRoute() {
  const {
    session,
    profile,
    loading,
    profileLoading,
    cinematicSeen,
    cinematicSeenOnDevice,
    inPasswordRecovery,
  } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    // While the initial profile or cinematic check is in flight, don't
    // redirect — we'd bounce the user prematurely.
    if (session && profileLoading) return;
    if (session && cinematicSeen === null) return;
    // For no-session users, wait until the device-level cinematic flag
    // has resolved so we know whether to send them to /cinematic or /login.
    if (!session && cinematicSeenOnDevice === null) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    const onCinematic = inOnboarding && segments[1] === 'cinematic';
    const onCharacterCreation = inOnboarding && segments[1] === 'character-creation';
    const onResetPassword = inAuthGroup && segments[1] === 'reset-password';
    const hasCharacter = !!profile?.character_name;

    type GateRoute =
      | '/login'
      | '/quest-board'
      | '/character-creation'
      | '/cinematic'
      | '/reset-password';
    const nextOnboardingStep = (): GateRoute =>
      cinematicSeen ? '/character-creation' : '/cinematic';

    // Password recovery takes priority over every other gate. The user has
    // a special short-lived session and they MUST set a new password
    // before any other navigation makes sense.
    if (inPasswordRecovery) {
      if (!onResetPassword) {
        router.replace('/reset-password');
      }
      return;
    }

    let target: GateRoute | null = null;
    if (!session) {
      // Pre-auth cinematic gating: first-time visitors see the cinematic
      // BEFORE the login screen for emotional buy-in. Once they've watched
      // it (device flag set), subsequent visits land on login as before.
      if (!cinematicSeenOnDevice && !onCinematic) {
        target = '/cinematic';
      } else if (cinematicSeenOnDevice && !inAuthGroup) {
        target = '/login';
      }
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
  }, [
    session,
    profile,
    segments,
    loading,
    profileLoading,
    cinematicSeen,
    cinematicSeenOnDevice,
    inPasswordRecovery,
    router,
  ]);
}
