// v1.1 — Achievement registry + pure check functions.
//
// Pure TypeScript. No React, no Supabase, no I/O. Mirrors the discipline of
// the XP engine: code owns the math, the AI never decides who earns what,
// and the registry / checks stay testable without a database.
//
// Spec: QUESTLINE_PROJECT.md (v1) + the v1.1 Achievement spec.
//
// Granting flow (see lib/engine/achievementTriggers.ts for the I/O side):
//   1. An originating event fires (quest complete, +rest, login, etc.).
//   2. The trigger module loads the relevant snapshot from Supabase.
//   3. The pure check function below returns { toGrant, progressUpdates }.
//   4. The trigger module inserts new earned rows + upserts progress rows.
//   5. Newly-granted codes are pushed to the in-app feed for surfacing.
//
// The metadata column on achievements_earned is the discriminator for
// templated achievements — same code, different instance per faction / arc /
// streak quest. Checks pass deterministic metadata (faction_id, arc_name) so
// the unique index in the migration is the safety net against double-grants
// from the offline-queue replay path.

export type AchievementTier = 'common' | 'uncommon' | 'rare' | 'legendary';
export type AchievementCategory = 'beginnings' | 'titles' | 'campaigns' | 'behavioral';

export interface Achievement {
  /** Stable identifier. Used in achievements_earned.achievement_code and
   *  in achievement_progress.achievement_code. Never change once shipped. */
  code: string;
  name: string;
  /** Archivist-voice flavor. May contain {placeholders} for templates. */
  flavor: string;
  tier: AchievementTier;
  category: AchievementCategory;
  /** True = shown as "???" until earned. */
  hidden: boolean;
  /** True = may be earned multiple times with different metadata. */
  isTemplate: boolean;
  /** For quantitative achievements — the goal needed to earn. Drives the
   *  "13/30" hint shown on locked cards once 50% progress is logged. */
  targetValue?: number;
  /** Optional in-voice hint shown on the locked card once progress crosses
   *  50% of targetValue. Only meaningful when targetValue is set. */
  hintAt50pct?: string;
}

// ---- Registry --------------------------------------------------------------
// Order in this array determines display order on the Achievements screen.
// 24 entries — Rank Ascended (per-class-title) is intentionally omitted in
// v1.1 because the underlying "title changes every 5 levels" mechanic doesn't
// exist; character_title is set once at character creation and stays put.

