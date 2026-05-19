import {
  applyBuffsAndDebuffs,
  applyDifficultyModifier,
  assessStartingLevel,
  BUFF_DURATION_DAYS_BY_TIER,
  buffDurationDaysForTier,
  calculateLevel,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  STREAK_BONUSES,
  streakBonusFor,
  xpForTier,
} from './xp';

describe('LEVEL_THRESHOLDS', () => {
  test('contains MAX_LEVEL entries (one per level)', () => {
    expect(LEVEL_THRESHOLDS.length).toBe(MAX_LEVEL);
  });

  test('matches spec values for L1..L5', () => {
    expect(LEVEL_THRESHOLDS[0]).toBe(0); // L1
    expect(LEVEL_THRESHOLDS[1]).toBe(1000); // L2
    expect(LEVEL_THRESHOLDS[2]).toBe(2500); // L3
    expect(LEVEL_THRESHOLDS[3]).toBe(5000); // L4
    expect(LEVEL_THRESHOLDS[4]).toBe(10000); // L5
  });

  test('post-L5 gaps grow by 1.5× (rounded), pin L6..L10', () => {
    expect(LEVEL_THRESHOLDS[5]).toBe(17500); // L6 = L5 + 7500
    expect(LEVEL_THRESHOLDS[6]).toBe(28750); // L7 = L6 + 11250
    expect(LEVEL_THRESHOLDS[7]).toBe(45625); // L8 = L7 + 16875
    expect(LEVEL_THRESHOLDS[8]).toBe(70938); // L9 = L8 + 25313 (round of 16875*1.5)
    expect(LEVEL_THRESHOLDS[9]).toBe(108908); // L10 = L9 + 37970 (round of 25313*1.5)
  });

  test('is strictly monotonically increasing across all levels', () => {
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i]!).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]!);
    }
  });
});

describe('calculateLevel', () => {
  test('zero XP returns level 1', () => {
    expect(calculateLevel(0)).toEqual({ level: 1, currentLevelXp: 0, nextLevelXp: 1000 });
  });

  test('one XP below the L2 threshold is still L1', () => {
    expect(calculateLevel(999)).toEqual({ level: 1, currentLevelXp: 999, nextLevelXp: 1000 });
  });

  test('exactly at the L2 threshold flips to L2', () => {
    expect(calculateLevel(1000)).toEqual({ level: 2, currentLevelXp: 0, nextLevelXp: 1500 });
  });

  test('one XP below L5 is L4', () => {
    expect(calculateLevel(9999)).toEqual({ level: 4, currentLevelXp: 4999, nextLevelXp: 5000 });
  });

  test('crosses the geometric-growth boundary (L5 → L6)', () => {
    expect(calculateLevel(10000)).toEqual({ level: 5, currentLevelXp: 0, nextLevelXp: 7500 });
    expect(calculateLevel(17500)).toEqual({ level: 6, currentLevelXp: 0, nextLevelXp: 11250 });
  });

  test('mid-level XP reports correct progress', () => {
    // L6 starts at 17500, gap is 11250. At 20000 total XP: 2500 into L6.
    expect(calculateLevel(20000)).toEqual({ level: 6, currentLevelXp: 2500, nextLevelXp: 11250 });
  });

  test('clamps at MAX_LEVEL with nextLevelXp = 0', () => {
    const cap = LEVEL_THRESHOLDS[MAX_LEVEL - 1]!;
    expect(calculateLevel(cap)).toEqual({
      level: MAX_LEVEL,
      currentLevelXp: 0,
      nextLevelXp: 0,
    });
  });

  test('preserves overflow XP past MAX_LEVEL in currentLevelXp', () => {
    const cap = LEVEL_THRESHOLDS[MAX_LEVEL - 1]!;
    const result = calculateLevel(cap + 999_999);
    expect(result.level).toBe(MAX_LEVEL);
    expect(result.currentLevelXp).toBe(999_999);
    expect(result.nextLevelXp).toBe(0);
  });

  test('treats negative XP as 0', () => {
    expect(calculateLevel(-500)).toEqual({ level: 1, currentLevelXp: 0, nextLevelXp: 1000 });
  });

  test('floors fractional XP', () => {
    expect(calculateLevel(1500.9)).toEqual({ level: 2, currentLevelXp: 500, nextLevelXp: 1500 });
  });
});

describe('xpForTier', () => {
  test('matches spec values', () => {
    expect(xpForTier('trivial')).toBe(100);
    expect(xpForTier('minor')).toBe(500);
    expect(xpForTier('standard')).toBe(1500);
    expect(xpForTier('major')).toBe(5000);
    expect(xpForTier('legendary')).toBe(15000);
  });
});

