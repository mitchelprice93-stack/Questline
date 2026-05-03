// Quest data layer. All calls go through the Supabase client and rely on RLS
// for authorization — a logged-out caller will get an empty list (or an auth
// error from the RPCs).
//
// Offline cache + sync queue (spec §1.5 line items) are deferred. Today these
// helpers fail fast on no network. Treat that as a known gap until the
// follow-up that wires SQLite/MMKV.

import { xpForTier } from './engine/xp';
import { asError } from './errors';
import { supabase } from './supabase';
import type {
  Quest,
  QuestClassification,
  QuestObjective,
  QuestRecurrence,
  QuestStatus,
} from './types/models';
import type { QuestTier } from './engine/xp';

export interface CreateQuestInput {
  title: string;
  description: string | null;
  tier: QuestTier;
  classification: QuestClassification;
  deadline: string | null; // ISO timestamp; pass null to skip
  /** Optional checklist. Pass empty / omit for no objectives. */
  objectives?: QuestObjective[];
  /** null = one-shot. 'daily' / 'weekly' = auto-recurring with streak tracking. */
  recurrence?: QuestRecurrence;
}

export async function listQuests(status: QuestStatus = 'active'): Promise<Quest[]> {
  const { data, error } = await supabase
    .from('quests')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) throw asError(error);
  return (data ?? []) as Quest[];
}

export async function getQuest(id: string): Promise<Quest | null> {
  const { data, error } = await supabase.from('quests').select('*').eq('id', id).maybeSingle();
  if (error) throw asError(error);
  return (data ?? null) as Quest | null;
}

export async function createQuest(input: CreateQuestInput): Promise<Quest> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Must be signed in to create a quest');

  const xp_reward = xpForTier(input.tier);

  const { data, error } = await supabase
    .from('quests')
    .insert({
      user_id: user.id,
      title: input.title,
      description: input.description,
      tier: input.tier,
      classification: input.classification,
      xp_reward,
      deadline: input.deadline,
      objectives: input.objectives ?? [],
      recurrence: input.recurrence ?? null,
    })
    .select()
    .single();
  if (error) throw asError(error);
  return data as Quest;
}

export interface CompleteQuestResult {
  newTotalXp: number;
  /** Total XP awarded by this completion (base reward + any milestone bonus). */
  xpChange: number;
  /** New streak count for recurring quests; 0 for one-shot completions. */
  newStreak: number;
  /** Bonus XP awarded for hitting a streak milestone (7/30/100). 0 otherwise. */
  milestoneBonus: number;
}

export async function completeQuest(questId: string): Promise<CompleteQuestResult> {
  const { data, error } = await supabase.rpc('complete_quest', { quest_id: questId });
  if (error) throw asError(error);
  // RPC returns SETOF, supabase-js gives us an array — take the first row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('complete_quest returned no row');
  return {
    newTotalXp: Number(row.new_total_xp),
    xpChange: Number(row.xp_change),
    newStreak: Number(row.new_streak ?? 0),
    milestoneBonus: Number(row.milestone_bonus ?? 0),
  };
}

export async function abandonQuest(questId: string): Promise<void> {
  const { error } = await supabase.rpc('abandon_quest', { quest_id: questId });
  if (error) throw asError(error);
}

export async function updateQuestObjectives(
  questId: string,
  objectives: QuestObjective[],
): Promise<void> {
  const { error } = await supabase.from('quests').update({ objectives }).eq('id', questId);
  if (error) throw asError(error);
}

export interface UpdateQuestInput {
  title: string;
  description: string | null;
  tier: QuestTier;
  classification: QuestClassification;
  deadline: string | null;
  objectives: QuestObjective[];
  recurrence: QuestRecurrence;
}

/**
 * Update an active quest's editable fields. Recomputes xp_reward from the
 * tier so the engine remains the only source of XP. RLS gates this to the
 * caller's own quests.
 *
 * Note: switching recurrence on/off does NOT reset streak_count or
 * last_completed_at. If you set a one-shot quest to 'daily' it picks up the
 * streak math from now (which means a fresh first completion → streak 1).
 */
export async function updateQuest(questId: string, input: UpdateQuestInput): Promise<Quest> {
  const xp_reward = xpForTier(input.tier);
  const { data, error } = await supabase
    .from('quests')
    .update({
      title: input.title,
      description: input.description,
      tier: input.tier,
      classification: input.classification,
      xp_reward,
      deadline: input.deadline,
      objectives: input.objectives,
      recurrence: input.recurrence,
    })
    .eq('id', questId)
    .select()
    .single();
  if (error) throw asError(error);
  return data as Quest;
}
