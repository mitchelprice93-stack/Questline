// Debuff engine client API.
//
// The DB owns the math (refresh_debuffs_for, complete_quest, rest_user RPCs).
// These wrappers just unwrap supabase-js error envelopes.

import { asError } from './errors';
import { supabase } from './supabase';

export interface ActiveDebuff {
  id: string;
  name: string;
  effect_description: string | null;
  xp_modifier_pct: number;
  source_kind: string | null;
  quest_id: string | null;
  created_at: string;
}

/**
 * Reconcile time-based debuffs against the user's quest state. Idempotent.
 * Call on every screen load that displays modifiers so the user sees a
 * fresh picture without waiting for the daily cron.
 */
export async function refreshDebuffs(userId: string): Promise<void> {
  const { error } = await supabase.rpc('refresh_debuffs_for', { p_user_id: userId });
  if (error) throw asError(error);
}

/** List unconsumed debuffs for the current user, newest first. */
export async function listActiveDebuffs(): Promise<ActiveDebuff[]> {
  const { data, error } = await supabase
    .from('modifiers')
    .select('id, name, effect_description, xp_modifier_pct, source_kind, quest_id, created_at')
    .eq('type', 'debuff')
    .is('consumed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw asError(error);
  return (data ?? []) as ActiveDebuff[];
}

export interface RestResult {
  clearedCount: number;
  nextRestAvailableAt: string;
}

export async function restUser(): Promise<RestResult> {
  const { data, error } = await supabase.rpc('rest_user');
  if (error) throw asError(error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('rest_user returned no row');
  return {
    clearedCount: Number(row.cleared_count),
    nextRestAvailableAt: String(row.next_rest_available_at),
  };
}
