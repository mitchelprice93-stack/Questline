// Phase 3.2 — first-run cinematic gating.
//
// Tracks per-user whether the cinematic has been viewed. Per-user (not
// per-device) so different accounts on a shared device each see it once.
// AsyncStorage is fine here — the consequence of losing the flag (e.g. cache
// clear) is "the cinematic plays once more", not anything load-bearing.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = (userId: string) => `cinematic_seen:${userId}`;

export async function hasSeenCinematic(userId: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY(userId));
    return v === '1';
  } catch {
    return false;
  }
}

export async function markCinematicSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY(userId), '1');
  } catch {
    // Best-effort — user will see it again on next launch but the app still works.
  }
}
