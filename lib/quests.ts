// Quest data layer. All calls go through the Supabase client and rely on RLS
// for authorization, a logged-out caller will get an empty list (or an auth
// error from the RPCs).
//
// Offline cache + sync queue (spec §1.5 line items) are deferred. Today these
// helpers fail fast on no network. Treat that as a known gap until the
// follow-up that wires SQLite/MMKV.

import {
  onCampaignComplete,
  onQuestAbandon,
  onQuestComplete,
  onStreakMilestone,
} from './engine/achievementTriggers';
import { xpForTier } from './engine/xp';
import { asError } from './errors';
import { cancelDeadlineReminders, scheduleDeadlineReminders } from './notifications';
import {
  cacheQuests,
  getCachedQuestById,
  markPendingCompletion,
  readCachedProfileTotalXp,
  readCachedQuests,
} from './offline';
import { enqueue, isNetworkError, registerHandler } from './offline-queue';
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
  /** null = one-shot. 'daily'/'weekly'/'monthly'/'yearly' = auto-recurring
   *  with streak tracking. 'custom' requires recurrenceInterval + recurrenceUnit. */
  recurrence?: QuestRecurrence;
  /** Required for recurrence='custom', null otherwise. The DB enforces this. */
  recurrenceInterval?: number | null;
  recurrenceUnit?: 'days' | 'weeks' | 'months' | null;
  /** Weekly recurrence: pinned weekdays (0=Sun..6=Sat). Null = "once a week,
   *  any day" (legacy). Non-null = due on each of these days. */
  recurrenceWeekdays?: number[] | null;
  /** Monthly recurrence: pinned days of month (1..31). Null = "once a month".
   *  Non-null = due on each of these days. */
  recurrenceMonthDays?: number[] | null;
  /** Optional pre-declared buff awarded on completion if its condition is met. */
  grantedBuff?: GrantedBuff | null;
  /** Optional campaign this quest contributes to. Completing the quest
   *  auto-advances the campaign's progress_pct by `campaignContributionPct`
   *  (or a tier-scaled default if omitted on creation). */
  campaignId?: string | null;
  /** % the campaign advances when this quest completes (1-100). Required
   *  when campaignId is set, null/omitted when not. */
  campaignContributionPct?: number | null;
  /** Optional faction this quest counts toward. Completing the quest
   *  auto-increments the faction's reputation_count via DB trigger. */
  factionId?: string | null;
}

/** Normalize recurrence interval + unit so non-custom recurrences always
 *  send (null, null) regardless of what the caller passed. Keeps the DB
 *  CHECK constraint happy without forcing every caller to remember it. */
function recurrenceColumns(input: {
  recurrence?: QuestRecurrence;
  recurrenceInterval?: number | null;
  recurrenceUnit?: 'days' | 'weeks' | 'months' | null;
  recurrenceWeekdays?: number[] | null;
  recurrenceMonthDays?: number[] | null;
}) {
  const rec = input.recurrence ?? null;
  // Day-pin arrays are only meaningful for weekly/monthly. Force-null them
  // for every other cadence so the DB CHECK constraints don't bounce us.
  const weekdays =
    rec === 'weekly' && input.recurrenceWeekdays && input.recurrenceWeekdays.length > 0
      ? [...new Set(input.recurrenceWeekdays)].sort((a, b) => a - b)
      : null;
  const monthDays =
    rec === 'monthly' && input.recurrenceMonthDays && input.recurrenceMonthDays.length > 0
      ? [...new Set(input.recurrenceMonthDays)].sort((a, b) => a - b)
      : null;

  if (rec !== 'custom') {
    return {
      recurrence: rec,
      recurrence_interval: null,
      recurrence_unit: null,
      recurrence_weekdays: weekdays,
      recurrence_month_days: monthDays,
    };
  }
  return {
    recurrence: 'custom',
    recurrence_interval: input.recurrenceInterval ?? null,
    recurrence_unit: input.recurrenceUnit ?? null,
    recurrence_weekdays: null,
    recurrence_month_days: null,
  };
}

/** Default campaign-contribution % when the caller doesn't specify. Mirrors
 *  the OLD tier-scaled trigger so quest behavior on first creation feels
 *  identical to what existed before per-quest % became user-editable. */
function defaultCampaignContributionForTier(tier: QuestTier): number {
  switch (tier) {
    case 'trivial':
      return 2;
    case 'minor':
      return 5;
    case 'standard':
      return 10;
    case 'major':
      return 20;
    case 'legendary':
      return 40;
  }
}

/** Normalize campaign + contribution-% to satisfy the DB CHECK invariant:
 *  both null, or both set. Tier-scaled default applied when a campaign
 *  is linked but no explicit % was passed. */