describe('applyDifficultyModifier', () => {
  // Multipliers: apprentice 1.5 (easiest, fastest leveling) → legendary 0.75
  // (hardest, slowest leveling). Inverted from the original spec, harder
  // difficulty now means slower progression.

  test('apprentice grants 150%', () => {
    expect(applyDifficultyModifier(1000, 'apprentice')).toBe(1500);
  });

  test('adept grants 125%', () => {
    expect(applyDifficultyModifier(1000, 'adept')).toBe(1250);
  });

  test('master is identity (1.0×)', () => {
    expect(applyDifficultyModifier(1500, 'master')).toBe(1500);
  });

  test('legendary cuts XP to 75%', () => {
    expect(applyDifficultyModifier(1000, 'legendary')).toBe(750);
  });

  test('zero XP stays zero across all difficulties', () => {
    expect(applyDifficultyModifier(0, 'apprentice')).toBe(0);
    expect(applyDifficultyModifier(0, 'legendary')).toBe(0);
  });

  test('rounds to integer', () => {
    // 100 * 0.75 = 75 (clean), but 101 * 0.75 = 75.75 → 76
    expect(applyDifficultyModifier(101, 'legendary')).toBe(76);
  });
});

describe('applyBuffsAndDebuffs', () => {
  test('empty modifier list returns input unchanged', () => {
    expect(applyBuffsAndDebuffs(1000, [])).toBe(1000);
  });

  test('single +25% buff', () => {
    expect(applyBuffsAndDebuffs(1000, [{ xpModifierPct: 25 }])).toBe(1250);
  });

  test('single -10% debuff (Cobwebs of Procrastination)', () => {
    expect(applyBuffsAndDebuffs(1000, [{ xpModifierPct: -10 }])).toBe(900);
  });

  test('-50% (Curse of the Idle Blade) halves XP', () => {
    expect(applyBuffsAndDebuffs(1000, [{ xpModifierPct: -50 }])).toBe(500);
  });

  test('stacks multiple modifiers additively', () => {
    // +25, -10, -5 = +10% → 1100
    const mods = [{ xpModifierPct: 25 }, { xpModifierPct: -10 }, { xpModifierPct: -5 }];
    expect(applyBuffsAndDebuffs(1000, mods)).toBe(1100);
  });

  test('exactly -100% gives zero XP', () => {
    expect(applyBuffsAndDebuffs(1000, [{ xpModifierPct: -100 }])).toBe(0);
  });

  test('floors at zero when stacked debuffs go below -100%', () => {
    const mods = [{ xpModifierPct: -75 }, { xpModifierPct: -50 }];
    expect(applyBuffsAndDebuffs(1000, mods)).toBe(0);
  });

  test('rounds to integer', () => {
    // 333 * 1.10 = 366.3 → 366
    expect(applyBuffsAndDebuffs(333, [{ xpModifierPct: 10 }])).toBe(366);
  });
});

describe('assessStartingLevel', () => {
  test('empty summary, zero campaigns returns 1 (floor)', () => {
    expect(assessStartingLevel('', 0)).toBe(1);
  });

  test('whitespace-only summary counts as no words', () => {
    expect(assessStartingLevel('   \n\t  ', 0)).toBe(1);
  });

  test('a few campaigns, no summary scales linearly', () => {
    expect(assessStartingLevel('', 3)).toBe(4); // 1 base + 3 campaigns
  });

  test('100-word summary contributes 1 level', () => {
    const summary = Array(100).fill('word').join(' ');
    expect(assessStartingLevel(summary, 0)).toBe(2); // 1 + floor(100/75) = 1 + 1 = 2
  });

  test('caps at 12 even with absurd inputs', () => {
    const summary = Array(10000).fill('word').join(' ');
    expect(assessStartingLevel(summary, 50)).toBe(12);
  });

  test('clamps negative campaign count to zero', () => {
    expect(assessStartingLevel('', -5)).toBe(1);
  });

  test('floors fractional campaign counts', () => {
    expect(assessStartingLevel('', 2.9)).toBe(3); // 1 + floor(2.9) = 3
  });
});

describe('streakBonusFor', () => {
  test('returns 0 for non-milestone streaks', () => {
    expect(streakBonusFor(0)).toBe(0);
    expect(streakBonusFor(1)).toBe(0);
    expect(streakBonusFor(6)).toBe(0);
    expect(streakBonusFor(8)).toBe(0);
    expect(streakBonusFor(29)).toBe(0);
    expect(streakBonusFor(99)).toBe(0);
    expect(streakBonusFor(101)).toBe(0);
  });

  test('returns the spec bonuses at exact thresholds', () => {
    expect(streakBonusFor(7)).toBe(250);
    expect(streakBonusFor(30)).toBe(1500);
    expect(streakBonusFor(100)).toBe(5000);
  });

  test('table matches the SQL constants in complete_quest', () => {
    // If you change these, also update 20260503000000_recurring_quests.sql
    expect(STREAK_BONUSES).toEqual({ 7: 250, 30: 1500, 100: 5000 });
  });
});

describe('buffDurationDaysForTier', () => {
  test('returns the spec values per tier', () => {
    expect(buffDurationDaysForTier('trivial')).toBe(1);
    expect(buffDurationDaysForTier('minor')).toBe(2);
    expect(buffDurationDaysForTier('standard')).toBe(4);
    expect(buffDurationDaysForTier('major')).toBe(7);
    expect(buffDurationDaysForTier('legendary')).toBe(14);
  });

  test('table matches the SQL constants in buff_duration_for_tier', () => {
    // If you change these, also update 20260507000001_buff_duration.sql
    expect(BUFF_DURATION_DAYS_BY_TIER).toEqual({
      trivial: 1,
      minor: 2,
      standard: 4,
      major: 7,
      legendary: 14,
    });
  });
});
