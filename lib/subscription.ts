// Phase 5.1, subscription tier read.
//
// The `subscriptions` table is populated by RevenueCat webhooks (deferred).
// Until that lands, every user resolves to 'free'. The DB-side trigger
// (enforce_quest_cap) is the source of truth for gating; this helper just
// drives client UX (counts, paywall hints).

import { asError } from './errors';
import { supabase } from './supabase';

export type SubscriptionTier = 'free' | 'hero';

export const FREE_TIER_QUEST_CAP = 5;

export interface SubscriptionStatus {
  tier: SubscriptionTier;
  /** Underlying subscription state, surfaced for UI ("trial ends Apr 28"). */
  status: 'active' | 'trial' | 'expired' | 'cancelled' | null;
  expires_at: string | null;
}

/** Resolve the current user's effective tier. Defaults to 'free' on any error
 *  or missing row, the server trigger will reject if a free user tries to
 *  exceed the cap regardless of what this returns. */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { tier: 'free', status: null, expires_at: null };

  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, expires_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.warn('getSubscriptionStatus failed', error);
    return { tier: 'free', status: null, expires_at: null };
  }
  if (!data) return { tier: 'free', status: null, expires_at: null };

  // Hero requires an active/trial state and a future (or null) expiry.
  const isHeroActive =
    data.tier === 'hero' &&
    (data.status === 'active' || data.status === 'trial') &&
    (!data.expires_at || new Date(data.expires_at) > new Date());

  return {
    tier: isHeroActive ? 'hero' : 'free',
    status: data.status as SubscriptionStatus['status'],
    expires_at: data.expires_at as string | null,
  };
}

/** Postgres error code raised by enforce_quest_cap when a free-tier user
 *  has already reached the limit. */
export const QUEST_CAP_ERROR_CODE = 'P0005';

export function isQuestCapError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === QUEST_CAP_ERROR_CODE;
}

/** Resolve a server-side error to user-facing copy. The trigger raises
 *  P0005 with a serviceable message; we override with in-voice copy. */
export function questCapMessage(): string {
  return 'The Tome can hold but five open endeavors at once on the free tier. Complete or abandon one, or pledge your oath to the Archivist for unlimited inscription.';
}
