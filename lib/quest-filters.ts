// Pure quest-filter logic. Kept in its own module so tests don't transitively
// pull in supabase (which can't initialize under jest's node environment).

import type { QuestTier } from './engine/xp';
import type { Quest } from './types/models';

export type TimeRange = 'all' | '7d' | '30d';

export interface QuestFilters {
  searchText?: string;
  /** 'all' or unset = no tier filter. */
  tier?: QuestTier | 'all';
  /** 'all' or unset = no faction filter. The literal string 'none' matches
   *  quests with no faction assigned. */
  factionId?: string | 'all' | 'none';
  /** Filter by recency of the relevant timestamp. For active quests we look
   *  at created_at; for completed at completed_at; for abandoned at
   *  abandoned_at. 'all' = no time filter. */
  timeRange?: TimeRange;
}

export function applyQuestFilters(
  quests: readonly Quest[],
  filters: QuestFilters,
  now: Date = new Date(),
): Quest[] {
  const needle = filters.searchText?.toLowerCase().trim() ?? '';
  const days = filters.timeRange === '7d' ? 7 : filters.timeRange === '30d' ? 30 : null;
  const cutoff = days !== null ? now.getTime() - days * 24 * 60 * 60 * 1000 : null;

  return quests.filter((q) => {
    if (needle) {
      const title = q.title.toLowerCase();
      const desc = (q.description ?? '').toLowerCase();
      if (!title.includes(needle) && !desc.includes(needle)) return false;
    }
    if (filters.tier && filters.tier !== 'all' && q.tier !== filters.tier) return false;
    if (filters.factionId === 'none') {
      if (q.faction_id !== null) return false;
    } else if (filters.factionId && filters.factionId !== 'all') {
      if (q.faction_id !== filters.factionId) return false;
    }
    if (cutoff !== null) {
      const ref =
        q.status === 'completed'
          ? q.completed_at ?? q.created_at
          : q.status === 'abandoned'
            ? q.abandoned_at ?? q.created_at
            : q.created_at;
      const t = new Date(ref).getTime();
      if (isNaN(t) || t < cutoff) return false;
    }
    return true;
  });
}