export const ACHIEVEMENTS: readonly Achievement[] = [
  // ---- Beginnings (visible) ------------------------------------------------
  {
    code: 'chronicle_begins',
    name: 'The Chronicle Begins',
    flavor: 'The first page is written. The Archivist watches.',
    tier: 'common',
    category: 'beginnings',
    hidden: false,
    isTemplate: false,
  },
  {
    code: 'first_blood',
    name: 'First Blood on the Parchment',
    flavor: 'One deed becomes legend the moment it is recorded.',
    tier: 'common',
    category: 'beginnings',
    hidden: false,
    isTemplate: false,
  },
  {
    code: 'reckoning_day',
    name: 'Reckoning Day',
    flavor: 'The hand grows steady through repetition.',
    tier: 'common',
    category: 'beginnings',
    hidden: false,
    isTemplate: false,
    targetValue: 3,
  },
  {
    code: 'known_by_name',
    name: 'Known by Name',
    flavor: "The Archivist no longer calls you 'traveler.'",
    tier: 'common',
    category: 'beginnings',
    hidden: false,
    isTemplate: false,
  },
  {
    code: 'first_oath_held',
    name: 'The First Oath Held',
    flavor: 'A small flame, kept burning, becomes a beacon.',
    tier: 'common',
    category: 'beginnings',
    hidden: false,
    isTemplate: false,
    targetValue: 7,
  },

  // ---- Campaigns (template) ------------------------------------------------
  {
    code: 'arc_completed',
    name: 'Arc Completed',
    flavor: 'Conqueror of: {arc_name}',
    tier: 'rare',
    category: 'campaigns',
    hidden: false,
    isTemplate: true,
  },

  // ---- Behavioral (hidden) -------------------------------------------------
  {
    code: 'long_watch',
    name: 'The Long Watch',
    flavor: 'Where lesser souls falter, you have not.',
    tier: 'rare',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 30,
  },
  {
    code: 'unbroken',
    name: 'The Unbroken',
    flavor: 'The chronicles record this. Few before you have managed it.',
    tier: 'legendary',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 100,
    hintAt50pct: 'A streak grows long. The Archivist takes note.',
  },
  {
    code: 'polymath',
    name: 'Polymath',
    flavor: 'Many guilds claim your hours. None claim your soul.',
    tier: 'uncommon',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 5,
  },
  {
    code: 'faction_devotee',
    name: 'Faction Devotee',
    flavor: '{faction_name} knows you well.',
    tier: 'common',
    category: 'behavioral',
    hidden: true,
    isTemplate: true,
    targetValue: 25,
  },
  {
    code: 'forge_master',
    name: 'The Forge-Master',
    flavor: '{faction_name} owes you a debt.',
    tier: 'rare',
    category: 'behavioral',
    hidden: true,
    isTemplate: true,
    targetValue: 100,
  },
  {
    code: 'dawns_own',
    name: "Dawn's Own",
    flavor: 'The morning hours hold their own magic.',
    tier: 'uncommon',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 5,
  },
  {
    code: 'night_watch',
    name: 'The Night Watch',
    flavor: 'Some chronicles are written by candlelight.',
    tier: 'uncommon',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 5,
  },
  {
    code: 'principled_refusal',
    name: 'The Principled Refusal',
    flavor: 'Wisdom is knowing which oaths to break.',
    tier: 'common',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'penitent',
    name: 'Penitent',
    flavor: 'The cobwebs are swept. The blade is sharpened.',
    tier: 'common',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'resurrected',
    name: 'Resurrected',
    flavor: 'The quill remembers your hand.',
    tier: 'uncommon',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'bountiful_harvest',
    name: 'The Bountiful Harvest',
    flavor: 'A month of weight, well carried.',
    tier: 'rare',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 50,
  },
  {
    code: 'legendary_deed',
    name: 'Legendary Deed',
    flavor: 'The chronicles will remember this.',
    tier: 'rare',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'triple_legend',
    name: 'The Triple Legend',
    flavor: 'Some hands are forged for great work alone.',
    tier: 'legendary',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 3,
  },
  {
    code: 'strategist',
    name: 'The Strategist',
    flavor: "The Archivist's tome strains under your hand.",
    tier: 'uncommon',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'cartographer_of_self',
    name: 'Cartographer of Self',
    flavor: 'Your story, set down in your own hand.',
    tier: 'common',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'keeper_of_oaths',
    name: 'Keeper of Oaths',
    flavor: 'The flame did not flicker.',
    tier: 'uncommon',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
    targetValue: 7,
  },
  {
    code: 'the_comeback',
    name: 'The Comeback',
    flavor: 'What was forgotten, remembered. What dimmed, rekindled.',
    tier: 'common',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
  {
    code: 'final_page',
    name: 'The Final Page',
    flavor: 'A full turn of seasons. The Archivist counts you among the steadfast.',
    tier: 'legendary',
    category: 'behavioral',
    hidden: true,
    isTemplate: false,
  },
];

const REGISTRY = new Map<string, Achievement>(ACHIEVEMENTS.map((a) => [a.code, a]));

export function getAchievement(code: string): Achievement | undefined {
  return REGISTRY.get(code);
}

/** Substitute {placeholders} in flavor text with values from metadata. */
export function renderFlavor(
  achievement: Pick<Achievement, 'flavor'>,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (!metadata) return achievement.flavor;
  return achievement.flavor.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = metadata[key];
    return v == null ? `{${key}}` : String(v);
  });
}

// ---- Pure check API --------------------------------------------------------

export interface GrantCandidate {
  code: string;
  /** Null for one-shot achievements; deterministic identifier object for
   *  templates so the unique index can dedupe on it. */
  metadata: Record<string, unknown> | null;
}

export interface ProgressUpdate {
  code: string;
  currentValue: number;
  targetValue: number;
}