function campaignColumns(input: {
  campaignId?: string | null;
  campaignContributionPct?: number | null;
  tier: QuestTier;
}) {
  const campaignId = input.campaignId ?? null;
  if (!campaignId) {
    return { campaign_id: null, campaign_contribution_pct: null };
  }
  const pct =
    typeof input.campaignContributionPct === 'number'
      ? Math.max(0, Math.min(100, Math.round(input.campaignContributionPct)))
      : defaultCampaignContributionForTier(input.tier);
  return { campaign_id: campaignId, campaign_contribution_pct: pct };
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
    const rows = (data ?? []) as unknown as Quest[];
    // Update the offline cache on every successful fetch so we have
    // something to show next time the network is missing.
    void cacheQuests(status, rows);
    return rows;
  } catch (e) {
    // Network or server failure, fall back to the cached snapshot if we
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
  try {
    const { data, error } = await supabase.from('quests').select('*').eq('id', id).maybeSingle();
    if (error) throw asError(error);
    return (data ?? null) as Quest | null;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    // Offline, serve from any cached list. The post-completion path on
    // the detail screen calls this to pick up streak / last_completed_at;
    // markPendingCompletion has already updated the active cache with
    // the new values, so the cached read reflects the optimistic state.
    return getCachedQuestById(id);
  }
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
      ...recurrenceColumns(input),
      ...campaignColumns(input),
      faction_id: input.factionId ?? null,
      ...buffColumns(input.grantedBuff),
    })
    .select()
    .single();
  if (error) throw asError(error);
  const quest = data as unknown as Quest;
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

/** Raw RPC call, used by both the public completeQuest and the offline-
 *  queue replay handler. Throws on any server/network error. */
async function callCompleteRpc(questId: string): Promise<CompleteQuestResult> {
  const { data, error } = await supabase.rpc('complete_quest', { quest_id: questId });
  if (error) throw asError(error);
  // RPC returns SETOF, supabase-js gives us an array, take the first row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('complete_quest returned no row');
  return {
    newTotalXp: Number(row.new_total_xp),
    xpChange: Number(row.xp_change),
    newStreak: Number(row.new_streak ?? 0),
    milestoneBonus: Number(row.milestone_bonus ?? 0),
    netModifierPct: Number(row.net_modifier_pct ?? 0),
    buffGranted: (row.buff_granted as string | null) ?? null,
  };
}

/** Synthesize an optimistic completion result from cached state. Used
 *  when the network is unavailable: the real RPC is queued and replayed
 *  on reconnect, but the user gets immediate feedback (XP estimate,
 *  level-up trigger, takeover) based on what we know locally.
 *
 *  Modifiers (active debuffs / buff conditions) and streak milestones
 *  are NOT computed locally, those need the server's view. The server's
 *  RPC will reconcile when the queue drains; the next profile refetch
 *  pulls the real total_xp and the user's display catches up. */
async function synthesizeOfflineCompletion(questId: string): Promise<CompleteQuestResult> {
  const quest = await getCachedQuestById(questId);
  const baseXp = quest ? xpForTier(quest.tier) : 0;
  const cachedTotal = await readCachedProfileTotalXp();
  return {
    newTotalXp: cachedTotal + baseXp,
    xpChange: baseXp,
    newStreak: quest?.recurrence ? quest.streak_count + 1 : 0,
    milestoneBonus: 0,
    netModifierPct: 0,
    buffGranted: null,
  };
}

/**
 * Fire achievement triggers for a just-completed quest. Fire-and-forget -
 * achievement work must not block the user's quest-complete UX, and any
 * failure here is logged inside the trigger module rather than thrown.
 *
 * Quest is captured BEFORE completion so the_comeback's age check sees the
 * prior last_completed_at, not the freshly-stamped now().
 */
async function fireCompletionAchievements(
  questBefore: Quest,
  result: CompleteQuestResult,
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    void onQuestComplete(user.id, questBefore);

    if (questBefore.recurrence && result.newStreak > 0) {
      void onStreakMilestone(user.id, questBefore.id, questBefore.recurrence, result.newStreak);
    }

    // The bump_faction_and_campaign trigger may have just flipped the linked
    // campaign to 'completed'. Re-read it to detect that, if status flipped,
    // fire the arc_completed template (idempotent via unique index).
    if (questBefore.campaign_id) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('id, arc_name, faction_id, status')
        .eq('id', questBefore.campaign_id)
        .maybeSingle();
      if (campaign && campaign.status === 'completed') {
        void onCampaignComplete(user.id, {
          id: campaign.id,
          arc_name: campaign.arc_name,
          faction_id: campaign.faction_id,
        });
      }
    }
  } catch (e) {
    console.warn('[achievements] post-completion fire failed', e);
  }
}

