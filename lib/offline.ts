// Phase 1.5 follow-up, read-side offline cache.
//
// Every successful network fetch stores the result in AsyncStorage under
// a per-status key. When a fetch fails (no network, server down), callers
// fall back to the cached snapshot rather than showing an empty state or
// an error.
//
// Write-side queue (offline mutations) is a separate follow-up. Today
// completing/abandoning/creating a quest still requires connectivity.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Quest, QuestStatus } from './types/models';

const KEY = (status: QuestStatus) => `questline.cache.quests.${status}`;
const META_KEY = (status: QuestStatus) => `questline.cache.quests.${status}.fetchedAt`;
const KEY_PROFILE_TOTAL_XP = 'questline.cache.profile.total_xp';

interface CachedQuests {
  quests: Quest[];
  fetchedAt: string;
}

/**
 * Persist the latest server-fetched quest list for a given status. Called
 * from listQuests on every successful response.
 */
export async function cacheQuests(status: QuestStatus, quests: Quest[]): Promise<void> {
  try {
    await AsyncStorage.multiSet([
      [KEY(status), JSON.stringify(quests)],
      [META_KEY(status), new Date().toISOString()],
    ]);
  } catch (e) {
    // Cache writes are best-effort, never let a storage failure surface.
    console.warn('[offline] cacheQuests failed', e);
  }
}

/**
 * Read the most recent cached quest list for a given status. Returns
 * null if there's no snapshot or the JSON can't be parsed.
 */
export async function readCachedQuests(status: QuestStatus): Promise<CachedQuests | null> {
  try {
    const [questsRaw, fetchedAt] = await Promise.all([
      AsyncStorage.getItem(KEY(status)),
      AsyncStorage.getItem(META_KEY(status)),
    ]);
    if (!questsRaw) return null;
    const quests = JSON.parse(questsRaw) as Quest[];
    return { quests, fetchedAt: fetchedAt ?? new Date().toISOString() };
  } catch (e) {
    console.warn('[offline] readCachedQuests failed', e);
    return null;
  }
}

/**
 * Look up a single cached quest by id across active/completed/abandoned
 * lists. Used by the write-side queue when an RPC (completeQuest) fails
 * for network reasons, we need the quest's tier/title/recurrence to
 * synthesize an optimistic result and update local state without hitting
 * the server.
 */
export async function getCachedQuestById(questId: string): Promise<Quest | null> {
  for (const status of ['active', 'completed', 'abandoned'] as QuestStatus[]) {
    const cached = await readCachedQuests(status);
    const found = cached?.quests.find((q) => q.id === questId);
    if (found) return found;
  }
  return null;
}

/**
 * Optimistic completion, move a quest from the active cache to the
 * completed cache, stamping completed_at. For recurring quests we leave
 * the row in active and bump last_completed_at + streak_count instead,
 * mirroring how the server-side trigger behaves on a successful RPC.
 *
 * Best-effort. If neither list is cached, this no-ops; the next online
 * listQuests fetch will see the real state once the queued RPC drains.
 */
export async function markPendingCompletion(questId: string): Promise<void> {
  try {
    const activeCache = await readCachedQuests('active');
    if (!activeCache) return;
    const idx = activeCache.quests.findIndex((q) => q.id === questId);
    if (idx < 0) return;
    const quest = activeCache.quests[idx];
    if (!quest) return;
    const now = new Date().toISOString();

    if (quest.recurrence) {
      // Recurring: stay active, bump streak + last_completed_at. Real
      // streak math is server-side; this is just a "looks completed for
      // today" marker until reconnect overwrites it.
      const updated: Quest = {
        ...quest,
        last_completed_at: now,
        streak_count: quest.streak_count + 1,
      };
      const nextActive = [...activeCache.quests];
      nextActive[idx] = updated;
      await cacheQuests('active', nextActive);
      return;
    }

    // One-shot: move from active → completed.
    const completedQuest: Quest = {
      ...quest,
      status: 'completed',
      completed_at: now,
    };
    const nextActive = activeCache.quests.filter((_, i) => i !== idx);
    await cacheQuests('active', nextActive);

    const completedCache = await readCachedQuests('completed');
    if (completedCache) {
      const nextCompleted = [
        completedQuest,
        ...completedCache.quests.filter((q) => q.id !== questId),
      ];
      await cacheQuests('completed', nextCompleted);
    } else {
      // No completed cache yet, seed it with just this row so the
      // user can see their work in the Completed tab right away.
      await cacheQuests('completed', [completedQuest]);
    }
  } catch (e) {
    console.warn('[offline] markPendingCompletion failed', e);
  }
}

/**
 * Persist the user's total_xp so the offline completeQuest path can
 * compute an optimistic newTotalXp without a server round-trip. Updated
 * on every successful getCurrentProfile fetch.
 */
export async function cacheProfileTotalXp(xp: number): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PROFILE_TOTAL_XP, String(xp));
  } catch (e) {
    console.warn('[offline] cacheProfileTotalXp failed', e);
  }
}

/** Read the most recent cached total_xp. Returns 0 if nothing is cached
 * , caller treats that as "we don't know" and the optimistic estimate
 *  will be (0 + baseXp), which the next online refetch will correct. */
export async function readCachedProfileTotalXp(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PROFILE_TOTAL_XP);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Wipe the cache. Useful on sign-out so a different user signing in on
 *  the same device doesn't see the previous user's quests. */
export async function clearQuestCache(): Promise<void> {
  try {
    const keys: string[] = [KEY_PROFILE_TOTAL_XP];
    (['active', 'completed', 'abandoned'] as QuestStatus[]).forEach((s) => {
      keys.push(KEY(s), META_KEY(s));
    });
    await AsyncStorage.multiRemove(keys);
  } catch (e) {
    console.warn('[offline] clearQuestCache failed', e);
  }
}
