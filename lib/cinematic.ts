// Phase 3.2 — first-run cinematic gating.
//
// Two flags coexist:
//
//   - PER-USER (KEY(userId)): tracks whether a signed-in user has viewed
//     the cinematic. Used for the in-app "Replay" flow and to gate the
//     onboarding sequence after signup. Per-user so different accounts
//     on a shared device each see the cinematic once each.
//
//   - PER-DEVICE (KEY_DEVICE): tracks whether anyone on this device has
//     viewed the cinematic. Used for pre-auth gating — a first-time
//     visitor opening the app should see the cinematic BEFORE the login
//     screen so they get emotional buy-in before being asked to sign up.
//     Once they sign up, the device flag is promoted to the per-user
//     flag so the cinematic doesn't replay during onboarding.
//
// AsyncStorage is fine for both — losing either flag (e.g. cache clear)
// just means the cinematic plays once more, which is gracefully handled.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = (userId: string) => `cinematic_seen:${userId}`;
const KEY_DEVICE = 'cinematic_seen:device';

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

/** Wipe the seen flag so the cinematic plays again on next launch.
 *  Used by the Reset Character flow — when the user starts over, the
 *  full first-run experience replays. */
export async function resetCinematicSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY(userId));
  } catch {
    // ignore
  }
}

// ---- Device-level flag (pre-auth gating) -----------------------------------

export async function hasSeenCinematicOnDevice(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_DEVICE);
    return v === '1';
  } catch {
    return false;
  }
}

export async function markCinematicSeenOnDevice(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_DEVICE, '1');
  } catch {
    // ignore
  }
}
