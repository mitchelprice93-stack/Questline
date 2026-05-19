// Cross-screen audio preferences. Currently a single mute toggle that the
// cinematic player honors; future surfaces (ambient, voiceover) will read
// from the same store.
//
// All useAudioMuted() instances share state through a module-level pub/sub
// so toggling mute in Settings propagates immediately to AmbientAudioRoot
// and any other consumer. Previously each hook had its own local state
// initialized on mount and never refreshed, so muting in Settings only
// took effect after the user backgrounded and reopened the app.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY_MUTED = 'questline.audio.muted';

// Module-level cache + listener set. Single source of truth for all
// useAudioMuted() consumers in the app.
let cachedMuted: boolean | null = null;
const listeners = new Set<(muted: boolean) => void>();

export async function getAudioMuted(): Promise<boolean> {
  if (cachedMuted !== null) return cachedMuted;
  try {
    cachedMuted = (await AsyncStorage.getItem(KEY_MUTED)) === '1';
    return cachedMuted;
  } catch {
    cachedMuted = false;
    return false;
  }
}

export async function setAudioMuted(muted: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_MUTED, muted ? '1' : '0');
  cachedMuted = muted;
  // Notify every active useAudioMuted() hook so all surfaces react in
  // real time, Settings toggle, ambient bed, cinematic player, future
  // voiceover stays in sync without an app restart.
  listeners.forEach((listener) => listener(muted));
}

/** Hook: returns [muted, setter]. The setter persists and updates state
 *  across every consumer of this hook via the module-level pub/sub. */
export function useAudioMuted(): [boolean, (m: boolean) => Promise<void>] {
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAudioMuted().then((m) => {
      if (!cancelled) setMutedState(m);
    });
    const listener = (m: boolean) => setMutedState(m);
    listeners.add(listener);
    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  // `set` triggers the pub/sub which updates our local state via the
  // listener, no need to setMutedState here, avoids a redundant render.
  const set = async (m: boolean) => {
    await setAudioMuted(m);
  };

  return [muted, set];
}
