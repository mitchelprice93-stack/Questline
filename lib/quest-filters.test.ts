import { applyQuestFilters } from './quest-filters';
import type { Quest } from './types/models';

function makeQuest(partial: Partial<Quest> = {}): Quest {
  return {
    id: partial.id ?? 'q1',
    user_id: 'u1',
    faction_id: partial.faction_id ?? null,
    campaign_id: null,
    title: partial.title ?? 'A quest',
    description: partial.description ?? null,
    objectives: [],
    tier: partial.tier ?? 'standard',
    classification: partial.classification ?? 'side',
    xp_reward: 1500,
    status: partial.status ?? 'active',
    recurrence: partial.recurrence ?? null,
    streak_count: 0,
    deadline: null,
    completed_at: partial.completed_at ?? null,
    last_completed_at: null,
    abandoned_at: partial.abandoned_at ?? null,
    created_at: partial.created_at ?? '2026-05-01T00:00:00Z',
  };
}

describe('applyQuestFilters', () => {
  test('returns all when filters are empty', () => {
    const a = makeQuest({ id: 'a' });
    const b = makeQuest({ id: 'b' });
    expect(applyQuestFilters([a, b], {})).toHaveLength(2);
  });

  test('searchText matches title (case-insensitive)', () => {
    const dragon = makeQuest({ id: 'a', title: 'Slay the Dragon' });
    const lab = makeQuest({ id: 'b', title: 'Finish lab report' });
    expect(applyQuestFilters([dragon, lab], { searchText: 'DRAGON' }).map((q) => q.id)).toEqual([
      'a',
    ]);
  });

  test('searchText matches description when title misses', () => {
    const a = makeQuest({ id: 'a', title: 'Errand', description: 'Pick up the silver bow' });
    const b = makeQuest({ id: 'b', title: 'Other', description: 'Nothing related' });
    expect(applyQuestFilters([a, b], { searchText: 'silver' }).map((q) => q.id)).toEqual(['a']);
  });

  test("tier filter — 'all' is a noop", () => {
    const major = makeQuest({ id: 'a', tier: 'major' });
    const minor = makeQuest({ id: 'b', tier: 'minor' });
    expect(applyQuestFilters([major, minor], { tier: 'all' })).toHaveLength(2);
  });

  test('tier filter — selects only matching rows', () => {
    const major = makeQuest({ id: 'a', tier: 'major' });
    const minor = makeQuest({ id: 'b', tier: 'minor' });
    expect(applyQuestFilters([major, minor], { tier: 'major' }).map((q) => q.id)).toEqual(['a']);
  });

  test("factionId 'none' selects unaffiliated quests", () => {
    const noFaction = makeQuest({ id: 'a', faction_id: null });
    const withFaction = makeQuest({ id: 'b', faction_id: 'f1' });
    expect(
      applyQuestFilters([noFaction, withFaction], { factionId: 'none' }).map((q) => q.id),
    ).toEqual(['a']);
  });

  test('factionId selects matching faction', () => {
    const f1 = makeQuest({ id: 'a', faction_id: 'f1' });
    const f2 = makeQuest({ id: 'b', faction_id: 'f2' });
    expect(applyQuestFilters([f1, f2], { factionId: 'f1' }).map((q) => q.id)).toEqual(['a']);
  });

  test('timeRange uses completed_at for completed quests', () => {
    const now = new Date('2026-05-10T00:00:00Z');
    const recent = makeQuest({
      id: 'a',
      status: 'completed',
      completed_at: '2026-05-08T00:00:00Z',
    });
    const old = makeQuest({
      id: 'b',
      status: 'completed',
      completed_at: '2026-04-01T00:00:00Z',
    });
    expect(
      applyQuestFilters([recent, old], { timeRange: '7d' }, now).map((q) => q.id),
    ).toEqual(['a']);
  });

  test('timeRange uses abandoned_at for abandoned quests', () => {
    const now = new Date('2026-05-10T00:00:00Z');
    const recent = makeQuest({
      id: 'a',
      status: 'abandoned',
      abandoned_at: '2026-05-08T00:00:00Z',
    });
    const old = makeQuest({
      id: 'b',
      status: 'abandoned',
      abandoned_at: '2026-04-01T00:00:00Z',
    });
    expect(
      applyQuestFilters([recent, old], { timeRange: '7d' }, now).map((q) => q.id),
    ).toEqual(['a']);
  });

  test('timeRange falls back to created_at when lifecycle field is null', () => {
    const now = new Date('2026-05-10T00:00:00Z');
    const recent = makeQuest({
      id: 'a',
      status: 'completed',
      completed_at: null,
      created_at: '2026-05-08T00:00:00Z',
    });
    const old = makeQuest({
      id: 'b',
      status: 'completed',
      completed_at: null,
      created_at: '2026-04-01T00:00:00Z',
    });
    expect(
      applyQuestFilters([recent, old], { timeRange: '7d' }, now).map((q) => q.id),
    ).toEqual(['a']);
  });

  test('combined filters AND together', () => {
    const a = makeQuest({ id: 'a', tier: 'major', faction_id: 'f1', title: 'dragon' });
    const b = makeQuest({ id: 'b', tier: 'major', faction_id: 'f2', title: 'dragon' });
    const c = makeQuest({ id: 'c', tier: 'minor', faction_id: 'f1', title: 'dragon' });
    expect(
      applyQuestFilters([a, b, c], {
        tier: 'major',
        factionId: 'f1',
        searchText: 'drag',
      }).map((q) => q.id),
    ).toEqual(['a']);
  });
});