export async function completeQuest(questId: string): Promise<CompleteQuestResult> {
  // Fetch the quest BEFORE the RPC stamps last_completed_at, the achievement
  // age check (the_comeback) needs the prior gap, not zero.
  const questBefore = await getQuest(questId).catch(() => null);

  try {
    const result = await callCompleteRpc(questId);
    // For one-shot quests the row is now in 'completed' status; reminders
    // no longer make sense. Recurring quests stay active so we leave them.
    void cancelDeadlineReminders(questId);
    if (questBefore) void fireCompletionAchievements(questBefore, result);
    return result;
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    // Network's down. Optimistically mark the quest completed in the
    // local cache (so the list views reflect it) and queue the RPC to
    // replay when the app foregrounds with connectivity. Return a
    // synthesized result so the calling UI (level-up takeover, XP
    // toast, SFX) behaves as if the server had answered.
    //
    // Achievements DO NOT fire on the optimistic path, server state is
    // the source of truth, and the queued replay below catches them up
    // when the network returns.
    const optimistic = await synthesizeOfflineCompletion(questId);
    await markPendingCompletion(questId);
    await enqueue('completeQuest', { questId });
    void cancelDeadlineReminders(questId);
    return optimistic;
  }
}

// Register the replay handler at module load so drainQueue can find it.
// Achievements fire here too so an offline-completed quest still surfaces
// any earned achievements once the queue drains.
registerHandler('completeQuest', async (payload) => {
  const { questId } = payload as { questId: string };
  const questBefore = await getQuest(questId).catch(() => null);
  const result = await callCompleteRpc(questId);
  if (questBefore) void fireCompletionAchievements(questBefore, result);
});

export async function abandonQuest(questId: string): Promise<void> {
  // Capture the quest BEFORE abandon flips status, the engine needs
  // created_at + the (still-active) timestamps to compute age.
  const quest = await getQuest(questId).catch(() => null);
  const { error } = await supabase.rpc('abandon_quest', { quest_id: questId });
  if (error) throw asError(error);
  void cancelDeadlineReminders(questId);
  if (quest) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) void onQuestAbandon(user.id, quest);
    } catch (e) {
      console.warn('[achievements] post-abandon fire failed', e);
    }
  }
}

/**
 * Pin or unpin a quest. Pinned quests sort to the top of the board
 * regardless of the chronicler's sort/group preferences. Pass true to
 * pin (writes pinned_at=now), false to unpin (writes pinned_at=null).
 */
export async function setQuestPinned(questId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase
    .from('quests')
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq('id', questId);
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
  /** Required when recurrence='custom', null otherwise. */
  recurrenceInterval?: number | null;
  recurrenceUnit?: 'days' | 'weeks' | 'months' | null;
  /** Weekly recurrence: pinned weekdays (0=Sun..6=Sat). Null for none. */
  recurrenceWeekdays?: number[] | null;
  /** Monthly recurrence: pinned days of month (1..31). Null for none. */
  recurrenceMonthDays?: number[] | null;
  /** Pass null to remove the granted buff; omit to leave unchanged. */
  grantedBuff?: GrantedBuff | null;
  /** Pass null to detach the quest from its campaign, or undefined to
   *  leave unchanged. */
  campaignId?: string | null;
  /** New contribution % when changing campaign or tweaking the amount.
   *  Required when campaignId is set, ignored when campaignId is null. */
  campaignContributionPct?: number | null;
  /** Pass null to detach the quest from its faction, or undefined to
   *  leave unchanged. */
  factionId?: string | null;
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
  // Cast the patch via unknown so supabase-js accepts our partial shape.
  // Generated types want a strict per-column shape; with grantedBuff
  // optional the spread becomes Record<string, unknown> from TS's view.
  const patch = {
    title: input.title,
    description: input.description,
    tier: input.tier,
    classification: input.classification,
    xp_reward,
    deadline: input.deadline,
    objectives: input.objectives,
    ...recurrenceColumns(input),
    ...(input.grantedBuff !== undefined ? buffColumns(input.grantedBuff) : {}),
    // Apply campaign+pct together so the CHECK pairing invariant holds.
    // We always pass both (or both null) whenever the caller touches
    // campaignId, even if pct was omitted (defaultCampaignContributionForTier
    // fills in a sensible value).
    ...(input.campaignId !== undefined ? campaignColumns(input) : {}),
    ...(input.factionId !== undefined ? { faction_id: input.factionId } : {}),
  };
  const { data, error } = await supabase
    .from('quests')
    .update(patch)
    .eq('id', questId)
    .select()
    .single();
  if (error) throw asError(error);
  // The DB column 'objectives' is jsonb (typed Json by generated types);
  // we narrow to QuestObjective[] via unknown since the schema check
  // constrains the structure server-side.
  const quest = data as unknown as Quest;
  void scheduleDeadlineReminders(quest.id, quest.title, quest.deadline);
  return quest;
}
