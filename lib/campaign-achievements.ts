// "Personal" achievements: one per campaign the chronicler has finished.
//
// The Archivist (claude-proxy) generates the title + description from the
// campaign's arc_name + real_world_goal; this module wraps the AI call and
// the row insert, plus the queries the Achievements screen uses.
//
// Idempotency: the table has a UNIQUE constraint on campaign_id, so the
// second insertion attempt errors. earnAchievementForCampaign treats the
// constraint violation as a no-op so the live completion path and the
// backfill path can both run without coordinating.

import { callClaudeProxy } from './ai';
import { asError } from './errors';
import { supabase } from './supabase';
import type { CampaignAchievement } from './types/models';

interface ArchivistResult {
  title: string;
  description: string;
}

/** Ask the Archivist for a {title, description} pair for the given campaign.
 *  Pure AI call, doesn't touch the DB. Callers usually want
 *  earnAchievementForCampaign which combines this with the row insert. */
export async function generateCampaignAchievement(payload: {
  arc_name: string;
  real_world_goal: string;
}): Promise<ArchivistResult> {
  const result = await callClaudeProxy<ArchivistResult>('generate_campaign_achievement', payload);
  return {
    title: result.data.title.trim(),
    description: result.data.description.trim(),
  };
}

/** Generate an achievement for a campaign and persist it. If the campaign
 *  already has an achievement (unique-on-campaign_id), this resolves to the
 *  existing row without re-generating. If `earnedAtIso` is provided, it
 *  overrides the default now() timestamp (used by the backfill path to
 *  backdate trophies to when the campaign actually finished).
 *
 *  Returns the resulting row (newly inserted or pre-existing). */
export async function earnAchievementForCampaign(input: {
  campaignId: string;
  arcName: string;
  realWorldGoal: string;
  earnedAtIso?: string;
}): Promise<CampaignAchievement> {
  // First, check whether this campaign already has a row. Saves an AI call
  // on retry / backfill of an already-backfilled campaign.
  const existing = await getCampaignAchievement(input.campaignId);
  if (existing) return existing;

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw asError(userError);
  if (!user) throw new Error('Not signed in.');

  const { title, description } = await generateCampaignAchievement({
    arc_name: input.arcName,
    real_world_goal: input.realWorldGoal,
  });

  const row: {
    user_id: string;
    campaign_id: string;
    title: string;
    description: string;
    earned_at?: string;
  } = {
    user_id: user.id,
    campaign_id: input.campaignId,
    title,
    description,
  };
  if (input.earnedAtIso) row.earned_at = input.earnedAtIso;

  const { data, error } = await supabase
    .from('campaign_achievements')
    .insert(row)
    .select()
    .single();

  if (error) {
    // 23505 = unique_violation. Race with another tab / backfill, fetch
    // the winner and return it instead of throwing.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      const fallback = await getCampaignAchievement(input.campaignId);
      if (fallback) return fallback;
    }
    throw asError(error);
  }
  return data as CampaignAchievement;
}

/** Look up a single campaign's achievement. Returns null when none has been
 *  earned yet (e.g. campaign is still active, or backfill hasn't run). */
export async function getCampaignAchievement(
  campaignId: string,
): Promise<CampaignAchievement | null> {
  const { data, error } = await supabase
    .from('campaign_achievements')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (error) throw asError(error);
  return (data ?? null) as CampaignAchievement | null;
}

/** All earned campaign achievements for the current user, newest first.
 *  Used by the Personal tab on the Achievements screen. */
export async function listCampaignAchievements(): Promise<CampaignAchievement[]> {
  const { data, error } = await supabase
    .from('campaign_achievements')
    .select('*')
    .order('earned_at', { ascending: false });
  if (error) throw asError(error);
  return (data ?? []) as CampaignAchievement[];
}
