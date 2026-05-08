// Character-sheet edits — factions, campaigns, and difficulty.
//
// RLS already gates these operations to the calling user, so each helper is
// just a thin wrapper around the supabase-js call with the asError unwrap.

import type { Difficulty } from './engine/xp';
import { asError } from './errors';
import { supabase } from './supabase';
import type { Campaign, Faction } from './types/models';

// -- factions ----------------------------------------------------------------

export async function createFaction(input: {
  name: string;
  real_world_domain: string;
}): Promise<Faction> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw asError(userError);
  if (!user) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('factions')
    .insert({
      user_id: user.id,
      name: input.name.trim(),
      real_world_domain: input.real_world_domain.trim(),
    })
    .select()
    .single();
  if (error) throw asError(error);
  return data as Faction;
}

export async function updateFaction(
  id: string,
  patch: { name?: string; real_world_domain?: string },
): Promise<Faction> {
  const trimmed: { name?: string; real_world_domain?: string } = {};
  if (patch.name !== undefined) trimmed.name = patch.name.trim();
  if (patch.real_world_domain !== undefined)
    trimmed.real_world_domain = patch.real_world_domain.trim();

  const { data, error } = await supabase
    .from('factions')
    .update(trimmed)
    .eq('id', id)
    .select()
    .single();
  if (error) throw asError(error);
  return data as Faction;
}

export async function deleteFaction(id: string): Promise<void> {
  const { error } = await supabase.from('factions').delete().eq('id', id);
  if (error) throw asError(error);
}

// -- campaigns ---------------------------------------------------------------

export async function createCampaign(input: {
  arc_name: string;
  real_world_goal: string;
  faction_id?: string | null;
}): Promise<Campaign> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw asError(userError);
  if (!user) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      user_id: user.id,
      arc_name: input.arc_name.trim(),
      real_world_goal: input.real_world_goal.trim(),
      faction_id: input.faction_id ?? null,
    })
    .select()
    .single();
  if (error) throw asError(error);
  return data as Campaign;
}

export async function updateCampaign(
  id: string,
  patch: {
    arc_name?: string;
    real_world_goal?: string;
    faction_id?: string | null;
    progress_pct?: number;
    status?: Campaign['status'];
  },
): Promise<Campaign> {
  const next: {
    arc_name?: string;
    real_world_goal?: string;
    faction_id?: string | null;
    progress_pct?: number;
    status?: Campaign['status'];
  } = {};
  if (patch.arc_name !== undefined) next.arc_name = patch.arc_name.trim();
  if (patch.real_world_goal !== undefined) next.real_world_goal = patch.real_world_goal.trim();
  if (patch.faction_id !== undefined) next.faction_id = patch.faction_id;
  if (patch.progress_pct !== undefined) {
    next.progress_pct = Math.max(0, Math.min(100, Math.floor(patch.progress_pct)));
  }
  if (patch.status !== undefined) next.status = patch.status;

  const { data, error } = await supabase
    .from('campaigns')
    .update(next)
    .eq('id', id)
    .select()
    .single();
  if (error) throw asError(error);
  return data as Campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from('campaigns').delete().eq('id', id);
  if (error) throw asError(error);
}

// -- difficulty --------------------------------------------------------------

export async function updateDifficulty(difficulty: Difficulty): Promise<void> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw asError(userError);
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('profiles').update({ difficulty }).eq('id', user.id);
  if (error) throw asError(error);
}
