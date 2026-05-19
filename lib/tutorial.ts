// First-launch tutorial state.
//
// Persistence is intentionally device-local (AsyncStorage, not the DB) so
// each new device gets the tutorial once, regardless of which user is
// signed in. A returning user on a fresh install gets the same brief
// orientation as a brand-new chronicler, that's the right behavior for
// a tutorial that's about *the app's interface*, not *this user's data*.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'questline.tutorial.seen';

/** True if the user has completed or skipped the tutorial on this device. */
export async function hasSeenTutorial(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

/** Mark the tutorial complete. Called on either "Begin" (last step) or "Skip". */
export async function markTutorialSeen(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
}

/** Wipe the flag so the tutorial fires again. Exposed via Settings →
 *  "Replay tutorial" for users who want a refresher. */
export async function resetTutorial(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
