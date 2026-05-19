// v1.1, Achievement trigger orchestration.
//
// I/O layer that bridges Supabase to the pure check functions in
// achievements.ts. Each trigger:
//   1. Loads the caller's earned-achievement state.
//   2. Assembles the snapshot the relevant pure check needs.
//   3. Runs the check, writes new earned rows + progress rows.
//   4. Publishes newly-granted achievements to the in-app feed for surfacing.
//   5. Returns the list of newly-granted codes for callers that want them.
//
// Design notes:
//   - Triggers NEVER throw to their caller. A failed achievement grant
//     should not abort a quest completion or roll back a +rest. All errors
//     are logged and the trigger returns an empty array.
//   - Granting is client-side per spec. The unique partial indexes on
//     achievements_earned (see migration 20260510000000) are the safety
//     net against the offline-queue replay path double-granting, we still
//     pre-filter via EarnedState to avoid most network round-trips.
//   - Templated achievements pass deterministic metadata (faction_id,
//     campaign_id) so the unique index dedupes them correctly.

import { publishAchievements, type EarnedAchievement } from '../achievement-feed';
import { errorMessage } from '../errors';
import { supabase } from '../supabase';
import {
  type CharacterCreatedInput,
  type CompletedQuestRecord,
  type EarnedState,
  type GrantCandidate,
  type ProgressUpdate,
  checkOnCampaignComplete,
  checkOnCharacterCreated,
  checkOnChronicleExport,
  checkOnDebuffClear,
  checkOnQuestAbandon,
  checkOnQuestComplete,
  checkOnStreakMilestone,
  checkOnUserLogin,
  getAchievement,
  metadataKey,
} from './achievements';
import type { Quest } from '../types/models';

// ---- Shared helpers --------------------------------------------------------

interface RawEarnedRow {
  achievement_code: string;
  metadata: Record<string, unknown> | null;
}

async function loadEarnedState(userId: string): Promise<EarnedState> {
  const { data, error } = await supabase
    .from('achievements_earned')
    .select('achievement_code, metadata')
    .eq('user_id', userId);
  if (error) throw new Error(`loadEarnedState: ${errorMessage(error)}`);
  const oneShotCodes = new Set<string>();
  const templates = new Map<string, Set<string>>();
  for (const row of (data ?? []) as RawEarnedRow[]) {
    if (row.metadata == null) {
      oneShotCodes.add(row.achievement_code);
    } else {
      const set = templates.get(row.achievement_code) ?? new Set<string>();
      set.add(metadataKey(row.achievement_code, row.metadata));
      templates.set(row.achievement_code, set);
    }
  }
  return { oneShotCodes, templates };
}

/**
 * Insert a single grant row. Returns the EarnedAchievement record on
 * success; null on either a unique-violation race (already earned) or an
 * unknown achievement code (skipped silently, drift between deploys).
 *
 * Inserting one row at a time so a race on one code doesn't abort sibling
 * grants. The number of grants per event is small (usually 1–3), so the
 * extra round-trips are immaterial.
 */
async function insertGrant(
  userId: string,
  candidate: GrantCandidate,
): Promise<EarnedAchievement | null> {
  const achievement = getAchievement(candidate.code);
  if (!achievement) {
    console.warn('[achievements] unknown code, skipping', candidate.code);
    return null;
  }

  const { data, error } = await supabase
    .from('achievements_earned')
    .insert({
      user_id: userId,
      achievement_code: candidate.code,
      metadata: (candidate.metadata as never) ?? null,
    })
    .select('achievement_code, metadata, earned_at')
    .single();

  if (error) {
    // 23505 = unique_violation. Treat as "already earned", it means a race
    // (offline replay or two concurrent triggers). Not a failure.
    if ((error as { code?: string }).code === '23505') return null;
    throw new Error(`insertGrant ${candidate.code}: ${errorMessage(error)}`);
  }

  return {
    achievement,
    metadata: (data?.metadata ?? null) as Record<string, unknown> | null,
    earnedAt: String(data?.earned_at ?? new Date().toISOString()),
  };
}

