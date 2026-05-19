// v1.1, pure achievement check tests.
//
// These cover the deterministic core: each achievement's earn / not-earn
// conditions, template grants firing per metadata key, idempotency
// (already-earned codes don't re-grant), and progress updates being
// well-formed. The trigger module's I/O is exercised separately via the
// retroactive backfill script run + manual smoke tests.

import {
  ACHIEVEMENTS,
  checkOnCampaignComplete,
  checkOnCharacterCreated,
  checkOnChronicleExport,
  checkOnDebuffClear,
  checkOnQuestAbandon,
  checkOnQuestComplete,
  checkOnStreakMilestone,
  checkOnUserLogin,
  type EarnedState,
  metadataKey,
  renderFlavor,
  type QuestCompleteCheckInput,
} from './achievements';

const EMPTY_STATE: EarnedState = {
  oneShotCodes: new Set(),
  templates: new Map(),
};

const stateWith = (codes: string[], templates?: Record<string, string[]>): EarnedState => ({
  oneShotCodes: new Set(codes),
  templates: new Map(
    Object.entries(templates ?? {}).map(([code, keys]) => [code, new Set(keys)]),
  ),
});

const emptyTotals = (): QuestCompleteCheckInput['totals'] => ({
  completedAllTime: 0,
  completedToday: 0,
  completedThisMonth: 0,
  completedBefore9am: 0,
  completedAfter10pm: 0,
  distinctFactionsCompleted: 0,
  completionsByFaction: new Map(),
  legendaryCompletions: 0,
  activeQuests: { count: 0, distinctFactions: 0 },
});

const baseQuestComplete = (
  overrides: Partial<QuestCompleteCheckInput> = {},
): QuestCompleteCheckInput => ({
  quest: {
    completed_at: '2026-05-10T12:00:00Z',
    tier: 'minor',
    faction_id: null,
    ageDaysAtCompletion: 0,
  },
  factionsById: new Map(),
  totals: emptyTotals(),
  ...overrides,
});

// ---- Registry sanity ------------------------------------------------------

describe('ACHIEVEMENTS registry', () => {
  test('contains 24 entries (Rank Ascended omitted in v1.1)', () => {
    expect(ACHIEVEMENTS.length).toBe(24);
  });

  test('all codes are unique', () => {
    const seen = new Set<string>();
    for (const a of ACHIEVEMENTS) {
      expect(seen.has(a.code)).toBe(false);
      seen.add(a.code);
    }
  });

  test('templates always have isTemplate true and a flavor placeholder', () => {
    const templates = ACHIEVEMENTS.filter((a) => a.isTemplate);
    expect(templates.length).toBeGreaterThan(0);
    for (const a of templates) {
      expect(a.flavor).toMatch(/\{[a-z_]+\}/);
    }
  });

  test('quantitative achievements declare a positive targetValue', () => {
    for (const a of ACHIEVEMENTS) {
      if (a.targetValue != null) expect(a.targetValue).toBeGreaterThan(0);
    }
  });
});

describe('renderFlavor', () => {
  test('substitutes placeholders from metadata', () => {
    expect(renderFlavor({ flavor: 'Conqueror of: {arc_name}' }, { arc_name: 'The Iron Marathon' }))
      .toBe('Conqueror of: The Iron Marathon');
  });

  test('leaves placeholder intact when metadata lacks the key', () => {
    expect(renderFlavor({ flavor: '{faction_name} knows you well.' }, {}))
      .toBe('{faction_name} knows you well.');
  });

  test('returns flavor unchanged when metadata is null', () => {
    expect(renderFlavor({ flavor: 'A first deed.' }, null)).toBe('A first deed.');
  });
});

describe('metadataKey', () => {
  test('arc_completed keys on campaign_id', () => {
    const a = metadataKey('arc_completed', { campaign_id: 'c1', arc_name: 'X' });
    const b = metadataKey('arc_completed', { campaign_id: 'c1', arc_name: 'Y' });
    expect(a).toBe(b);
  });

  test('faction_devotee keys on faction_id', () => {
    expect(metadataKey('faction_devotee', { faction_id: 'f1', faction_name: 'Forge' }))
      .toBe(metadataKey('faction_devotee', { faction_id: 'f1', faction_name: 'Renamed' }));
  });

  test('unknown codes fall back to a sorted-key JSON string', () => {
    expect(metadataKey('mystery', { b: 2, a: 1 })).toBe(metadataKey('mystery', { a: 1, b: 2 }));
  });
});

