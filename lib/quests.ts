// Quest data layer. All calls go through the Supabase client and rely on RLS
// for authorization — a logged-out caller will get an empty list (or an auth
// error from the RPCs).
//
// Offline cache + sync queue (spec §1.5 line items) are deferred. Today these
// helpers fail fast on no network. Treat that as a known gap until the
// follow-up that wires SQLite/MMKV.

import { xpForTier } from './engine/xp';
import { supabase } from './supabase';
import type { Quest, QuestClassification, QuestObjective, QuestStatus } from './types/models';
import type { QuestTier } from './engine/xp';

export interface CreateQuestInput {
  title: string;
  description: string | null;
  tier: QuestTier;
  classification: QuestClassification;
  deadline: string | null; // ISO timestamp; pass null to skip
  /** Optional checklist. Pass empty / omit for no objectives. */
  objectives?: QuestObjective[];
}

export async function listQuests(status: QuestStatus = 'active'): Promise<Quest[]> {
  const { data, error } = await supabase
    .from('quests')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Quest[];
}

export async function getQuest(id: string): Promise<Quest | null> {
  const { data, error } = await supabase.from('quests').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
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
    })
    .select()
    .single();
  if (error) throw error;
  return data as Quest;
}

export interface CompleteQuestResult {
  newTotalXp: number;
  xpChange: number;
}

export async function completeQuest(questId: string): Promise<CompleteQuestResult> {
  const { data, error } = await supabase.rpc('complete_quest', { quest_id: questId });
  if (error) throw error;
  // RPC returns SETOF, supabase-js gives us an array — take the first row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('complete_quest returned no row');
  return {
    newTotalXp: Number(row.new_total_xp),
    xpChange: Number(row.xp_change),
  };
}

export async function abandonQuest(questId: string): Promise<void> {
  const { error } = await supabase.rpc('abandon_quest', { quest_id: questId });
  if (error) throw error;
}

export async function updateQuestObjectives(
  questId: string,
  objectives: QuestObjective[],
): Promise<void> {
  const { error } = await supabase.from('quests').update({ objectives }).eq('id', questId);
  if (error) throw error;
}
