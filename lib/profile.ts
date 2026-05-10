// Profile + character-sheet data fetchers. RLS gates each query to the caller.

import { asError } from './errors';
import { cacheProfileTotalXp } from './offline';
import { supabase } from './supabase';
import type { Campaign, Faction, Profile } from './types/models';

export async function getCurrentProfile(): Promise<Profile | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw asError(userError);
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw asError(error);
  const profile = (data ?? null) as Profile | null;
  // Mirror total_xp into AsyncStorage so the offline completeQuest path
  // can compute an optimistic newTotalXp = cachedTotal + baseTierXp.
  if (profile?.total_xp != null) void cacheProfileTotalXp(profile.total_xp);
  return profile;
}

export async function getActiveQuestCount(): Promise<number> {
  const { count, error } = await supabase
    .from('quests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) throw asError(error);
  return count ?? 0;
}

export async function listFactions(): Promise<Faction[]> {
  const { data, error } = await supabase
    .from('factions')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw asError(error);
  return (data ?? []) as Faction[];
}

export async function listCampaigns(status: Campaign['status'] = 'active'): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: true });
  if (error) throw asError(error);
  return (data ?? []) as Campaign[];
}