// ---- onQuestComplete ------------------------------------------------------

describe('checkOnQuestComplete, first_blood', () => {
  test('grants on the very first completion', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        totals: { ...emptyTotals(), completedAllTime: 1 },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).toContain('first_blood');
  });

  test('does not re-grant when already earned', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({ totals: { ...emptyTotals(), completedAllTime: 5 } }),
      stateWith(['first_blood']),
    );
    expect(out.toGrant.map((g) => g.code)).not.toContain('first_blood');
  });

  test('not granted at zero completions (defensive, should not happen)', () => {
    const out = checkOnQuestComplete(baseQuestComplete(), EMPTY_STATE);
    expect(out.toGrant.map((g) => g.code)).not.toContain('first_blood');
  });
});

describe('checkOnQuestComplete, reckoning_day', () => {
  test('grants on the third completion of the day', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        totals: { ...emptyTotals(), completedAllTime: 3, completedToday: 3 },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).toContain('reckoning_day');
  });

  test('progress reflects a partial day', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        totals: { ...emptyTotals(), completedAllTime: 2, completedToday: 2 },
      }),
      EMPTY_STATE,
    );
    const p = out.progressUpdates.find((u) => u.code === 'reckoning_day');
    expect(p).toEqual({ code: 'reckoning_day', currentValue: 2, targetValue: 3 });
    expect(out.toGrant.map((g) => g.code)).not.toContain('reckoning_day');
  });
});

describe('checkOnQuestComplete, legendary tier', () => {
  test('legendary_deed grants on a single legendary completion', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'legendary',
          faction_id: null,
          ageDaysAtCompletion: 0,
        },
        totals: { ...emptyTotals(), completedAllTime: 1, legendaryCompletions: 1 },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).toEqual(
      expect.arrayContaining(['first_blood', 'legendary_deed']),
    );
  });

  test('triple_legend grants only at three legendary completions', () => {
    const at2 = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'legendary',
          faction_id: null,
          ageDaysAtCompletion: 0,
        },
        totals: { ...emptyTotals(), completedAllTime: 2, legendaryCompletions: 2 },
      }),
      EMPTY_STATE,
    );
    expect(at2.toGrant.map((g) => g.code)).not.toContain('triple_legend');

    const at3 = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'legendary',
          faction_id: null,
          ageDaysAtCompletion: 0,
        },
        totals: { ...emptyTotals(), completedAllTime: 3, legendaryCompletions: 3 },
      }),
      EMPTY_STATE,
    );
    expect(at3.toGrant.map((g) => g.code)).toContain('triple_legend');
  });
});

describe('checkOnQuestComplete, strategist', () => {
  test('grants when active=10 spans 3 factions', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        totals: {
          ...emptyTotals(),
          completedAllTime: 1,
          activeQuests: { count: 10, distinctFactions: 3 },
        },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).toContain('strategist');
  });

  test('not granted when 10 active but only 2 factions', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        totals: {
          ...emptyTotals(),
          completedAllTime: 1,
          activeQuests: { count: 10, distinctFactions: 2 },
        },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).not.toContain('strategist');
  });
});

describe('checkOnQuestComplete, faction templates', () => {
  test('faction_devotee fires once per faction at 25 completions', () => {
    const totals = emptyTotals();
    totals.completedAllTime = 25;
    totals.completionsByFaction = new Map([['f1', 25]]);
    const out = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'minor',
          faction_id: 'f1',
          ageDaysAtCompletion: 0,
        },
        factionsById: new Map([['f1', { name: 'The Forge' }]]),
        totals,
      }),
      EMPTY_STATE,
    );
    const grant = out.toGrant.find((g) => g.code === 'faction_devotee');
    expect(grant).toBeTruthy();
    expect(grant?.metadata).toEqual({ faction_id: 'f1', faction_name: 'The Forge' });
  });

  test('does not re-fire faction_devotee for the same faction', () => {
    const totals = emptyTotals();
    totals.completedAllTime = 26;
    totals.completionsByFaction = new Map([['f1', 26]]);
    const out = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'minor',
          faction_id: 'f1',
          ageDaysAtCompletion: 0,
        },
        factionsById: new Map([['f1', { name: 'The Forge' }]]),
        totals,
      }),
      stateWith([], { faction_devotee: ['f1'] }),
    );
    expect(out.toGrant.map((g) => g.code)).not.toContain('faction_devotee');
  });

  test('a different faction at 25 still fires its own devotee row', () => {
    const totals = emptyTotals();
    totals.completedAllTime = 50;
    totals.completionsByFaction = new Map([['f1', 25], ['f2', 25]]);
    const out = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'minor',
          faction_id: 'f2',
          ageDaysAtCompletion: 0,
        },
        factionsById: new Map([
          ['f1', { name: 'The Forge' }],
          ['f2', { name: 'The Watch' }],
        ]),
        totals,
      }),
      stateWith([], { faction_devotee: ['f1'] }),
    );
    const grant = out.toGrant.find((g) => g.code === 'faction_devotee');
    expect(grant?.metadata?.faction_id).toBe('f2');
  });
});