async function upsertProgress(userId: string, updates: ProgressUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const rows = updates.map((u) => ({
    user_id: userId,
    achievement_code: u.code,
    current_value: u.currentValue,
    target_value: u.targetValue,
    last_updated: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('achievement_progress')
    .upsert(rows, { onConflict: 'user_id,achievement_code' });
  if (error) throw new Error(`upsertProgress: ${errorMessage(error)}`);
}

/**
 * Apply the result of a pure check: write grants, write progress, publish
 * to the feed. Returns codes that were newly inserted (not pre-existing).
 */
async function applyResult(
  userId: string,
  toGrant: GrantCandidate[],
  progressUpdates: ProgressUpdate[],
): Promise<string[]> {
  const earned: EarnedAchievement[] = [];
  for (const candidate of toGrant) {
    const row = await insertGrant(userId, candidate);
    if (row) earned.push(row);
  }
  await upsertProgress(userId, progressUpdates);
  if (earned.length > 0) publishAchievements(earned);
  return earned.map((e) => e.achievement.code);
}

/** Wrap a trigger so failures never bubble to the caller. */
async function safe(label: string, fn: () => Promise<string[]>): Promise<string[]> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[achievements] ${label} failed`, e);
    return [];
  }
}

// ---- onQuestComplete -------------------------------------------------------

interface QuestCompletionLogRow {
  created_at: string;
  quest_id: string | null;
}

interface QuestSummary {
  id: string;
  tier: 'trivial' | 'minor' | 'standard' | 'major' | 'legendary';
  faction_id: string | null;
}

interface ActiveQuestSummary {
  id: string;
  faction_id: string | null;
}

interface FactionSummary {
  id: string;
  name: string;
}

async function loadQuestCompleteSnapshot(userId: string, justCompleted: Quest): Promise<{
  totals: Parameters<typeof checkOnQuestComplete>[0]['totals'];
  factionsById: Map<string, { name: string }>;
}> {
  // 1) All completion log rows (one per completion, including recurring).
  const { data: logRows, error: logErr } = await supabase
    .from('xp_log')
    .select('created_at, quest_id')
    .eq('user_id', userId)
    .eq('reason', 'quest_complete');
  if (logErr) throw new Error(`xp_log read: ${errorMessage(logErr)}`);

  // 2) Quest catalog so we can attribute each completion to a tier + faction.
  //    Recurring quests have multiple xp_log rows pointing at one quest row;
  //    we re-use the same (tier, faction_id) for all of them.
  const { data: questRows, error: qErr } = await supabase
    .from('quests')
    .select('id, tier, faction_id, status')
    .eq('user_id', userId);
  if (qErr) throw new Error(`quests read: ${errorMessage(qErr)}`);

  // 3) Factions for template metadata + display.
  const { data: factionRows, error: fErr } = await supabase
    .from('factions')
    .select('id, name')
    .eq('user_id', userId);
  if (fErr) throw new Error(`factions read: ${errorMessage(fErr)}`);

  const questIndex = new Map<string, QuestSummary>();
  for (const q of (questRows ?? []) as QuestSummary[]) questIndex.set(q.id, q);

  const factionsById = new Map<string, { name: string }>();
  for (const f of (factionRows ?? []) as FactionSummary[]) factionsById.set(f.id, { name: f.name });

  // Aggregate. All time-of-day / day / month boundaries are LOCAL to the
  // device, the achievement is "you completed something in your morning,"
  // not "you completed something during UTC morning."
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let completedToday = 0;
  let completedThisMonth = 0;
  let completedBefore9am = 0;
  let completedAfter10pm = 0;
  let legendaryCompletions = 0;
  const factionSet = new Set<string>();
  const completionsByFaction = new Map<string, number>();

  for (const row of (logRows ?? []) as QuestCompletionLogRow[]) {
    const t = new Date(row.created_at);
    if (Number.isNaN(t.getTime())) continue;
    if (t >= startOfToday) completedToday++;
    if (t >= startOfMonth) completedThisMonth++;
    const hour = t.getHours();
    if (hour < 9) completedBefore9am++;
    if (hour >= 22) completedAfter10pm++;

    const q = row.quest_id ? questIndex.get(row.quest_id) : null;
    if (q) {
      if (q.tier === 'legendary') legendaryCompletions++;
      if (q.faction_id) {
        factionSet.add(q.faction_id);
        completionsByFaction.set(
          q.faction_id,
          (completionsByFaction.get(q.faction_id) ?? 0) + 1,
        );
      }
    }
  }

  let activeCount = 0;
  const activeFactionSet = new Set<string>();
  for (const q of (questRows ?? []) as Array<QuestSummary & { status: string }>) {
    if (q.status === 'active') {
      activeCount++;
      if (q.faction_id) activeFactionSet.add(q.faction_id);
    }
  }

  return {
    factionsById,
    totals: {
      completedAllTime: (logRows ?? []).length,
      completedToday,
      completedThisMonth,
      completedBefore9am,
      completedAfter10pm,
      distinctFactionsCompleted: factionSet.size,
      completionsByFaction,
      legendaryCompletions,
      activeQuests: { count: activeCount, distinctFactions: activeFactionSet.size },
    },
  };
}

/**
 * Compute days since the quest was last touched, before this completion.
 * For recurring quests: gap from previous completion. For one-shot: gap
 * from creation. Drives the "Comeback" achievement.
 */
function ageDaysAtCompletion(quest: Quest): number {
  const ref = quest.last_completed_at ?? quest.created_at;
  const refMs = new Date(ref).getTime();
  if (Number.isNaN(refMs)) return 0;
  return (Date.now() - refMs) / (1000 * 60 * 60 * 24);
}

export async function onQuestComplete(userId: string, quest: Quest): Promise<string[]> {
  return safe('onQuestComplete', async () => {
    const [state, snapshot] = await Promise.all([
      loadEarnedState(userId),
      loadQuestCompleteSnapshot(userId, quest),
    ]);

    const completedRecord: CompletedQuestRecord = {
      completed_at: quest.completed_at ?? quest.last_completed_at ?? new Date().toISOString(),
      tier: quest.tier,
      faction_id: quest.faction_id,
      ageDaysAtCompletion: ageDaysAtCompletion(quest),
    };

    const result = checkOnQuestComplete(
      {
        quest: completedRecord,
        factionsById: snapshot.factionsById,
        totals: snapshot.totals,
      },
      state,
    );
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- onStreakMilestone -----------------------------------------------------

export async function onStreakMilestone(
  userId: string,
  questId: string,
  recurrence: 'daily' | 'weekly',
  newStreak: number,
): Promise<string[]> {
  return safe('onStreakMilestone', async () => {
    const state = await loadEarnedState(userId);
    const result = checkOnStreakMilestone({ questId, recurrence, newStreak }, state);
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- onQuestAbandon --------------------------------------------------------

export async function onQuestAbandon(userId: string, quest: Quest): Promise<string[]> {
  return safe('onQuestAbandon', async () => {
    const createdMs = new Date(quest.created_at).getTime();
    const ageDaysAtAbandon = Number.isNaN(createdMs)
      ? 0
      : (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
    const state = await loadEarnedState(userId);
    const result = checkOnQuestAbandon({ ageDaysAtAbandon }, state);
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- onDebuffClear ---------------------------------------------------------

/**
 * Called after restUser() returns clearedCount > 0. The +rest RPC only
 * clears debuffs older than 14 days, so the precondition is implicit in the
 * fact that any rows came back at all. The pure check just dedupes against
 * prior earnings.
 */
export async function onDebuffClear(userId: string): Promise<string[]> {
  return safe('onDebuffClear', async () => {
    const state = await loadEarnedState(userId);
    const result = checkOnDebuffClear(state);
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- onChronicleExport -----------------------------------------------------

export async function onChronicleExport(userId: string): Promise<string[]> {
  return safe('onChronicleExport', async () => {
    const state = await loadEarnedState(userId);
    const result = checkOnChronicleExport(state);
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- onUserLogin -----------------------------------------------------------

/**
 * Called once per fresh session by AuthProvider. Reads the prior
 * last_seen_at, runs the absence + "year on the chronicle" checks, then
 * stamps a fresh last_seen_at so the next login compares against this one.
 */
export async function onUserLogin(userId: string): Promise<string[]> {
  return safe('onUserLogin', async () => {
    const { data: profileRow, error: pErr } = await supabase
      .from('profiles')
      .select('created_at, last_seen_at')
      .eq('id', userId)
      .maybeSingle();
    if (pErr) throw new Error(`profile read: ${errorMessage(pErr)}`);

    // First login or no profile row yet: stamp last_seen and skip checks.
    if (!profileRow) {
      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
      return [];
    }

    const now = Date.now();
    const lastSeenMs = profileRow.last_seen_at ? new Date(profileRow.last_seen_at).getTime() : null;
    const createdMs = new Date(profileRow.created_at).getTime();
    const daysSinceLastSeen =
      lastSeenMs && !Number.isNaN(lastSeenMs)
        ? (now - lastSeenMs) / (1000 * 60 * 60 * 24)
        : null;
    const daysSinceCharacterCreated = Number.isNaN(createdMs)
      ? 0
      : (now - createdMs) / (1000 * 60 * 60 * 24);

    const state = await loadEarnedState(userId);
    const result = checkOnUserLogin({ daysSinceLastSeen, daysSinceCharacterCreated }, state);
    const granted = await applyResult(userId, result.toGrant, result.progressUpdates);

    // Always stamp a fresh last_seen so the next session compares against
    // this login, not the prior one. Done after the check so we don't
    // overwrite the value the check needs.
    const { error: stampErr } = await supabase
      .from('profiles')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', userId);
    if (stampErr) console.warn('[achievements] last_seen_at stamp failed', stampErr);

    return granted;
  });
}

// ---- onCharacterCreated ----------------------------------------------------

export async function onCharacterCreated(
  userId: string,
  input: CharacterCreatedInput,
): Promise<string[]> {
  return safe('onCharacterCreated', async () => {
    const state = await loadEarnedState(userId);
    const result = checkOnCharacterCreated(input, state);
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- onCampaignComplete ----------------------------------------------------

export async function onCampaignComplete(
  userId: string,
  campaign: { id: string; arc_name: string; faction_id: string | null },
): Promise<string[]> {
  return safe('onCampaignComplete', async () => {
    const state = await loadEarnedState(userId);
    const result = checkOnCampaignComplete(
      { campaignId: campaign.id, arcName: campaign.arc_name, factionId: campaign.faction_id },
      state,
    );
    return applyResult(userId, result.toGrant, result.progressUpdates);
  });
}

// ---- Public read API -------------------------------------------------------
// Used by the AchievementsScreen.

export interface AchievementSnapshot {
  earned: { code: string; metadata: Record<string, unknown> | null; earnedAt: string }[];
  progress: { code: string; current: number; target: number }[];
}

export async function loadAchievementSnapshot(userId: string): Promise<AchievementSnapshot> {
  const [earnedRes, progressRes] = await Promise.all([
    supabase
      .from('achievements_earned')
      .select('achievement_code, metadata, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false }),
    supabase
      .from('achievement_progress')
      .select('achievement_code, current_value, target_value')
      .eq('user_id', userId),
  ]);
  if (earnedRes.error) throw new Error(`earned read: ${errorMessage(earnedRes.error)}`);
  if (progressRes.error) throw new Error(`progress read: ${errorMessage(progressRes.error)}`);

  return {
    earned: (earnedRes.data ?? []).map((r) => ({
      code: r.achievement_code,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      earnedAt: r.earned_at,
    })),
    progress: (progressRes.data ?? []).map((r) => ({
      code: r.achievement_code,
      current: r.current_value,
      target: r.target_value,
    })),
  };
}
