// Phase 1.5 follow-up — read-side offline cache.
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
    // Cache writes are best-effort — never let a storage failure surface.
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
 * Optimistic insert — prepend a quest to the cached list for its status.
 * Called by the write-side queue when a createQuest fails for network
 * reasons: we drop the synthesized "pending" quest into the cache so the
 * user sees their work immediately on the next list view, even though
 * the server doesn't know about it yet. The pending quest's id is a
 * temp id ("tmp_…") which lets the UI distinguish it later if needed.
 *
 * No-op when the cache for that status is empty — without a baseline
 * list we can't fall back to anything anyway, and the next online fetch
 * will surface the real row from the server.
 */
export async function addPendingQuest(quest: Quest): Promise<void> {
  try {
    const cached = await readCachedQuests(quest.status);
    if (!cached) return;
    const next = [quest, ...cached.quests.filter((q) => q.id !== quest.id)];
    await cacheQuests(quest.status, next);
  } catch (e) {
    console.warn('[offline] addPendingQuest failed', e);
  }
}

/** Wipe the cache. Useful on sign-out so a different user signing in on
 *  the same device doesn't see the previous user's quests. */
export async function clearQuestCache(): Promise<void> {
  try {
    const keys: string[] = [];
    (['active', 'completed', 'abandoned'] as QuestStatus[]).forEach((s) => {
      keys.push(KEY(s), META_KEY(s));
    });
    await AsyncStorage.multiRemove(keys);
  } catch (e) {
    console.warn('[offline] clearQuestCache failed', e);
  }
}