export interface CheckResult {
  toGrant: GrantCandidate[];
  progressUpdates: ProgressUpdate[];
}

/** Lookup helper used by the check functions to avoid double-granting. */
export interface EarnedState {
  /** Codes of one-shot achievements already earned (metadata IS NULL). */
  oneShotCodes: ReadonlySet<string>;
  /**
   * Templated achievements already earned, keyed by code.
   * Each value is the set of "metadata keys" — see metadataKey() — already
   * granted under that code.
   */
  templates: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Stable string key for a metadata object — so `templates.get(code).has(key)`
 *  matches whichever insert order the rows came back in. Templates that need
 *  multi-field metadata (faction_id + faction_name, etc.) use the *identity*
 *  field (faction_id) to key on; the rest is display sugar. */
export function metadataKey(code: string, metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  switch (code) {
    case 'arc_completed':
      // Campaign id is the identity; arc_name may rename, faction_id may detach.
      return String(metadata.campaign_id ?? '');
    case 'faction_devotee':
    case 'forge_master':
      return String(metadata.faction_id ?? '');
    default:
      // Generic fallback — sort keys for stability across object spreads.
      return JSON.stringify(
        Object.fromEntries(
          Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
  }
}

function alreadyEarned(state: EarnedState, code: string, metadata: Record<string, unknown> | null): boolean {
  if (metadata == null) return state.oneShotCodes.has(code);
  const set = state.templates.get(code);
  return set ? set.has(metadataKey(code, metadata)) : false;
}

// ---- Event inputs ---------------------------------------------------------

export interface CompletedQuestRecord {
  /** ISO timestamp of completion (server time). */
  completed_at: string;
  tier: 'trivial' | 'minor' | 'standard' | 'major' | 'legendary';
  faction_id: string | null;
  /** Set on a recurring quest's MOST RECENT completion only — used by the
   *  Comeback check (gap since last_completed_at). For one-shot quests this
   *  is the create→complete gap. */
  ageDaysAtCompletion: number;
}

export interface QuestCompleteCheckInput {
  /** The quest just completed. */
  quest: CompletedQuestRecord;
  /** All factions the user has, with display names — for template metadata. */
  factionsById: Map<string, { name: string }>;
  /** Aggregate snapshot AFTER the just-completed quest is included. */
  totals: {
    /** Total completions in xp_log with reason='quest_complete'. */
    completedAllTime: number;
    /** Completions whose completed_at falls on today's local calendar day. */
    completedToday: number;
    /** Completions in the current calendar month. */
    completedThisMonth: number;
    /** Completions whose completed_at hour-of-day < 9 (local). */
    completedBefore9am: number;
    /** Completions whose completed_at hour-of-day >= 22 (local). */
    completedAfter10pm: number;
    /** Distinct faction_ids represented in completions (excluding nulls). */
    distinctFactionsCompleted: number;
    /** Per-faction completion counts. Keyed by faction_id. */
    completionsByFaction: Map<string, number>;
    /** Total legendary-tier completions. */
    legendaryCompletions: number;
    /** Currently-active quests across distinct non-null faction ids. */
    activeQuests: { count: number; distinctFactions: number };
  };
}

export interface StreakMilestoneInput {
  /** Quest that just hit the milestone. quest_id keys the metadata for the
   *  long_watch / unbroken templates so a different quest can re-trigger. */
  questId: string;
  recurrence: 'daily' | 'weekly';
  newStreak: number;
}

export interface QuestAbandonInput {
  /** Days between the quest's creation and its abandonment. */
  ageDaysAtAbandon: number;
}

export interface UserLoginInput {
  /** Days since last_seen_at; null when this is the first session. */
  daysSinceLastSeen: number | null;
  /** Days since profile.created_at. */
  daysSinceCharacterCreated: number;
}

export interface CharacterCreatedInput {
  /** Set true when apply_character_creation persisted a non-null
   *  character_title — that's enough to fire "Known by Name" in v1.1. */
  hasCharacterTitle: boolean;
}

export interface CampaignCompletedInput {
  campaignId: string;
  arcName: string;
  factionId: string | null;
}

// ---- Pure checks -----------------------------------------------------------
// All checks: (input, state) → CheckResult. They never query I/O. The trigger
// module is responsible for assembling the snapshot and persisting the result.

export function checkOnQuestComplete(
  input: QuestCompleteCheckInput,
  state: EarnedState,
): CheckResult {
  const grant: GrantCandidate[] = [];
  const progress: ProgressUpdate[] = [];
  const t = input.totals;

  const tryGrant = (code: string, metadata: Record<string, unknown> | null = null) => {
    if (alreadyEarned(state, code, metadata)) return;
    grant.push({ code, metadata });
  };

  // first_blood — first completion ever.
  if (t.completedAllTime >= 1) tryGrant('first_blood');

  // reckoning_day — 3 completions in one calendar day.
  progress.push({ code: 'reckoning_day', currentValue: Math.min(t.completedToday, 3), targetValue: 3 });
  if (t.completedToday >= 3) tryGrant('reckoning_day');

  // bountiful_harvest — 50 in one calendar month.
  progress.push({
    code: 'bountiful_harvest',
    currentValue: Math.min(t.completedThisMonth, 50),
    targetValue: 50,
  });
  if (t.completedThisMonth >= 50) tryGrant('bountiful_harvest');

  // dawns_own — 5 completions before 9 AM (cumulative, lifetime).
  progress.push({ code: 'dawns_own', currentValue: Math.min(t.completedBefore9am, 5), targetValue: 5 });
  if (t.completedBefore9am >= 5) tryGrant('dawns_own');

  // night_watch — 5 completions at/after 10 PM.
  progress.push({ code: 'night_watch', currentValue: Math.min(t.completedAfter10pm, 5), targetValue: 5 });
  if (t.completedAfter10pm >= 5) tryGrant('night_watch');

  // polymath — 5 distinct factions touched.
  progress.push({
    code: 'polymath',
    currentValue: Math.min(t.distinctFactionsCompleted, 5),
    targetValue: 5,
  });
  if (t.distinctFactionsCompleted >= 5) tryGrant('polymath');

  // legendary_deed — at least one legendary completion.
  if (input.quest.tier === 'legendary') tryGrant('legendary_deed');

  // triple_legend — 3 legendary completions cumulative.
  progress.push({
    code: 'triple_legend',
    currentValue: Math.min(t.legendaryCompletions, 3),
    targetValue: 3,
  });
  if (t.legendaryCompletions >= 3) tryGrant('triple_legend');

  // the_comeback — a quest neglected 7+ days, then completed.
  if (input.quest.ageDaysAtCompletion >= 7) tryGrant('the_comeback');

  // strategist — 10 active quests across 3+ factions.
  if (input.totals.activeQuests.count >= 10 && input.totals.activeQuests.distinctFactions >= 3) {
    tryGrant('strategist');
  }

  // faction_devotee (25 / faction) and forge_master (100 / faction) — template
  // achievements keyed by faction_id. Only fires for the just-completed quest's
  // faction so a single completion doesn't spam grants for unrelated factions.
  const fid = input.quest.faction_id;
  if (fid) {
    const count = t.completionsByFaction.get(fid) ?? 0;
    const fname = input.factionsById.get(fid)?.name ?? 'A faction';
    progress.push({
      code: 'faction_devotee',
      currentValue: Math.min(count, 25),
      targetValue: 25,
    });
    if (count >= 25) {
      tryGrant('faction_devotee', { faction_id: fid, faction_name: fname });
    }
    progress.push({
      code: 'forge_master',
      currentValue: Math.min(count, 100),
      targetValue: 100,
    });
    if (count >= 100) {
      tryGrant('forge_master', { faction_id: fid, faction_name: fname });
    }
  }

  return { toGrant: grant, progressUpdates: progress };
}

export function checkOnStreakMilestone(
  input: StreakMilestoneInput,
  state: EarnedState,
): CheckResult {
  const grant: GrantCandidate[] = [];
  const progress: ProgressUpdate[] = [];

  const tryGrant = (code: string, metadata: Record<string, unknown> | null = null) => {
    if (alreadyEarned(state, code, metadata)) return;
    grant.push({ code, metadata });
  };

  // first_oath_held — any recurring quest hits a 7-streak.
  if (input.newStreak >= 7) tryGrant('first_oath_held');

  // keeper_of_oaths — daily-recurring quest specifically reaches a 7-streak
  // (a "perfect" 7-day cadence). Spec lists this separately from
  // first_oath_held so users can earn both off the same milestone.
  if (input.newStreak >= 7 && input.recurrence === 'daily') tryGrant('keeper_of_oaths');

  // long_watch / unbroken — 30 / 100-streak on a single quest. Progress is
  // tracked per-quest via the quest's streak_count, so we just push the
  // current streak as the in-progress hint.
  progress.push({
    code: 'long_watch',
    currentValue: Math.min(input.newStreak, 30),
    targetValue: 30,
  });
  if (input.newStreak >= 30) tryGrant('long_watch');

  progress.push({
    code: 'unbroken',
    currentValue: Math.min(input.newStreak, 100),
    targetValue: 100,
  });
  if (input.newStreak >= 100) tryGrant('unbroken');

  return { toGrant: grant, progressUpdates: progress };
}

export function checkOnQuestAbandon(
  input: QuestAbandonInput,
  state: EarnedState,
): CheckResult {
  const grant: GrantCandidate[] = [];
  if (input.ageDaysAtAbandon > 14 && !alreadyEarned(state, 'principled_refusal', null)) {
    grant.push({ code: 'principled_refusal', metadata: null });
  }
  return { toGrant: grant, progressUpdates: [] };
}

export function checkOnDebuffClear(state: EarnedState): CheckResult {
  // Caller only invokes this when restUser cleared >0 debuffs, and rest only
  // clears debuffs older than 14 days — so by the time we reach the pure check
  // the condition is already satisfied. The state lookup is the only gate.
  const grant: GrantCandidate[] = [];
  if (!alreadyEarned(state, 'penitent', null)) {
    grant.push({ code: 'penitent', metadata: null });
  }
  return { toGrant: grant, progressUpdates: [] };
}

export function checkOnChronicleExport(state: EarnedState): CheckResult {
  const grant: GrantCandidate[] = [];
  if (!alreadyEarned(state, 'cartographer_of_self', null)) {
    grant.push({ code: 'cartographer_of_self', metadata: null });
  }
  return { toGrant: grant, progressUpdates: [] };
}

export function checkOnUserLogin(
  input: UserLoginInput,
  state: EarnedState,
): CheckResult {
  const grant: GrantCandidate[] = [];
  if (
    input.daysSinceLastSeen != null
    && input.daysSinceLastSeen >= 30
    && !alreadyEarned(state, 'resurrected', null)
  ) {
    grant.push({ code: 'resurrected', metadata: null });
  }
  if (
    input.daysSinceCharacterCreated >= 365
    && !alreadyEarned(state, 'final_page', null)
  ) {
    grant.push({ code: 'final_page', metadata: null });
  }
  return { toGrant: grant, progressUpdates: [] };
}

export function checkOnCharacterCreated(
  input: CharacterCreatedInput,
  state: EarnedState,
): CheckResult {
  const grant: GrantCandidate[] = [];
  if (!alreadyEarned(state, 'chronicle_begins', null)) {
    grant.push({ code: 'chronicle_begins', metadata: null });
  }
  if (input.hasCharacterTitle && !alreadyEarned(state, 'known_by_name', null)) {
    grant.push({ code: 'known_by_name', metadata: null });
  }
  return { toGrant: grant, progressUpdates: [] };
}

export function checkOnCampaignComplete(
  input: CampaignCompletedInput,
  state: EarnedState,
): CheckResult {
  const grant: GrantCandidate[] = [];
  const metadata = {
    campaign_id: input.campaignId,
    arc_name: input.arcName,
    faction_id: input.factionId,
  };
  if (!alreadyEarned(state, 'arc_completed', metadata)) {
    grant.push({ code: 'arc_completed', metadata });
  }
  return { toGrant: grant, progressUpdates: [] };
}
