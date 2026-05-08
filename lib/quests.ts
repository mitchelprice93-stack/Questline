// Quest data layer. All calls go through the Supabase client and rely on RLS
// for authorization — a logged-out caller will get an empty list (or an auth
// error from the RPCs).
//
// Offline cache + sync queue (spec §1.5 line items) are deferred. Today these
// helpers fail fast on no network. Treat that as a known gap until the
// follow-up that wires SQLite/MMKV.

import { xpForTier } from './engine/xp';
import { asError } from './errors';
import { cancelDeadlineReminders, scheduleDeadlineReminders } from './notifications';
import { cacheQuests, readCachedQuests } from './offline';
import { supabase } from './supabase';
import type {
  GrantedBuffCondition,
  Quest,
  QuestClassification,
  QuestObjective,
  QuestRecurrence,
  QuestStatus,
} from './types/models';
import type { QuestTier } from './engine/xp';

export interface GrantedBuff {
  name: string;
  description: string | null;
  pct: number;
  condition: GrantedBuffCondition;
}

// Re-export the pure filter so existing call sites (and the Quest Board
// screen) can keep importing from one place.
export { applyQuestFilters, type QuestFilters, type TimeRange } from './quest-filters';

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
  /** Optional pre-declared buff awarded on completion if its condition is met. */
  grantedBuff?: GrantedBuff | null;
}

function buffColumns(buff: GrantedBuff | null | undefined) {
  if (!buff) {
    return {
      granted_buff_name: null,
      granted_buff_description: null,
      granted_buff_pct: null,
      granted_buff_condition: null,
    };
  }
  return {
    granted_buff_name: buff.name.trim(),
    granted_buff_description: buff.description?.trim() || null,
    granted_buff_pct: Math.round(buff.pct),
    granted_buff_condition: buff.condition,
  };
}

export async function listQuests(status: QuestStatus = 'active'): Promise<Quest[]> {
  // Sort by the timestamp that matches the lifecycle stage so the most
  // recently-relevant rows come first. NULLs (e.g. legacy quests with no
  // abandoned_at) sort last.
  const orderColumn =
    status === 'completed'
      ? 'completed_at'
      : status === 'abandoned'
        ? 'abandoned_at'
        : 'created_at';

  try {
    const { data, error } = await supabase
      .from('quests')
      .select('*')
      .eq('status', status)
      .order(orderColumn, { ascending: false, nullsFirst: false });
    if (error) throw asError(error);
    const rows = (data ?? []) as Quest[];
    // Update the offline cache on every successful fetch so we have
    // something to show next time the network is missing.
    void cacheQuests(status, rows);
    return rows;
  } catch (e) {
    // Network or server failure — fall back to the cached snapshot if we
    // have one. Throw the original error if there's nothing to fall back
    // to so the UI's error state still fires.
    const cached = await readCachedQuests(status);
    if (cached) {
      console.warn('[quests] network failed, serving cache from', cached.fetchedAt);
      return cached.quests;
    }
    throw e;
  }
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
      ...buffColumns(input.grantedBuff),
    })
    .select()
    .single();
  if (error) throw asError(error);
  const quest = data as Quest;
  // Schedule deadline reminders. No-op on web / without permission.
  void scheduleDeadlineReminders(quest.id, quest.title, quest.deadline);
  return quest;
}

export interface CompleteQuestResult {
  newTotalXp: number;
  /** Total XP awarded by this completion (base after modifiers + milestone bonus). */
  xpChange: number;
  /** New streak count for recurring quests; 0 for one-shot completions. */
  newStreak: number;
  /** Bonus XP awarded for hitting a streak milestone (7/30/100). 0 otherwise. */
  milestoneBonus: number;
  /** Net modifier applied to the base reward (positive = buff-dominant). */
  netModifierPct: number;
  /** Name of the buff this completion granted, if its condition was met. */
  buffGranted: string | null;
}

export async function completeQuest(questId: string): Promise<CompleteQuestResult> {
  const { data, error } = await supabase.rpc('complete_quest', { quest_id: questId });
  if (error) throw asError(error);
  // RPC returns SETOF, supabase-js gives us an array — take the first row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('complete_quest returned no row');
  // For one-shot quests the row is now in 'completed' status; reminders no
  // longer make sense. Recurring quests stay active so we leave them alone.
  void cancelDeadlineReminders(questId);
  return {
    newTotalXp: Number(row.new_total_xp),
    xpChange: Number(row.xp_change),
    newStreak: Number(row.new_streak ?? 0),
    milestoneBonus: Number(row.milestone_bonus ?? 0),
    netModifierPct: Number(row.net_modifier_pct ?? 0),
    buffGranted: (row.buff_granted as string | null) ?? null,
  };
}

export async function abandonQuest(questId: string): Promise<void> {
  const { error } = await supabase.rpc('abandon_quest', { quest_id: questId });
  if (error) throw asError(error);
  void cancelDeadlineReminders(questId);
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
  /** Pass null to remove the granted buff; omit to leave unchanged. */
  grantedBuff?: GrantedBuff | null;
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
  const patch: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    tier: input.tier,
    classification: input.classification,
    xp_reward,
    deadline: input.deadline,
    objectives: input.objectives,
    recurrence: input.recurrence,
  };
  if (input.grantedBuff !== undefined) {
    Object.assign(patch, buffColumns(input.grantedBuff));
  }
  const { data, error } = await supabase
    .from('quests')
    .update(patch)
    .eq('id', questId)
    .select()
    .single();
  if (error) throw asError(error);
  const quest = data as Quest;
  // Re-sync deadline reminders to whatever the new deadline says (or
  // cancel them if the deadline was cleared).
  void scheduleDeadlineReminders(quest.id, quest.title, quest.deadline);
  return quest;
}