describe('checkOnQuestComplete, the_comeback', () => {
  test('fires when ageDaysAtCompletion ≥ 7', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'minor',
          faction_id: null,
          ageDaysAtCompletion: 8,
        },
        totals: { ...emptyTotals(), completedAllTime: 1 },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).toContain('the_comeback');
  });

  test('does not fire at ageDaysAtCompletion = 6.5', () => {
    const out = checkOnQuestComplete(
      baseQuestComplete({
        quest: {
          completed_at: '2026-05-10T12:00:00Z',
          tier: 'minor',
          faction_id: null,
          ageDaysAtCompletion: 6.5,
        },
        totals: { ...emptyTotals(), completedAllTime: 1 },
      }),
      EMPTY_STATE,
    );
    expect(out.toGrant.map((g) => g.code)).not.toContain('the_comeback');
  });
});

// ---- Streak ----------------------------------------------------------------

describe('checkOnStreakMilestone', () => {
  test('first_oath_held + keeper_of_oaths fire together at daily streak 7', () => {
    const out = checkOnStreakMilestone(
      { questId: 'q1', recurrence: 'daily', newStreak: 7 },
      EMPTY_STATE,
    );
    const codes = out.toGrant.map((g) => g.code);
    expect(codes).toContain('first_oath_held');
    expect(codes).toContain('keeper_of_oaths');
  });

  test('weekly streak of 7 grants first_oath_held but NOT keeper_of_oaths', () => {
    const out = checkOnStreakMilestone(
      { questId: 'q1', recurrence: 'weekly', newStreak: 7 },
      EMPTY_STATE,
    );
    const codes = out.toGrant.map((g) => g.code);
    expect(codes).toContain('first_oath_held');
    expect(codes).not.toContain('keeper_of_oaths');
  });

  test('long_watch grants at 30, unbroken at 100', () => {
    const at30 = checkOnStreakMilestone(
      { questId: 'q1', recurrence: 'daily', newStreak: 30 },
      EMPTY_STATE,
    );
    const at100 = checkOnStreakMilestone(
      { questId: 'q1', recurrence: 'daily', newStreak: 100 },
      EMPTY_STATE,
    );
    expect(at30.toGrant.map((g) => g.code)).toContain('long_watch');
    expect(at30.toGrant.map((g) => g.code)).not.toContain('unbroken');
    expect(at100.toGrant.map((g) => g.code)).toContain('unbroken');
  });

  test('idempotency: already-earned milestones do not re-grant', () => {
    const out = checkOnStreakMilestone(
      { questId: 'q1', recurrence: 'daily', newStreak: 7 },
      stateWith(['first_oath_held', 'keeper_of_oaths']),
    );
    expect(out.toGrant.map((g) => g.code)).toEqual([]);
  });

  test('progress is bounded by targetValue', () => {
    const out = checkOnStreakMilestone(
      { questId: 'q1', recurrence: 'daily', newStreak: 250 },
      EMPTY_STATE,
    );
    const long = out.progressUpdates.find((u) => u.code === 'long_watch');
    const unbroken = out.progressUpdates.find((u) => u.code === 'unbroken');
    expect(long).toEqual({ code: 'long_watch', currentValue: 30, targetValue: 30 });
    expect(unbroken).toEqual({ code: 'unbroken', currentValue: 100, targetValue: 100 });
  });
});

// ---- Other one-shot triggers ----------------------------------------------

describe('checkOnQuestAbandon', () => {
  test('grants principled_refusal when age > 14 days', () => {
    expect(
      checkOnQuestAbandon({ ageDaysAtAbandon: 15 }, EMPTY_STATE).toGrant.map((g) => g.code),
    ).toContain('principled_refusal');
  });

  test('does not grant at exactly 14 days (strict >)', () => {
    expect(
      checkOnQuestAbandon({ ageDaysAtAbandon: 14 }, EMPTY_STATE).toGrant,
    ).toEqual([]);
  });

  test('idempotent', () => {
    expect(
      checkOnQuestAbandon({ ageDaysAtAbandon: 30 }, stateWith(['principled_refusal']))
        .toGrant,
    ).toEqual([]);
  });
});

