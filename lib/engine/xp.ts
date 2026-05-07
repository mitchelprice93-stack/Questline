// XP engine for Questline.
//
// Pure TypeScript — no React, no React Native, no I/O. Every function is a
// total function over its inputs. The deterministic core of the game lives
// here; the AI never owns these values.
//
// See QUESTLINE_PROJECT.md §1.4 for spec. Edits to thresholds, tier XP, or
// the calculateLevel return shape ripple through every UI surface that shows
// XP — change with care and update tests.

export type QuestTier = 'trivial' | 'minor' | 'standard' | 'major' | 'legendary';

export type Difficulty = 'apprentice' | 'adept' | 'master' | 'legendary';

export interface Modifier {
  /** Percentage points applied to base XP. -10 means -10%, +25 means +25%. */
  xpModifierPct: number;
}

export const MAX_LEVEL = 50;

/**
 * One-time bonuses awarded on top of a recurring quest's tier XP when its
 * streak hits the listed threshold. Must stay in sync with the milestone
 * constants in the complete_quest SQL function — the SQL is canonical and
 * the values here are duplicated for client-side display only.
 */
export const STREAK_BONUSES: Record<number, number> = {
  7: 250,
  30: 1500,
  100: 5000,
};

/** Returns the streak-milestone bonus for the given streak count, or 0. */
export function streakBonusFor(streak: number): number {
  return STREAK_BONUSES[streak] ?? 0;
}

/**
 * Lifetime, in days, of a buff earned by completing a quest of this tier.
 * Mirrors the buff_duration_for_tier SQL function — the SQL is canonical;
 * the client values are duplicated so the UI can render "lasts X days"
 * without an extra round-trip. Keep these two in sync.
 */
export const BUFF_DURATION_DAYS_BY_TIER: Record<QuestTier, number> = {
  trivial: 1,
  minor: 2,
  standard: 4,
  major: 7,
  legendary: 14,
};

export function buffDurationDaysForTier(tier: QuestTier): number {
  return BUFF_DURATION_DAYS_BY_TIER[tier];
}

const TIER_XP: Record<QuestTier, number> = {
  trivial: 100,
  minor: 500,
  standard: 1500,
  major: 5000,
  legendary: 15000,
};

// Difficulty multipliers are not pinned in the v1 spec. These defaults give
// lower difficulties less XP (so players are nudged to step up) and match the
// schema's default 'adept' = 1.0x baseline. Revisit during balance tuning.
const DIFFICULTY_MULT: Record<Difficulty, number> = {
  apprentice: 0.75,
  adept: 1.0,
  master: 1.25,
  legendary: 1.5,
};

function buildLevelThresholds(maxLevel: number): readonly number[] {
  // thresholds[i] = cumulative XP required to BE at level i+1.
  // L1→2: 1,000 · L2→3: 2,500 · L3→4: 5,000 · L4→5: 10,000.
  // After L5 each gap is round(previous gap × 1.5).
  const thresholds: number[] = [0, 1000, 2500, 5000, 10000];
  let prevGap = 5000; // L4→L5 gap
  for (let level = 6; level <= maxLevel; level++) {
    const gap = Math.round(prevGap * 1.5);
    const last = thresholds[thresholds.length - 1] ?? 0;
    thresholds.push(last + gap);
    prevGap = gap;
  }
  return thresholds;
}

export const LEVEL_THRESHOLDS: readonly number[] = buildLevelThresholds(MAX_LEVEL);

export interface LevelInfo {
  /** Integer level, 1..MAX_LEVEL. */
  level: number;
  /** XP earned within the current level (0 ≤ value < nextLevelXp at level < MAX_LEVEL). */
  currentLevelXp: number;
  /** Total XP span of the current level. 0 once the user is at MAX_LEVEL (no further progression). */
  nextLevelXp: number;
}

export function calculateLevel(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(totalXp));

  // Find largest i such that LEVEL_THRESHOLDS[i] <= xp.
  let i = 0;
  while (
    i + 1 < LEVEL_THRESHOLDS.length &&
    (LEVEL_THRESHOLDS[i + 1] ?? Number.POSITIVE_INFINITY) <= xp
  ) {
    i++;
  }

  const currentThreshold = LEVEL_THRESHOLDS[i] ?? 0;
  const level = i + 1;

  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      currentLevelXp: xp - currentThreshold,
      nextLevelXp: 0,
    };
  }

  const nextThreshold = LEVEL_THRESHOLDS[i + 1] ?? currentThreshold;
  return {
    level,
    currentLevelXp: xp - currentThreshold,
    nextLevelXp: nextThreshold - currentThreshold,
  };
}

export function xpForTier(tier: QuestTier): number {
  return TIER_XP[tier];
}

export function applyDifficultyModifier(xp: number, difficulty: Difficulty): number {
  return Math.round(xp * DIFFICULTY_MULT[difficulty]);
}

export function applyBuffsAndDebuffs(xp: number, modifiers: readonly Modifier[]): number {
  const totalPct = modifiers.reduce((sum, m) => sum + m.xpModifierPct, 0);
  // Floor at 0 — a single quest completion never grants negative XP.
  const multiplier = Math.max(0, 1 + totalPct / 100);
  return Math.round(xp * multiplier);
}

/**
 * Heuristic fallback for new-character starting level. Used when the AI
 * character-creation call is unavailable (spec §2.3 fallback). The AI normally
 * sets this; we just need a bounded, deterministic result here.
 *
 * Cap at 12 per spec. Floor at 1 (no sub-L1 character).
 */
export function assessStartingLevel(lifeSummary: string, campaignCount: number): number {
  const safeCampaigns = Math.max(0, Math.floor(campaignCount));
  const wordCount = lifeSummary.trim().split(/\s+/).filter(Boolean).length;
  const raw = 1 + Math.floor(wordCount / 75) + safeCampaigns;
  return Math.min(Math.max(raw, 1), 12);
}