describe('checkOnDebuffClear', () => {
  test('grants penitent on first clear', () => {
    expect(checkOnDebuffClear(EMPTY_STATE).toGrant.map((g) => g.code))
      .toContain('penitent');
  });

  test('idempotent on subsequent clears', () => {
    expect(checkOnDebuffClear(stateWith(['penitent'])).toGrant).toEqual([]);
  });
});

describe('checkOnChronicleExport', () => {
  test('grants cartographer_of_self once', () => {
    expect(checkOnChronicleExport(EMPTY_STATE).toGrant.map((g) => g.code))
      .toContain('cartographer_of_self');
    expect(checkOnChronicleExport(stateWith(['cartographer_of_self'])).toGrant)
      .toEqual([]);
  });
});

describe('checkOnUserLogin', () => {
  test('resurrected fires after 30+ day absence', () => {
    expect(
      checkOnUserLogin(
        { daysSinceLastSeen: 35, daysSinceCharacterCreated: 100 },
        EMPTY_STATE,
      ).toGrant.map((g) => g.code),
    ).toContain('resurrected');
  });

  test('first-ever login (daysSinceLastSeen=null) does not grant resurrected', () => {
    expect(
      checkOnUserLogin(
        { daysSinceLastSeen: null, daysSinceCharacterCreated: 0 },
        EMPTY_STATE,
      ).toGrant.map((g) => g.code),
    ).not.toContain('resurrected');
  });

  test('final_page fires at 365+ days since character creation', () => {
    expect(
      checkOnUserLogin(
        { daysSinceLastSeen: 1, daysSinceCharacterCreated: 365 },
        EMPTY_STATE,
      ).toGrant.map((g) => g.code),
    ).toContain('final_page');
  });

  test('no grant before 365 days', () => {
    expect(
      checkOnUserLogin(
        { daysSinceLastSeen: 1, daysSinceCharacterCreated: 364 },
        EMPTY_STATE,
      ).toGrant.map((g) => g.code),
    ).not.toContain('final_page');
  });
});

describe('checkOnCharacterCreated', () => {
  test('chronicle_begins always grants on first call', () => {
    expect(
      checkOnCharacterCreated({ hasCharacterTitle: false }, EMPTY_STATE)
        .toGrant.map((g) => g.code),
    ).toEqual(['chronicle_begins']);
  });

  test('known_by_name grants when a character_title is set', () => {
    const codes = checkOnCharacterCreated({ hasCharacterTitle: true }, EMPTY_STATE)
      .toGrant.map((g) => g.code);
    expect(codes).toEqual(expect.arrayContaining(['chronicle_begins', 'known_by_name']));
  });

  test('idempotent, neither re-grants once earned', () => {
    expect(
      checkOnCharacterCreated({ hasCharacterTitle: true }, stateWith(['chronicle_begins', 'known_by_name']))
        .toGrant,
    ).toEqual([]);
  });
});

describe('checkOnCampaignComplete', () => {
  test('grants arc_completed with deterministic metadata', () => {
    const out = checkOnCampaignComplete(
      { campaignId: 'c1', arcName: 'The Iron Marathon', factionId: null },
      EMPTY_STATE,
    );
    expect(out.toGrant).toEqual([
      {
        code: 'arc_completed',
        metadata: { campaign_id: 'c1', arc_name: 'The Iron Marathon', faction_id: null },
      },
    ]);
  });

  test('does not re-grant for the same campaign', () => {
    const out = checkOnCampaignComplete(
      { campaignId: 'c1', arcName: 'Renamed Arc', factionId: null },
      stateWith([], { arc_completed: ['c1'] }),
    );
    expect(out.toGrant).toEqual([]);
  });

  test('different campaigns each fire their own arc_completed', () => {
    const out = checkOnCampaignComplete(
      { campaignId: 'c2', arcName: 'Second Arc', factionId: null },
      stateWith([], { arc_completed: ['c1'] }),
    );
    expect(out.toGrant.map((g) => g.code)).toEqual(['arc_completed']);
    expect(out.toGrant[0]?.metadata?.campaign_id).toBe('c2');
  });
});
